/**
 * Ordini [ORD-01] (ADR-054, docs/ORDERS_MARKETPLACE_PLAN.md §3): stati, totali, pagamenti
 * registrati a mano e validazione dei dati di consegna.
 *
 * Totali (stesso motore dei preventivi, PRICES_FINAL):
 *  - subtotale = Σ righe; sconto ≤ subtotale; costo di consegna ≥ 0; imposte = 0 (O-06);
 *  - totale = subtotale − sconto + consegna.
 * Pagamenti: nessun pagamento online nella V1 (D-26). Il fiorista registra acconti e saldi; uno
 * sbaglio si corregge con uno storno, mai cancellando.
 */
import { z } from 'zod';
import { customerAddressSchema, optionalPhoneField, CUSTOMER_LIMITS } from './customer';
import { type MarketCountry } from './markets';
import { MAX_AMOUNT_MINOR, type CurrencyCode } from './money';
import { parseDateInput } from './quote';
import {
  checkboxField,
  moneyField,
  optionalMoneyField,
  optionalText,
  requiredText,
  toTrimmedString,
} from './validation';

export const ORDER_STATUSES = [
  /** Ordine diretto in composizione (righe, consegna, tarjeta): non è ancora un impegno. */
  'DRAFT',
  'PENDING_ACCEPTANCE',
  'CONFIRMED',
  'IN_PREPARATION',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILLMENT_MODES = ['DELIVERY', 'PICKUP'] as const;
export type FulfillmentMode = (typeof FULFILLMENT_MODES)[number];

export const PAYMENT_METHODS = [
  'CASH',
  'TRANSFER',
  'CARD_TERMINAL',
  'PAYMENT_LINK',
  'OTHER',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Tipi di pagamento che il fiorista registra (lo storno nasce solo dall'azione "Anular"). */
export const ORDER_PAYMENT_INPUT_KINDS = ['DEPOSIT', 'BALANCE'] as const;
export const ORDER_PAYMENT_KINDS = [...ORDER_PAYMENT_INPUT_KINDS, 'REVERSAL'] as const;
export type OrderPaymentKind = (typeof ORDER_PAYMENT_KINDS)[number];

export const ORDER_PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

export const ORDER_LIMITS = {
  cardMessage: 400,
  cardSignature: 80,
  notes: 2000,
  cancelReason: 300,
  paymentReference: 80,
  /** Quanto avanti si può fissare una consegna. */
  scheduleDaysMax: 365,
  /** Righe per ordine e quantità massima per riga (come nei preventivi). */
  lines: 60,
  quantityMax: 999,
} as const;

export const ORDER_PAGE_SIZE = 20;

export function formatOrderNumber(value: number): string {
  return `PED-${String(value).padStart(4, '0')}`;
}

// -----------------------------------------------------------------------------
// Stati
// -----------------------------------------------------------------------------

/** Stati finali: niente più passi né annullamento. */
export const ORDER_FINAL_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'PICKED_UP', 'CANCELLED'];

export function isOrderFinal(status: OrderStatus): boolean {
  return ORDER_FINAL_STATUSES.includes(status);
}

/**
 * Passi consentiti, avanti e un passo indietro per correggere un clic sbagliato. Consegnare vale
 * solo per gli ordini a domicilio, "recogido" solo per il ritiro. L'annullamento è a parte
 * (`canCancelOrder`), perché chiede un motivo.
 */
const STEPS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  // Il borrador si conferma con i dati di consegna (`confirmDraftOrder`), non con un passo.
  DRAFT: [],
  PENDING_ACCEPTANCE: ['CONFIRMED'],
  CONFIRMED: ['IN_PREPARATION', 'READY'],
  IN_PREPARATION: ['READY', 'CONFIRMED'],
  READY: ['OUT_FOR_DELIVERY', 'PICKED_UP', 'IN_PREPARATION'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'READY'],
  DELIVERED: [],
  PICKED_UP: [],
  CANCELLED: [],
};

const DELIVERY_ONLY: readonly OrderStatus[] = ['OUT_FOR_DELIVERY', 'DELIVERED'];
const PICKUP_ONLY: readonly OrderStatus[] = ['PICKED_UP'];

export function orderStepsFrom(status: OrderStatus, mode: FulfillmentMode): OrderStatus[] {
  return STEPS[status].filter((to) =>
    mode === 'DELIVERY' ? !PICKUP_ONLY.includes(to) : !DELIVERY_ONLY.includes(to),
  );
}

export function canStepOrder(from: OrderStatus, to: OrderStatus, mode: FulfillmentMode): boolean {
  return orderStepsFrom(from, mode).includes(to);
}

/** Accettare un ordine del marketplace è una decisione della fioreria, non un passo del banco. */
export function isOrderAcceptance(from: OrderStatus, to: OrderStatus): boolean {
  return from === 'PENDING_ACCEPTANCE' && to === 'CONFIRMED';
}

export function canCancelOrder(status: OrderStatus): boolean {
  // Il borrador non si annulla: si scarta (`discardDraftOrder`), senza motivo.
  return status !== 'DRAFT' && !isOrderFinal(status);
}

/**
 * Dati di consegna e tarjeta si cambiano solo finché l'ordine non è uscito. Nel borrador si
 * compilano una volta sola, alla conferma (`confirmDraftOrder`).
 */
export function isOrderEditable(status: OrderStatus): boolean {
  return (
    status === 'PENDING_ACCEPTANCE' ||
    status === 'CONFIRMED' ||
    status === 'IN_PREPARATION' ||
    status === 'READY'
  );
}

/**
 * Cosa contiene l'ordine (righe e sconto) si cambia finché il ramo non è pronto. Un ordine del
 * marketplace no: lo ha composto il cliente, e la fioreria lo accetta o lo rifiuta.
 */
export function areOrderLinesEditable(status: OrderStatus): boolean {
  return status === 'DRAFT' || status === 'CONFIRMED' || status === 'IN_PREPARATION';
}

/** I pagamenti si registrano su un ordine confermato e non annullato. */
export function acceptsOrderPayments(status: OrderStatus): boolean {
  return status !== 'DRAFT' && status !== 'CANCELLED';
}

// -----------------------------------------------------------------------------
// Totali e pagamenti
// -----------------------------------------------------------------------------

export type OrderTotalsResult =
  | {
      readonly ok: true;
      readonly subtotalMinor: number;
      readonly discountMinor: number;
      readonly deliveryFeeMinor: number;
      readonly taxMinor: number;
      readonly totalMinor: number;
    }
  | { readonly ok: false; readonly error: 'discount_exceeds_subtotal' | 'amount_too_large' };

export function priceOrder(input: {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly deliveryFeeMinor: number;
}): OrderTotalsResult {
  const { subtotalMinor, discountMinor, deliveryFeeMinor } = input;
  if (discountMinor < 0 || discountMinor > subtotalMinor) {
    return { ok: false, error: 'discount_exceeds_subtotal' };
  }
  const totalMinor = subtotalMinor - discountMinor + deliveryFeeMinor;
  if (deliveryFeeMinor < 0 || subtotalMinor > MAX_AMOUNT_MINOR || totalMinor > MAX_AMOUNT_MINOR) {
    return { ok: false, error: 'amount_too_large' };
  }
  return { ok: true, subtotalMinor, discountMinor, deliveryFeeMinor, taxMinor: 0, totalMinor };
}

/** Stessa regola del CHECK `Order_payment_status_check` della migrazione. */
export function orderPaymentStatus(paidMinor: number, totalMinor: number): OrderPaymentStatus {
  if (totalMinor <= 0) return 'PAID';
  if (paidMinor <= 0) return 'UNPAID';
  return paidMinor >= totalMinor ? 'PAID' : 'PARTIAL';
}

export function orderBalanceMinor(paidMinor: number, totalMinor: number): number {
  return Math.max(0, totalMinor - paidMinor);
}

// -----------------------------------------------------------------------------
// Fascia oraria
// -----------------------------------------------------------------------------

/** "HH:MM" (input type=time) → minuti dalla mezzanotte; null se non valido. */
export function parseTimeInput(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minuti dalla mezzanotte → "HH:MM" (1440 = "24:00", fine giornata). */
export function formatTimeOfDay(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// Validazione
// -----------------------------------------------------------------------------

const optionalTime = z.preprocess(
  toTrimmedString,
  z.string().transform((value, ctx) => {
    if (value === '') return null;
    const minutes = parseTimeInput(value);
    if (minutes === null) {
      ctx.addIssue({ code: 'custom', message: 'invalid_time_window' });
      return z.NEVER;
    }
    return minutes;
  }),
);

const requiredDate = z.preprocess(
  toTrimmedString,
  z.string().transform((value, ctx) => {
    if (value === '') {
      ctx.addIssue({ code: 'custom', message: 'required' });
      return z.NEVER;
    }
    const parsed = parseDateInput(value);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'invalid_date' });
      return z.NEVER;
    }
    return parsed;
  }),
);

const optionalUuid = z.preprocess(
  toTrimmedString,
  z
    .string()
    .transform((value) => (value === '' ? null : value))
    .pipe(z.uuid({ error: 'invalid_option' }).nullable()),
);

/**
 * Consegna, destinatario, tarjeta e costo di consegna. L'indirizzo è uno di quelli del cliente
 * (`customerAddressId`) oppure uno nuovo (`deliveryAddressSchema`, validato a parte dal
 * servizio solo quando serve).
 */
export function orderFulfillmentSchema(country: MarketCountry, currency: CurrencyCode) {
  return z
    .object({
      fulfillmentMode: z.preprocess(
        toTrimmedString,
        z.enum(FULFILLMENT_MODES, { error: 'required' }),
      ),
      scheduledDate: requiredDate,
      windowStart: optionalTime,
      windowEnd: optionalTime,
      customerAddressId: optionalUuid,
      recipientName: optionalText(CUSTOMER_LIMITS.recipientName),
      recipientPhone: optionalPhoneField(country),
      deliveryNotes: optionalText(CUSTOMER_LIMITS.deliveryNotes),
      cardMessage: optionalText(ORDER_LIMITS.cardMessage),
      cardSignature: optionalText(ORDER_LIMITS.cardSignature),
      cardAnonymous: checkboxField(),
      deliveryFee: optionalMoneyField(currency).transform((value) => value ?? 0),
      notes: optionalText(ORDER_LIMITS.notes),
    })
    .superRefine((value, ctx) => {
      if ((value.windowStart === null) !== (value.windowEnd === null)) {
        ctx.addIssue({
          code: 'custom',
          path: [value.windowStart === null ? 'windowStart' : 'windowEnd'],
          message: 'invalid_time_window',
        });
      } else if (
        value.windowStart !== null &&
        value.windowEnd !== null &&
        value.windowStart >= value.windowEnd
      ) {
        ctx.addIssue({ code: 'custom', path: ['windowEnd'], message: 'invalid_time_window' });
      }
      if (value.fulfillmentMode === 'PICKUP' && value.deliveryFee > 0) {
        ctx.addIssue({ code: 'custom', path: ['deliveryFee'], message: 'out_of_range' });
      }
    });
}
export type OrderFulfillmentInput = z.infer<ReturnType<typeof orderFulfillmentSchema>>;

/**
 * Casella "Enviar la confirmación" quando un ordine del banco diventa confermato (ADR-072).
 * Assente = no: senza il form (test, script) non parte nessuna email.
 */
export const orderConfirmationNoticeSchema = z.object({ notifyCustomer: checkboxField() });

/**
 * A chi va la conferma di un ordine del banco, o null se non va a nessuno: solo se chi conferma
 * l'ha chiesta, la fioreria è LIVE (mai email ai clienti dalle demo, ADR-016), l'ordine non è della
 * tienda en línea (lì scrive già il flusso di ADR-067) e il cliente ha un'email.
 */
export function counterConfirmationRecipient(input: {
  readonly requested: boolean;
  readonly tenantMode: 'DEMO' | 'LIVE';
  readonly placedOnline: boolean;
  readonly customerEmail: string | null;
}): string | null {
  if (!input.requested || input.tenantMode !== 'LIVE' || input.placedOnline) return null;
  const email = input.customerEmail?.trim() ?? '';
  return email === '' ? null : email;
}

/** Indirizzo di consegna nuovo, con le stesse regole della rubrica del cliente. */
export function deliveryAddressSchema(country: MarketCountry) {
  return customerAddressSchema(country).pick({
    addressLine1: true,
    addressLine2: true,
    neighborhood: true,
    city: true,
    region: true,
    postalCode: true,
  });
}
export type DeliveryAddressInput = z.infer<ReturnType<typeof deliveryAddressSchema>>;

export function orderPaymentSchema(currency: CurrencyCode) {
  return z.object({
    amount: moneyField(currency),
    method: z.preprocess(toTrimmedString, z.enum(PAYMENT_METHODS, { error: 'required' })),
    kind: z.preprocess(toTrimmedString, z.enum(ORDER_PAYMENT_INPUT_KINDS, { error: 'required' })),
    paidOn: z.preprocess(
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
    reference: optionalText(ORDER_LIMITS.paymentReference),
  });
}
export type OrderPaymentInput = z.infer<ReturnType<typeof orderPaymentSchema>>;

export function orderDiscountSchema(currency: CurrencyCode) {
  return z.object({
    discount: optionalMoneyField(currency).transform((value) => value ?? 0),
  });
}

/** Chi ha ricevuto il ramo (prova di consegna, ADR-058); vuoto = non indicato. */
export const orderHandoverSchema = z.object({
  receivedBy: optionalText(CUSTOMER_LIMITS.recipientName),
});

/** La foto del ramo finito si scatta da "pronto" in poi (anche dopo la consegna). */
export function acceptsOrderPhoto(status: OrderStatus): boolean {
  return (
    status === 'READY' ||
    status === 'OUT_FOR_DELIVERY' ||
    status === 'DELIVERED' ||
    status === 'PICKED_UP'
  );
}

/** Chi ha ricevuto si registra quando il ramo è stato consegnato o ritirato. */
export function isOrderHandedOver(status: OrderStatus): boolean {
  return status === 'DELIVERED' || status === 'PICKED_UP';
}

export const orderCancelSchema = z.object({
  reason: requiredText(ORDER_LIMITS.cancelReason),
});

/**
 * Filtri rapidi dell'elenco per giorno di consegna, rispetto a oggi nel fuso della fioreria.
 * Senza scelta: da oggi in poi, i più vicini prima.
 */
export const ORDER_WHEN_FILTERS = [
  'upcoming',
  /** Ordini della tienda en línea in attesa di risposta (ADR-067). */
  'pending',
  'today',
  'tomorrow',
  'week',
  'past',
  'all',
  /** Ordini diretti ancora in composizione (senza data). */
  'drafts',
] as const;
export type OrderWhenFilter = (typeof ORDER_WHEN_FILTERS)[number];

export const orderListFiltersSchema = z.object({
  q: z.preprocess(toTrimmedString, z.string().max(80).catch('')),
  status: z.preprocess(toTrimmedString, z.enum(ORDER_STATUSES).nullable().catch(null)),
  when: z.preprocess(toTrimmedString, z.enum(ORDER_WHEN_FILTERS).catch('upcoming')),
  unpaid: z.preprocess((value) => value === '1' || value === 'true', z.boolean()),
  /** «Con messaggi da leggere» (M3): ordini online con messaggi di chi compra non ancora letti. */
  messages: z.preprocess((value) => value === 'unread', z.boolean()),
  /** «No ai cambi» (M3-2): ordini online tornati alla fioreria dopo un «No, gracias». */
  changes: z.preprocess((value) => value === 'declined', z.boolean()),
  page: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.int().min(1).max(10_000).catch(1),
  ),
});
export type OrderListFilters = z.infer<typeof orderListFiltersSchema>;

/** Campi del modulo di consegna riusati dall'ordine del cliente online (ADR-067). */
export const orderDateField = requiredDate;
/** Un orario facoltativo `HH:MM` in minuti dalla mezzanotte (fascia della consegna). */
export const orderTimeField = optionalTime;
export const optionalUuidField = optionalUuid;
