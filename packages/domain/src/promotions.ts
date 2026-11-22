/**
 * Promo delle date speciali (richiesta del founder, 22/11/2026): un'email automatica con uno
 * sconto, in percentuale o importo fisso, ai clienti che hanno accettato di ricevere promozioni,
 * qualche giorno prima di ogni loro data speciale. Regole pure: impostazioni, sconto, giorni.
 *
 *  - Si invia solo se la fioreria l'ha attivata e ha scelto lo sconto (spenta all'inizio).
 *  - L'email parte quando la prossima ricorrenza di una data cade entro il suo preavviso
 *    ("avvisa con anticipo" della data, 7 giorni se non cambiato), oggi compreso.
 *  - Lo sconto vale fino al giorno della data.
 */
import { z } from 'zod';
import {
  addDays,
  compareDates,
  daysBetween,
  yearlyOccurrences,
  type CalendarDate,
} from './calendar';
import { formatMoney, type CurrencyCode } from './money';
import {
  checkboxField,
  optionalInteger,
  optionalMoneyField,
  optionalText,
  toTrimmedString,
} from './validation';

export const DISCOUNT_KINDS = ['PERCENT', 'AMOUNT'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export const PROMO_LIMITS = {
  percentMin: 1,
  percentMax: 90,
  /** Sconto fisso massimo in unità minime (100 000.00 nella valuta della fioreria). */
  amountMaxMinor: 10_000_000,
  /** Invii della stessa email: il primo più due ripetizioni nei giorni seguenti, se fallisce. */
  maxAttempts: 3,
  /** Giorni guardati in avanti: il preavviso massimo di una data speciale. */
  lookaheadDays: 60,
} as const;

export interface Discount {
  readonly kind: DiscountKind;
  /** Percentuale intera (PERCENT) o importo in unità minime (AMOUNT). */
  readonly value: number;
}

export interface OccasionPromoSettings {
  readonly enabled: boolean;
  readonly kind: DiscountKind;
  /** null finché la fioreria non sceglie lo sconto. */
  readonly value: number | null;
}

/**
 * Modulo della pagina Promociones: attivazione, tipo di sconto e valore. Si valida solo il campo
 * del tipo scelto (l'altro può restare con un valore vecchio); attivare richiede uno sconto.
 */
export function occasionPromoFormSchema(currency: CurrencyCode) {
  const percentField = optionalInteger({
    min: PROMO_LIMITS.percentMin,
    max: PROMO_LIMITS.percentMax,
  });
  const amountField = optionalMoneyField(currency);
  return z
    .object({
      enabled: checkboxField(),
      kind: z.enum(DISCOUNT_KINDS, { error: 'invalid_option' }),
      percent: z.unknown().optional(),
      amount: z.unknown().optional(),
    })
    .transform((input, ctx): OccasionPromoSettings => {
      const field = input.kind === 'PERCENT' ? 'percent' : 'amount';
      const parsed = (input.kind === 'PERCENT' ? percentField : amountField).safeParse(
        input[field] ?? '',
      );
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ code: 'custom', path: [field], message: issue.message });
        }
        return z.NEVER;
      }
      const value = parsed.data;
      if (value === null && input.enabled) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'required' });
        return z.NEVER;
      }
      if (
        input.kind === 'AMOUNT' &&
        value !== null &&
        (value < 1 || value > PROMO_LIMITS.amountMaxMinor)
      ) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'out_of_range' });
        return z.NEVER;
      }
      return { enabled: input.enabled, kind: input.kind, value };
    });
}

/** Sconto configurato e completo, o null. */
export function activeDiscount(settings: OccasionPromoSettings): Discount | null {
  return settings.value === null ? null : { kind: settings.kind, value: settings.value };
}

/** "15 %" / "15%" secondo la lingua, oppure "$100.00". */
export function formatDiscount(discount: Discount, currency: CurrencyCode, locale: string): string {
  return discount.kind === 'PERCENT'
    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
        discount.value / 100,
      )
    : formatMoney(discount.value, currency, locale);
}

export interface PromoOccasion {
  readonly month: number;
  readonly day: number;
  readonly remindDaysBefore: number;
}

export interface DuePromo<T extends PromoOccasion> {
  readonly occasion: T;
  /** Giorno della prossima ricorrenza (fino a cui vale lo sconto). */
  readonly date: CalendarDate;
  readonly daysUntil: number;
}

/** Ultimo giorno guardato in avanti a partire da oggi (per leggere solo i mesi utili). */
export function promoLookaheadEnd(today: CalendarDate): CalendarDate {
  return addDays(today, PROMO_LIMITS.lookaheadDays);
}

/**
 * Date per cui oggi è il momento dell'email: la prossima ricorrenza cade entro il preavviso della
 * data, oggi compreso. Il 29 febbraio, negli anni non bisestili, cade il 28.
 */
export function duePromoOccurrences<T extends PromoOccasion>(
  occasions: readonly T[],
  today: CalendarDate,
): DuePromo<T>[] {
  const end = promoLookaheadEnd(today);
  const due: DuePromo<T>[] = [];
  for (const occasion of occasions) {
    const [date] = yearlyOccurrences(occasion.month, occasion.day, today, end);
    if (!date) continue;
    const daysUntil = daysBetween(today, date);
    if (daysUntil <= occasion.remindDaysBefore) due.push({ occasion, date, daysUntil });
  }
  return due;
}

/** Giorno da cui parte l'email per una ricorrenza (mai prima di oggi, per chi la vede ora). */
export function promoSendDate(date: CalendarDate, remindDaysBefore: number): CalendarDate {
  return addDays(date, -remindDaysBefore);
}

// -----------------------------------------------------------------------------
// Codici e registro degli sconti (ADR-048)
// -----------------------------------------------------------------------------

/**
 * Ogni email della promo porta un codice personale: il cliente lo scrive su WhatsApp e la
 * fioreria lo cerca per sapere se lo sconto è suo, se vale ancora e se è già stato usato.
 * Niente 0/O né 1/I, che scritti a mano o letti al telefono si confondono.
 */
export const PROMO_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PROMO_CODE_LENGTH = 6;

/** "k7m 4qh", "K7M-4QH" → "K7M4QH"; null se non può essere un codice. */
export function normalizePromoCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.toUpperCase().replace(/[\s-]+/g, '');
  if (compact.length !== PROMO_CODE_LENGTH) return null;
  for (const char of compact) if (!PROMO_CODE_ALPHABET.includes(char)) return null;
  return compact;
}

/** "K7M4QH" → "K7M-4QH", come si legge nell'email. */
export function formatPromoCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export const PROMO_DISCOUNT_STATUSES = ['VALID', 'USED', 'EXPIRED'] as const;
export type PromoDiscountStatus = (typeof PROMO_DISCOUNT_STATUSES)[number];

/** Sconto inviato: usato; altrimenti valido fino al giorno della data compreso, poi scaduto. */
export function promoDiscountStatus(
  discount: { readonly redeemed: boolean; readonly validUntil: CalendarDate },
  today: CalendarDate,
): PromoDiscountStatus {
  if (discount.redeemed) return 'USED';
  return compareDates(today, discount.validUntil) <= 0 ? 'VALID' : 'EXPIRED';
}

export const PROMO_DISCOUNT_PAGE_SIZE = 20;

/** Filtri dell'elenco degli sconti inviati (`?q=…&status=…&page=…`). */
export const promoDiscountFiltersSchema = z.object({
  q: z.preprocess(toTrimmedString, z.string().max(80).catch('')),
  status: z.preprocess(toTrimmedString, z.enum(PROMO_DISCOUNT_STATUSES).nullable().catch(null)),
  page: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.int().min(1).max(10_000).catch(1),
  ),
});
export type PromoDiscountFilters = z.infer<typeof promoDiscountFiltersSchema>;

/** Nota facoltativa quando si segna uno sconto come usato (es. "Ramo de 24 rosas, COT-0042"). */
export const PROMO_REDEMPTION_NOTE_MAX = 200;
export const promoRedemptionSchema = z.object({
  note: optionalText(PROMO_REDEMPTION_NOTE_MAX),
});
