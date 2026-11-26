/**
 * Marketplace M3-2 «Cambi da confermare» (ADR-088): su un ordine online ancora da accettare il
 * fiorista cambia quello che gli serve e chiede la conferma a chi compra — regole pure.
 *
 *  - La «fotografia» dell'ordine tiene solo quello che chi compra vede e paga: prodotti con
 *    quantità e prezzi, giorno e fascia, consegna o ritiro, indirizzo, costo di consegna, sconto e
 *    totale. Biglietto, chi riceve, note interne e fattorino non contano come cambi: si cambiano
 *    liberamente come prima (PROPOSTO).
 *  - «Prima» è l'ordine com'era al primo cambio; «dopo» com'è quando il fiorista chiede. Con dei
 *    cambi, «Accetta l'ordine» lascia il posto a «Chiedi conferma al cliente».
 *  - Chi compra conferma una richiesta precisa (`round`): se intanto l'ordine cambia, la richiesta
 *    si ritira da sola e quella vecchia non si conferma più.
 */
import { z } from 'zod';
import { toIsoDate, type CalendarDate } from './calendar';
import { FULFILLMENT_MODES, orderDateField, orderTimeField, type FulfillmentMode } from './order';
import { checkboxField, optionalText, toTrimmedString } from './validation';

export const ORDER_CHANGE_LIMITS = {
  /** Il messaggio facoltativo del fiorista che accompagna la richiesta. */
  message: 500,
  /** Il motivo facoltativo di «No, gracias». */
  declineReason: 300,
} as const;

/**
 * Lo stato della richiesta, una per ordine:
 *  - `EDITING`: il fiorista sta cambiando l'ordine, chi compra non vede niente;
 *  - `ASKED`: il fiorista ha chiesto la conferma, chi compra risponde;
 *  - `CONFIRMED`: chi compra ha confermato, l'ordine è accettato;
 *  - `DECLINED`: chi compra ha detto «No, gracias», l'ordine torna al fiorista.
 */
export const ORDER_CHANGE_STATUSES = ['EDITING', 'ASKED', 'CONFIRMED', 'DECLINED'] as const;
export type OrderChangeStatus = (typeof ORDER_CHANGE_STATUSES)[number];

// -----------------------------------------------------------------------------
// La fotografia dell'ordine
// -----------------------------------------------------------------------------

const amountMinor = z.int().min(0);
const minutesOfDay = z
  .int()
  .min(0)
  .max(24 * 60);

const snapshotAddressSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  neighborhood: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
});
export type OrderChangeAddress = z.infer<typeof snapshotAddressSchema>;

const snapshotLineSchema = z.object({
  /** Il prodotto del catalogo, se c'è (in un ordine compare una volta sola), se no la riga. */
  key: z.string().min(1),
  description: z.string(),
  quantity: z.int().min(1),
  unitPriceMinor: amountMinor,
  lineTotalMinor: amountMinor,
});
export type OrderChangeLine = z.infer<typeof snapshotLineSchema>;

/** La fotografia salvata nel database (JSON): si rilegge sempre con questo schema. */
export const orderChangeSnapshotSchema = z.object({
  fulfillmentMode: z.enum(FULFILLMENT_MODES),
  /** `AAAA-MM-GG`, come `toIsoDate`. */
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  windowStartMinutes: minutesOfDay.nullable(),
  windowEndMinutes: minutesOfDay.nullable(),
  /** Solo per la consegna: nel ritiro l'indirizzo non conta. */
  address: snapshotAddressSchema.nullable(),
  lines: z.array(snapshotLineSchema),
  subtotalMinor: amountMinor,
  discountMinor: amountMinor,
  deliveryFeeMinor: amountMinor,
  totalMinor: amountMinor,
});
export type OrderChangeSnapshot = z.infer<typeof orderChangeSnapshotSchema>;

/** I dati dell'ordine da cui nasce la fotografia (li legge il servizio dal database). */
export interface OrderChangeSource {
  readonly fulfillmentMode: FulfillmentMode;
  readonly scheduledDate: CalendarDate | null;
  readonly windowStartMinutes: number | null;
  readonly windowEndMinutes: number | null;
  readonly address: OrderChangeAddress | null;
  readonly lines: readonly {
    readonly id: string;
    readonly catalogItemId: string | null;
    readonly description: string;
    readonly quantity: number;
    readonly unitPriceMinor: number;
    readonly lineTotalMinor: number;
  }[];
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly deliveryFeeMinor: number;
  readonly totalMinor: number;
}

const blankToNull = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** La fotografia dell'ordine com'è adesso. */
export function orderChangeSnapshot(source: OrderChangeSource): OrderChangeSnapshot {
  const address =
    source.fulfillmentMode === 'DELIVERY' && source.address
      ? {
          line1: source.address.line1.trim(),
          line2: blankToNull(source.address.line2),
          neighborhood: blankToNull(source.address.neighborhood),
          city: blankToNull(source.address.city),
          region: blankToNull(source.address.region),
          postalCode: blankToNull(source.address.postalCode),
        }
      : null;
  return {
    fulfillmentMode: source.fulfillmentMode,
    scheduledDate: source.scheduledDate ? toIsoDate(source.scheduledDate) : null,
    windowStartMinutes: source.windowStartMinutes,
    windowEndMinutes: source.windowEndMinutes,
    address,
    lines: source.lines.map((line) => ({
      key: line.catalogItemId ?? line.id,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
    })),
    subtotalMinor: source.subtotalMinor,
    discountMinor: source.discountMinor,
    deliveryFeeMinor: source.deliveryFeeMinor,
    totalMinor: source.totalMinor,
  };
}

/** Rilegge una fotografia dal database; null se non è valida (non si mostra niente di inventato). */
export function parseOrderChangeSnapshot(raw: unknown): OrderChangeSnapshot | null {
  const parsed = orderChangeSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// -----------------------------------------------------------------------------
// I cambi fra prima e dopo
// -----------------------------------------------------------------------------

export interface OrderChangeValue<T> {
  readonly before: T;
  readonly after: T;
}

export interface OrderChangeSchedule {
  readonly date: string | null;
  readonly windowStartMinutes: number | null;
  readonly windowEndMinutes: number | null;
}

/** Una riga aggiunta, tolta o cambiata (quantità o prezzo). */
export interface OrderLineChange {
  readonly change: 'added' | 'removed' | 'changed';
  readonly description: string;
  readonly before: Omit<OrderChangeLine, 'key' | 'description'> | null;
  readonly after: Omit<OrderChangeLine, 'key' | 'description'> | null;
}

/** Cosa è cambiato; ogni parte è null se è rimasta uguale. */
export interface OrderChangeDiff {
  readonly lines: readonly OrderLineChange[];
  readonly schedule: OrderChangeValue<OrderChangeSchedule> | null;
  readonly fulfillmentMode: OrderChangeValue<FulfillmentMode> | null;
  readonly address: OrderChangeValue<OrderChangeAddress | null> | null;
  readonly deliveryFee: OrderChangeValue<number> | null;
  readonly discount: OrderChangeValue<number> | null;
  readonly total: OrderChangeValue<number> | null;
}

/** I nomi delle parti di `OrderChangeDiff`, per il registro (mai i valori). */
export type OrderChangeField = keyof OrderChangeDiff;

function sameAddress(a: OrderChangeAddress | null, b: OrderChangeAddress | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.line1 === b.line1 &&
    a.line2 === b.line2 &&
    a.neighborhood === b.neighborhood &&
    a.city === b.city &&
    a.region === b.region &&
    a.postalCode === b.postalCode
  );
}

function valueChange<T>(before: T, after: T, same: (a: T, b: T) => boolean = Object.is) {
  return same(before, after) ? null : { before, after };
}

const lineAmounts = (line: OrderChangeLine): Omit<OrderChangeLine, 'key' | 'description'> => ({
  quantity: line.quantity,
  unitPriceMinor: line.unitPriceMinor,
  lineTotalMinor: line.lineTotalMinor,
});

/** Le righe cambiate, nell'ordine di adesso, poi quelle tolte. */
function diffLines(
  before: readonly OrderChangeLine[],
  after: readonly OrderChangeLine[],
): OrderLineChange[] {
  const previous = new Map(before.map((line) => [line.key, line]));
  const current = new Set(after.map((line) => line.key));
  const changes: OrderLineChange[] = [];
  for (const line of after) {
    const old = previous.get(line.key);
    if (!old) {
      changes.push({
        change: 'added',
        description: line.description,
        before: null,
        after: lineAmounts(line),
      });
    } else if (
      old.quantity !== line.quantity ||
      old.unitPriceMinor !== line.unitPriceMinor ||
      old.lineTotalMinor !== line.lineTotalMinor
    ) {
      changes.push({
        change: 'changed',
        description: line.description,
        before: lineAmounts(old),
        after: lineAmounts(line),
      });
    }
  }
  for (const line of before) {
    if (!current.has(line.key)) {
      changes.push({
        change: 'removed',
        description: line.description,
        before: lineAmounts(line),
        after: null,
      });
    }
  }
  return changes;
}

/** Cosa è cambiato fra la fotografia di prima e quella di dopo. */
export function diffOrderChanges(
  before: OrderChangeSnapshot,
  after: OrderChangeSnapshot,
): OrderChangeDiff {
  const schedule = (snapshot: OrderChangeSnapshot): OrderChangeSchedule => ({
    date: snapshot.scheduledDate,
    windowStartMinutes: snapshot.windowStartMinutes,
    windowEndMinutes: snapshot.windowEndMinutes,
  });
  return {
    lines: diffLines(before.lines, after.lines),
    schedule: valueChange(
      schedule(before),
      schedule(after),
      (a, b) =>
        a.date === b.date &&
        a.windowStartMinutes === b.windowStartMinutes &&
        a.windowEndMinutes === b.windowEndMinutes,
    ),
    fulfillmentMode: valueChange(before.fulfillmentMode, after.fulfillmentMode),
    address: valueChange(before.address, after.address, sameAddress),
    deliveryFee: valueChange(before.deliveryFeeMinor, after.deliveryFeeMinor),
    discount: valueChange(before.discountMinor, after.discountMinor),
    total: valueChange(before.totalMinor, after.totalMinor),
  };
}

/** Le parti cambiate, per il registro (mai i valori) e per sapere se c'è qualcosa da chiedere. */
export function orderChangeFields(diff: OrderChangeDiff): OrderChangeField[] {
  const fields: OrderChangeField[] = [];
  if (diff.lines.length > 0) fields.push('lines');
  for (const field of [
    'schedule',
    'fulfillmentMode',
    'address',
    'deliveryFee',
    'discount',
    'total',
  ] as const) {
    if (diff[field] !== null) fields.push(field);
  }
  return fields;
}

/** C'è qualcosa che chi compra deve confermare. */
export function hasOrderChanges(diff: OrderChangeDiff): boolean {
  return orderChangeFields(diff).length > 0;
}

// -----------------------------------------------------------------------------
// Chi deve fare qualcosa
// -----------------------------------------------------------------------------

/**
 * L'ordine aspetta la risposta di chi compra: per la fioreria non è «da gestire» (non conta né in
 * «Da gestire» né nel numero del menu) e il promemoria della scadenza va a chi compra.
 */
export function orderWaitsForBuyer(status: OrderChangeStatus | null): boolean {
  return status === 'ASKED';
}

/** Chi compra ha detto «No, gracias»: l'ordine è di nuovo in mano alla fioreria. */
export function orderChangeDeclined(status: OrderChangeStatus | null): boolean {
  return status === 'DECLINED';
}

// -----------------------------------------------------------------------------
// Moduli
// -----------------------------------------------------------------------------

/**
 * «Chiedi conferma al cliente»: un messaggio facoltativo e, per una consegna a domicilio a 0, la
 * conferma che è gratis (come «Accetta l'ordine», M0).
 */
export const askOrderChangeSchema = z.object({
  message: optionalText(ORDER_CHANGE_LIMITS.message),
  freeDeliveryConfirmed: checkboxField(),
});
export type AskOrderChangeInput = z.infer<typeof askOrderChangeSchema>;

/** «Proponi un'altra data»: giorno e fascia nuovi e la richiesta, in un passo solo. */
export const proposeOrderDateSchema = z
  .object({
    scheduledDate: orderDateField,
    windowStart: orderTimeField,
    windowEnd: orderTimeField,
    message: optionalText(ORDER_CHANGE_LIMITS.message),
    freeDeliveryConfirmed: checkboxField(),
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
  });
export type ProposeOrderDateInput = z.infer<typeof proposeOrderDateSchema>;

/**
 * La risposta di chi compra: la richiesta precisa a cui risponde (`round`, dal modulo che ha
 * visto) e, per «No, gracias», un motivo facoltativo.
 */
export const answerOrderChangeSchema = z.object({
  round: z.preprocess(
    (value) => (typeof value === 'string' ? Number(toTrimmedString(value)) : value),
    z.int({ error: 'invalid' }).min(1, { error: 'invalid' }),
  ),
  reason: optionalText(ORDER_CHANGE_LIMITS.declineReason),
});
export type AnswerOrderChangeInput = z.infer<typeof answerOrderChangeSchema>;
