/**
 * Ordine del cliente dalla pagina pubblica della fioreria (marketplace, blocco C4, ADR-067). Regole
 * pure: cosa si può chiedere, per quando, e i limiti contro gli abusi. Prezzi e costo di consegna
 * NON arrivano dal modulo: li decide il servizio dal catalogo e dalle impostazioni della fioreria.
 */
import { z } from 'zod';
import { zonedDateTime } from './ai';
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

const DAY_MS = 24 * 60 * 60 * 1000;

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
  /**
   * Il promemoria alla fioreria parte dal lavoro giornaliero per gli ordini che si annullerebbero
   * prima del giro dopo (una volta al giorno su Vercel Hobby): entro queste ore.
   */
  reminderHours: 24,
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

/**
 * Motivo scritto sugli ordini annullati perché chi compra non ha confermato in tempo i cambi chiesti
 * dalla fioreria (M3-2). Lo leggono tutte e due le parti, come gli altri motivi.
 */
export const MARKETPLACE_UNCONFIRMED_REASON =
  'El cliente no confirmó a tiempo los cambios que propuso la florería: el pedido se canceló automáticamente.';

/** Motivo scritto sugli ordini online che chi compra annulla prima dell'accettazione. */
export const MARKETPLACE_WITHDRAWN_REASON =
  'El cliente canceló el pedido antes de que la florería lo aceptara.';

/**
 * Un ordine online da accettare, per la scadenza: quando è arrivato e, se il fiorista ha chiesto di
 * confermare dei cambi (M3-2), l'ultima richiesta e l'ultima risposta di chi compra.
 */
export interface PendingOrderClock {
  readonly createdAt: Date;
  readonly scheduledDate: CalendarDate | null;
  /** L'ultima volta che il fiorista ha chiesto la conferma (resta anche se poi la ritira). */
  readonly changeAskedAt?: Date | null;
  /** L'ultima risposta di chi compra («Confirmar» o «No, gracias»). */
  readonly changeAnsweredAt?: Date | null;
}

/**
 * Da quando contano i giorni per accettare: dall'invio, oppure dall'ultima richiesta di conferma o
 * dall'ultima risposta di chi compra, la più recente (M3-2). Così chi compra ha i suoi giorni per
 * rispondere, e il fiorista i suoi dopo un «No, gracias».
 */
export function pendingOrderClockStart(order: Omit<PendingOrderClock, 'scheduledDate'>): Date {
  let start = order.createdAt.getTime();
  for (const at of [order.changeAskedAt, order.changeAnsweredAt]) {
    if (at && at.getTime() > start) start = at.getTime();
  }
  return new Date(start);
}

/**
 * Fino a quando un ordine online si può accettare: `acceptDays` giorni dopo l'inizio del conto
 * (`pendingOrderClockStart`), ma non oltre la fine del suo giorno di consegna nel fuso della
 * fioreria. È la sola regola della scadenza: la usano l'annullamento automatico, il promemoria e la
 * scadenza mostrata, e le funzioni SQL `app_pending_orders_to_expire` e
 * `app_pending_orders_to_remind` la ripetono (provato da tutti e due i lati).
 */
export function pendingOrderDeadline(order: PendingOrderClock, timeZone: string): Date {
  const clock =
    pendingOrderClockStart(order).getTime() + MARKETPLACE_ORDER_LIMITS.acceptDays * DAY_MS;
  if (!order.scheduledDate) return new Date(clock);
  const dayEnd = zonedDateTime(addDays(order.scheduledDate, 1), 0, timeZone).getTime();
  return new Date(Math.min(clock, dayEnd));
}

/**
 * Un ordine online ancora da accettare si annulla da solo alla sua scadenza (ricontrollo del
 * servizio sulla scelta della manutenzione).
 */
export function isPendingOrderExpired(
  order: PendingOrderClock,
  now: Date,
  timeZone: string,
): boolean {
  return now.getTime() >= pendingOrderDeadline(order, timeZone).getTime();
}

/**
 * Il promemoria della scadenza: arriva prima del prossimo giro giornaliero. Va alla fioreria, o a
 * chi compra se l'ordine aspetta la sua conferma (M3-2).
 */
export function pendingOrderNeedsReminder(deadline: Date, now: Date): boolean {
  const left = deadline.getTime() - now.getTime();
  return left > 0 && left <= MARKETPLACE_ORDER_LIMITS.reminderHours * 60 * 60 * 1000;
}

/**
 * Un promemoria per scadenza, non per ordine (M3-2): una richiesta di conferma o una risposta fanno
 * ripartire il conto, e allora può partire un promemoria nuovo. `lastSentAt` è l'ultimo mandato.
 */
export function pendingReminderAlreadySent(lastSentAt: Date | null, clockStart: Date): boolean {
  return lastSentAt !== null && lastSentAt.getTime() >= clockStart.getTime();
}

/**
 * La scadenza come si mostra (pagine ed email): l'ultimo minuto utile. Una scadenza a mezzanotte
 * si legge «viernes, 11:59 p.m.», non «sábado, 12:00 a.m.» (sembrerebbe un giorno in più).
 */
export function pendingOrderDeadlineShown(deadline: Date): Date {
  return new Date(deadline.getTime() - 60 * 1000);
}

// -----------------------------------------------------------------------------
// Rifiuto con un motivo pronto (M3-1)
// -----------------------------------------------------------------------------

/** I motivi pronti di «Rifiuta»; «Altro motivo» chiede il testo. */
export const ONLINE_REJECT_REASONS = [
  'NO_AVAILABILITY',
  'OUT_OF_AREA',
  'OUT_OF_STOCK',
  'OTHER',
] as const;
export type OnlineRejectReason = (typeof ONLINE_REJECT_REASONS)[number];

/**
 * Il testo che legge chi compra, nella lingua del mercato come i motivi scritti dalle fiorerie
 * (V1: Messico). Per «Altro motivo» c'è solo il testo della fioreria.
 */
export const ONLINE_REJECT_REASON_TEXTS: Readonly<
  Record<Exclude<OnlineRejectReason, 'OTHER'>, string>
> = {
  NO_AVAILABILITY: 'No tenemos disponibilidad para ese día.',
  OUT_OF_AREA: 'No llegamos a esa dirección.',
  OUT_OF_STOCK: 'Se nos terminó un producto de tu pedido.',
};

/**
 * Il modulo di «Rifiuta»: il motivo pronto e un dettaglio (obbligatorio con «Altro motivo»). Il
 * testo che si salva non supera i 300 caratteri di sempre.
 */
export const onlineOrderRejectSchema = z
  .object({
    reasonCode: z.preprocess(toTrimmedString, z.enum(ONLINE_REJECT_REASONS, { error: 'required' })),
    detail: optionalText(ORDER_LIMITS.cancelReason),
  })
  .superRefine((value, ctx) => {
    if (value.reasonCode === 'OTHER' && !value.detail) {
      ctx.addIssue({ code: 'custom', path: ['detail'], message: 'required' });
      return;
    }
    if (onlineRejectReasonText(value.reasonCode, value.detail).length > ORDER_LIMITS.cancelReason) {
      ctx.addIssue({ code: 'custom', path: ['detail'], message: 'too_long' });
    }
  });
export type OnlineOrderRejectInput = z.infer<typeof onlineOrderRejectSchema>;

/** Il motivo scritto sull'ordine: la frase pronta e, se c'è, il dettaglio della fioreria. */
export function onlineRejectReasonText(code: OnlineRejectReason, detail: string | null): string {
  const base = code === 'OTHER' ? '' : ONLINE_REJECT_REASON_TEXTS[code];
  return [base, detail?.trim() ?? ''].filter((part) => part !== '').join(' ');
}
