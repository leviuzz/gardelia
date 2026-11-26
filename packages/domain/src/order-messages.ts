/**
 * Marketplace M3-1 (ADR-088): i messaggi fra chi compra e la fioreria su un ordine online, e le
 * email automatiche dell'ordine — regole pure.
 *
 *  - Un filo per ordine online. Scrivono chi ha fatto l'ordine (dal suo conto) e tutta la squadra
 *    della fioreria, staff compreso, come in Floral Care (ADR-084).
 *  - Testo fino a 2000 caratteri e al massimo una foto; serve almeno uno dei due.
 *  - Si scrive dall'invio dell'ordine fino a 7 giorni dopo la consegna, il ritiro o l'annullamento;
 *    poi il filo si legge e basta.
 *  - L'avviso per email all'altra parte parte al primo messaggio da leggere e, se resta da leggere,
 *    di nuovo al massimo ogni 6 ore: niente riassunto del giorno dopo come in Floral Care, perché un
 *    ordine si consegna fra pochi giorni (PROPOSTO, piano del 26/11).
 *  - Le foto dei messaggi si cancellano 30 giorni dopo la chiusura dell'ordine (eccezione a
 *    «niente cancellazioni», come quelle di Floral Care); il testo resta.
 */
import { z } from 'zod';
import { addDays, type CalendarDate } from './calendar';
import { zonedDateTime } from './ai';
import { careMessageDayStart, careMessagePages } from './floral-care-messages';
import type { FulfillmentMode, OrderStatus } from './order';
import { toTrimmedString } from './validation';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const ORDER_MESSAGE_LIMITS = {
  /** Caratteri di un messaggio. */
  body: 2000,
  /** Messaggi al giorno di chi compra su un ordine: oltre è un abuso, non un uso normale. */
  perBuyerPerDay: 30,
  /** Messaggi mostrati per volta nel filo ("Vedi i precedenti" per gli altri). */
  page: 30,
  /** Giorni dopo la consegna, il ritiro o l'annullamento in cui si può ancora scrivere. */
  writeDaysAfterClose: 7,
  /** Giorni dopo la chiusura dell'ordine (o dopo il suo giorno, se resta aperto) prima di cancellare le foto. */
  photoRetentionDays: 30,
  /** Finché l'altra parte non legge, un nuovo avviso per email al massimo ogni tante ore. */
  renoticeHours: 6,
} as const;

/** Chi ha scritto: chi ha fatto l'ordine (dal suo conto) o qualcuno della fioreria. */
export const ORDER_MESSAGE_AUTHORS = ['BUYER', 'SHOP'] as const;
export type OrderMessageAuthor = (typeof ORDER_MESSAGE_AUTHORS)[number];

/** Codici dei problemi di un messaggio (testi in `orders.messages.problems.*`). */
export type OrderMessageProblem = 'order_message_empty' | 'order_message_closed';

/**
 * Il testo di un messaggio e la chiave dell'invio: lo stesso modulo inviato due volte (doppio clic,
 * rete lenta) non scrive due messaggi. La foto arriva a parte, come file.
 */
export const orderMessageSchema = z.object({
  body: z.preprocess(
    toTrimmedString,
    z.string({ error: 'invalid' }).max(ORDER_MESSAGE_LIMITS.body, { error: 'too_long' }),
  ),
  submitKey: z.preprocess(toTrimmedString, z.uuid({ error: 'required' })),
});
export type OrderMessageInput = z.infer<typeof orderMessageSchema>;

/** Quante pagine del filo mostrare (`?mensajes=`), con gli stessi limiti di Floral Care. */
export function orderMessagePages(raw: unknown): number {
  return careMessagePages(raw);
}

/** L'inizio di oggi nel fuso della fioreria: da qui si contano i messaggi del giorno. */
export function orderMessageDayStart(timeZone: string, now: Date = new Date()): Date {
  return careMessageDayStart(timeZone, now);
}

/** Stati in cui un ordine è chiuso: consegnato, ritirato o annullato. */
export function isOrderClosed(status: OrderStatus): boolean {
  return status === 'DELIVERED' || status === 'PICKED_UP' || status === 'CANCELLED';
}

interface ThreadOrder {
  readonly status: OrderStatus;
  /** L'ultimo cambio di stato: per un ordine chiuso, quando si è chiuso. */
  readonly statusChangedAt: Date;
  readonly placedOnline: boolean;
  /** NULL se chi l'ha fatto ha eliminato il conto: allora non c'è più nessuno a cui scrivere. */
  readonly buyerUserId: string | null;
}

/** Un ordine ha il filo dei messaggi solo se è online e chi l'ha fatto ha ancora il conto. */
export function hasOrderThread(order: Pick<ThreadOrder, 'placedOnline' | 'buyerUserId'>): boolean {
  return order.placedOnline && order.buyerUserId !== null;
}

/**
 * Si scrive dall'invio fino a 7 giorni dopo la chiusura; mai su una bozza né su un ordine del banco
 * o di un conto eliminato.
 */
export function orderMessagesOpen(order: ThreadOrder, now: Date = new Date()): boolean {
  if (!hasOrderThread(order) || order.status === 'DRAFT') return false;
  if (!isOrderClosed(order.status)) return true;
  return (
    now.getTime() <=
    order.statusChangedAt.getTime() + ORDER_MESSAGE_LIMITS.writeDaysAfterClose * DAY_MS
  );
}

/** Perché un messaggio non si può mandare; null = si può. */
export function orderMessageProblem(input: {
  readonly order: ThreadOrder;
  readonly body: string;
  readonly hasPhoto: boolean;
  readonly now?: Date;
}): OrderMessageProblem | null {
  if (!orderMessagesOpen(input.order, input.now)) return 'order_message_closed';
  if (input.body.trim() === '' && !input.hasPhoto) return 'order_message_empty';
  return null;
}

/**
 * Quando cancellare le foto dei messaggi di un ordine: 30 giorni dopo la chiusura; un ordine rimasto
 * aperto (nessuno l'ha segnato consegnato), 30 giorni dopo la fine del suo giorno di consegna. Null =
 * non ancora (un ordine aperto senza giorno). La stessa regola la usa la funzione SQL del lavoro
 * giornaliero.
 */
export function orderPhotosPurgeAfter(
  order: {
    readonly status: OrderStatus;
    readonly statusChangedAt: Date;
    readonly scheduledDate: CalendarDate | null;
  },
  timeZone: string,
): Date | null {
  const retention = ORDER_MESSAGE_LIMITS.photoRetentionDays * DAY_MS;
  if (isOrderClosed(order.status)) return new Date(order.statusChangedAt.getTime() + retention);
  if (!order.scheduledDate) return null;
  const dayEnd = zonedDateTime(addDays(order.scheduledDate, 1), 0, timeZone);
  return new Date(dayEnd.getTime() + retention);
}

/**
 * L'avviso per email all'altra parte quando arriva un messaggio: sì se non c'era niente da leggere
 * prima (il primo), oppure se è ancora tutto da leggere ma l'ultimo avviso è di almeno 6 ore fa.
 */
export function shouldSendMessageNotice(input: {
  /** Messaggi dello stesso lato ancora da leggere per l'altra parte, PRIMA di questo. */
  readonly unreadBefore: number;
  /** L'ultimo avviso mandato all'altra parte per questo ordine, se c'è. */
  readonly lastNoticeAt: Date | null;
  readonly now?: Date;
}): boolean {
  if (input.unreadBefore === 0 || input.lastNoticeAt === null) return true;
  const now = input.now ?? new Date();
  return (
    now.getTime() - input.lastNoticeAt.getTime() >= ORDER_MESSAGE_LIMITS.renoticeHours * HOUR_MS
  );
}

// -----------------------------------------------------------------------------
// Email automatiche dell'ordine
// -----------------------------------------------------------------------------

/**
 * Le email automatiche già mandate, una riga per ordine e tipo (`OrderNotice`): così una non parte
 * mai due volte. Gli avvisi dei messaggi tengono solo l'ora dell'ultimo.
 */
export const ORDER_NOTICE_KINDS = [
  'STEP_IN_PREPARATION',
  'STEP_READY_PICKUP',
  'STEP_OUT_FOR_DELIVERY',
  'STEP_DELIVERED',
  'EXPIRY_REMINDER',
  'MESSAGE_TO_BUYER',
  'MESSAGE_TO_SHOP',
] as const;
export type OrderNoticeKind = (typeof ORDER_NOTICE_KINDS)[number];

/**
 * L'email a chi compra per un passo dell'ordine: in preparazione, pronto per il ritiro, in consegna,
 * consegnato. Niente per «Ritirato» (chi compra era lì) né per «Pronto» di una consegna (lo segue
 * «In consegna»).
 */
export function orderStepNotice(
  status: OrderStatus,
  mode: FulfillmentMode,
): Extract<
  OrderNoticeKind,
  'STEP_IN_PREPARATION' | 'STEP_READY_PICKUP' | 'STEP_OUT_FOR_DELIVERY' | 'STEP_DELIVERED'
> | null {
  switch (status) {
    case 'IN_PREPARATION':
      return 'STEP_IN_PREPARATION';
    case 'READY':
      return mode === 'PICKUP' ? 'STEP_READY_PICKUP' : null;
    case 'OUT_FOR_DELIVERY':
      return 'STEP_OUT_FOR_DELIVERY';
    case 'DELIVERED':
      return 'STEP_DELIVERED';
    default:
      return null;
  }
}
