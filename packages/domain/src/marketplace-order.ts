/**
 * Ordine del cliente dalla pagina pubblica della fioreria (marketplace, blocco C4, ADR-067). Regole
 * pure: cosa si può chiedere, per quando, e i limiti contro gli abusi. Prezzi e costo di consegna
 * NON arrivano dal modulo: li decide il servizio dal catalogo e dalle impostazioni della fioreria.
 */
import { z } from 'zod';
import { addDays, compareDates, dayOfWeek, type CalendarDate } from './calendar';
import { CUSTOMER_LIMITS, optionalPhoneField } from './customer';
import type { MarketCountry } from './markets';
import {
  FULFILLMENT_MODES,
  ORDER_LIMITS,
  optionalUuidField,
  orderDateField,
  parseTimeInput,
  type FulfillmentMode,
} from './order';
import { checkboxField, optionalText, toTrimmedString } from './validation';

/**
 * «Aceptar» un ordine online a domicilio con la consegna a 0 chiede una conferma (M0,
 * docs/MARKETPLACE_FLOWS.md): spesso il costo era «lo confirma la florería» e va messo prima di
 * mandare al cliente il totale e come pagare. A volte è davvero gratis.
 */
export function onlineOrderNeedsFreeDeliveryConfirmation(order: {
  readonly fulfillmentMode: FulfillmentMode;
  readonly deliveryFeeMinor: number;
}): boolean {
  return order.fulfillmentMode === 'DELIVERY' && order.deliveryFeeMinor === 0;
}

/** Il modulo di «Aceptar pedido»: la casella che conferma la consegna senza costo. */
export const onlineOrderAcceptSchema = z.object({ freeDeliveryConfirmed: checkboxField() });

export const MARKETPLACE_ORDER_LIMITS = {
  /** Prodotti diversi in un ordine. */
  lines: 20,
  quantityMax: 50,
  /** Ordini in attesa di accettazione per persona e fioreria (contro lo spam). */
  pendingPerStore: 3,
  /** Fin quando si può fissare una consegna. */
  scheduleDaysMax: 60,
  /** Anticipo minimo che la fioreria può chiedere (giorni). */
  leadDaysMax: 14,
  /**
   * Giorni per accettare: dopo (o se intanto arriva il giorno della consegna) l'ordine si annulla
   * da solo e chi compra lo sa per email. PROPOSTO (ADR-067).
   */
  acceptDays: 3,
  /** Commenti per la fioreria. */
  buyerNotes: 500,
} as const;

/**
 * Righe del modulo: campi `qty.<itemId>` con la quantità → solo quelle maggiori di zero. Accetta
 * sia i campi piatti sia l'oggetto annidato `{ qty: { <itemId>: "2" } }` di `formDataToObject`.
 */
export function marketplaceLinesFromForm(
  values: Readonly<Record<string, unknown>>,
): { itemId: string; quantity: unknown }[] {
  const entries: [string, unknown][] = Object.entries(values)
    .filter(([key]) => key.startsWith('qty.'))
    .map(([key, raw]) => [key.slice(4), raw]);
  const nested = values.qty;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    entries.push(...Object.entries(nested as Record<string, unknown>));
  }
  const lines: { itemId: string; quantity: unknown }[] = [];
  for (const [itemId, raw] of entries) {
    const text = typeof raw === 'string' ? raw.trim() : raw;
    if (text === '' || text === undefined || text === null) continue;
    const quantity = Number(text);
    // Zero = non scelto; tutto il resto (anche 1.5 o "abc") passa allo schema, che lo rifiuta.
    if (quantity === 0) continue;
    lines.push({ itemId, quantity: Number.isFinite(quantity) ? quantity : text });
  }
  return lines;
}

const requiredPhone = (country: MarketCountry) =>
  optionalPhoneField(country).refine((value) => value !== null, { error: 'required' });

/** "HH:MM-HH:MM" di una fascia della fioreria, o vuoto = in giornata. */
const windowField = z.preprocess(
  toTrimmedString,
  z.string().transform((value, ctx) => {
    if (value === '') return null;
    const [start, end] = value.split('-').map((part) => parseTimeInput(part));
    if (
      start === null ||
      end === null ||
      start === undefined ||
      end === undefined ||
      start >= end
    ) {
      ctx.addIssue({ code: 'custom', message: 'invalid_option' });
      return z.NEVER;
    }
    return { start, end };
  }),
);

export function marketplaceOrderSchema(country: MarketCountry) {
  return z.object({
    lines: z
      .array(
        z.object({
          itemId: z.uuid({ error: 'invalid_option' }),
          quantity: z
            .int({ error: 'out_of_range' })
            .min(1, { error: 'out_of_range' })
            .max(MARKETPLACE_ORDER_LIMITS.quantityMax, { error: 'out_of_range' }),
        }),
      )
      .min(1, { error: 'checkout_no_items' })
      .max(MARKETPLACE_ORDER_LIMITS.lines, { error: 'too_many_items' }),
    fulfillmentMode: z.preprocess(
      toTrimmedString,
      z.enum(FULFILLMENT_MODES, { error: 'required' }),
    ),
    scheduledDate: orderDateField,
    window: windowField,
    /** Indirizzo salvato in "Mi cuenta"; vuoto = uno nuovo (validato a parte dal servizio). */
    buyerAddressId: optionalUuidField,
    recipientName: optionalText(CUSTOMER_LIMITS.recipientName),
    recipientPhone: optionalPhoneField(country),
    deliveryNotes: optionalText(CUSTOMER_LIMITS.deliveryNotes),
    cardMessage: optionalText(ORDER_LIMITS.cardMessage),
    cardSignature: optionalText(ORDER_LIMITS.cardSignature),
    cardAnonymous: checkboxField(),
    /** Commenti per la fioreria ("colores pastel", "sin lirios"). */
    buyerNotes: optionalText(MARKETPLACE_ORDER_LIMITS.buyerNotes),
    /** "Guardar esta dirección en mi cuenta" (solo per un indirizzo nuovo). */
    saveAddress: checkboxField(),
    /** Telefono di chi ordina: la fioreria deve poterlo chiamare (si salva anche nel profilo). */
    contactPhone: requiredPhone(country),
  });
}
export type MarketplaceOrderInput = z.infer<ReturnType<typeof marketplaceOrderSchema>>;

export type MarketplaceDateProblem = 'too_soon' | 'too_far' | 'closed_day';

/** Codice di validazione (testi in `checkout.validation.*`) di un giorno non valido. */
export const MARKETPLACE_DATE_ERRORS: Record<MarketplaceDateProblem, string> = {
  too_soon: 'checkout_date_too_soon',
  too_far: 'checkout_date_too_far',
  closed_day: 'checkout_closed_day',
};

/** Primo giorno che si può scegliere (oggi + anticipo della fioreria). */
export function earliestMarketplaceDate(today: CalendarDate, minLeadDays: number): CalendarDate {
  return addDays(today, Math.min(Math.max(minLeadDays, 0), MARKETPLACE_ORDER_LIMITS.leadDaysMax));
}

/** Un giorno di consegna o ritiro per un ordine online: anticipo, limite e giorni di chiusura. */
export function marketplaceDateProblem(
  date: CalendarDate,
  rules: {
    readonly today: CalendarDate;
    readonly minLeadDays: number;
    readonly closedWeekdays: readonly number[];
  },
): MarketplaceDateProblem | null {
  if (compareDates(date, earliestMarketplaceDate(rules.today, rules.minLeadDays)) < 0) {
    return 'too_soon';
  }
  if (compareDates(date, addDays(rules.today, MARKETPLACE_ORDER_LIMITS.scheduleDaysMax)) > 0) {
    return 'too_far';
  }
  // A differenza del banco (solo un avviso), online la chiusura blocca: nessuno è lì a decidere.
  if (rules.closedWeekdays.includes(dayOfWeek(date))) return 'closed_day';
  return null;
}

/**
 * Motivo scritto sugli ordini annullati perché nessuno li ha accettati (lo leggono la fioreria e chi
 * compra). Nella lingua del mercato, come i dati scritti dalle fiorerie (V1: Messico).
 */
export const MARKETPLACE_EXPIRED_REASON =
  'La florería no respondió a tiempo: el pedido se canceló automáticamente.';

/** Motivo scritto sugli ordini online che chi compra annulla prima dell'accettazione. */
export const MARKETPLACE_WITHDRAWN_REASON =
  'El cliente canceló el pedido antes de que la florería lo aceptara.';

/**
 * Un ordine online ancora da accettare si annulla da solo quando è fermo da `acceptDays` giorni o
 * quando il suo giorno è già passato (ricontrollo del servizio sulla scelta della manutenzione).
 */
export function isPendingOrderExpired(
  order: { readonly createdAt: Date; readonly scheduledDate: CalendarDate | null },
  now: Date,
  today: CalendarDate,
): boolean {
  const limit = MARKETPLACE_ORDER_LIMITS.acceptDays * 24 * 60 * 60 * 1000;
  if (now.getTime() - order.createdAt.getTime() > limit) return true;
  return order.scheduledDate !== null && compareDates(order.scheduledDate, today) < 0;
}
