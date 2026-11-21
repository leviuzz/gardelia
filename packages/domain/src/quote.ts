/**
 * Preventivi [ORD-01]: motore prezzi v1, macchina a stati e validazione.
 *
 * Motore prezzi v1 (PRICES_FINAL):
 *  - riga = quantità intera × prezzo unitario in unità minime (nessun arrotondamento);
 *  - subtotale = Σ righe; sconto = importo fisso ≤ subtotale; imposte = 0;
 *  - totale = subtotale − sconto.
 * Lo scorporo dell'IVA NON è calcolato finché un contador non valida le regole (O-06):
 * i prezzi del catalogo sono prezzi finali al cliente.
 */
import { z } from 'zod';
import { MAX_AMOUNT_MINOR, multiplyMinor, sumMinor, type CurrencyCode } from './money';
import {
  moneyField,
  optionalMoneyField,
  optionalText,
  requiredInteger,
  requiredText,
  toTrimmedString,
} from './validation';

export const PRICING_ENGINE_VERSION = 'quote-v1';

export const QUOTE_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/**
 * Transizioni consentite. SENT → DRAFT riapre il preventivo per modificarlo.
 * ACCEPTED è finale nello Sprint 1 (la conversione in ordine arriva con gli ordini).
 */
export const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'REJECTED', 'DRAFT', 'CANCELLED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === 'DRAFT';
}

/** Un preventivo inviato oltre la validità è scaduto (valutato nel calendario del tenant). */
export function effectiveQuoteStatus(
  status: QuoteStatus,
  validUntil: { year: number; month: number; day: number } | null,
  today: { year: number; month: number; day: number },
): QuoteStatus {
  if (status !== 'SENT' || validUntil === null) return status;
  const until = Date.UTC(validUntil.year, validUntil.month - 1, validUntil.day);
  const now = Date.UTC(today.year, today.month - 1, today.day);
  return now > until ? 'EXPIRED' : status;
}

export function formatQuoteNumber(value: number): string {
  return `COT-${String(value).padStart(4, '0')}`;
}

export const QUOTE_LIMITS = {
  lines: 60,
  title: 120,
  notes: 2000,
  description: 160,
  quantityMax: 999,
  validityDaysMax: 90,
} as const;

export interface PricedLine {
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export type QuoteTotalsResult =
  | {
      readonly ok: true;
      readonly lineTotals: readonly number[];
      readonly subtotalMinor: number;
      readonly discountMinor: number;
      readonly taxMinor: number;
      readonly totalMinor: number;
    }
  | { readonly ok: false; readonly error: 'discount_exceeds_subtotal' | 'amount_too_large' };

export function priceQuote(input: {
  readonly lines: readonly PricedLine[];
  readonly discountMinor: number;
}): QuoteTotalsResult {
  const lineTotals = input.lines.map((line) => multiplyMinor(line.unitPriceMinor, line.quantity));
  const subtotalMinor = sumMinor(lineTotals);
  if (subtotalMinor > MAX_AMOUNT_MINOR) return { ok: false, error: 'amount_too_large' };
  if (input.discountMinor < 0 || input.discountMinor > subtotalMinor) {
    return { ok: false, error: 'discount_exceeds_subtotal' };
  }
  const taxMinor = 0;
  return {
    ok: true,
    lineTotals,
    subtotalMinor,
    discountMinor: input.discountMinor,
    taxMinor,
    totalMinor: subtotalMinor - input.discountMinor + taxMinor,
  };
}

/** Data "AAAA-MM-GG" (input type=date) → componenti, con verifica della data reale. */
export function parseDateInput(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export const catalogQuoteLineSchema = z.object({
  catalogItemId: z.preprocess(toTrimmedString, z.uuid({ error: 'required' })),
  quantity: requiredInteger({ min: 1, max: QUOTE_LIMITS.quantityMax }),
});
export type CatalogQuoteLineInput = z.infer<typeof catalogQuoteLineSchema>;

export function customQuoteLineSchema(currency: CurrencyCode) {
  return z.object({
    description: requiredText(QUOTE_LIMITS.description),
    quantity: requiredInteger({ min: 1, max: QUOTE_LIMITS.quantityMax }),
    unitPrice: moneyField(currency),
  });
}
export type CustomQuoteLineInput = z.infer<ReturnType<typeof customQuoteLineSchema>>;

export const quoteLineQuantitySchema = requiredInteger({ min: 1, max: QUOTE_LIMITS.quantityMax });

export function quoteDetailsSchema(currency: CurrencyCode) {
  return z.object({
    title: optionalText(QUOTE_LIMITS.title),
    notes: optionalText(QUOTE_LIMITS.notes),
    discount: optionalMoneyField(currency).transform((value) => value ?? 0),
    validUntil: z.preprocess(
      toTrimmedString,
      z.string().transform((value, ctx) => {
        if (value === '') return null;
        const parsed = parseDateInput(value);
        if (!parsed) {
          ctx.addIssue({ code: 'custom', message: 'invalid_date' });
          return z.NEVER;
        }
        return parsed;
      }),
    ),
  });
}
export type QuoteDetailsInput = z.infer<ReturnType<typeof quoteDetailsSchema>>;

export const quoteListFiltersSchema = z.object({
  q: z.preprocess(toTrimmedString, z.string().max(80).catch('')),
  status: z.preprocess(toTrimmedString, z.enum(QUOTE_STATUSES).nullable().catch(null)),
  page: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.int().min(1).max(10_000).catch(1),
  ),
});
export type QuoteListFilters = z.infer<typeof quoteListFiltersSchema>;

export const QUOTE_PAGE_SIZE = 20;
