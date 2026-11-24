/**
 * Cronologia del cliente [CRM-01] (spec §5.2): una sola linea del tempo con preventivi, ordini,
 * pagamenti, consegne e promozioni, dalla più recente. Si legge e basta: ogni evento viene dalla
 * tabella del suo modulo, niente copie.
 */
import type { OrderStatus } from './order';

export const CUSTOMER_TIMELINE_KINDS = [
  'customer_created',
  'quote_created',
  'quote_status',
  'order_status',
  'payment',
  'promo_sent',
  'promo_redeemed',
  'care_visit',
  /** Floral Care, blocco 3 (ADR-079): cargo emesso e movimenti di soldi (solo per chi li gestisce). */
  'care_charge',
  'care_payment',
] as const;
export type CustomerTimelineKind = (typeof CUSTOMER_TIMELINE_KINDS)[number];

/** Eventi per pagina ("Ver más" ne aggiunge altrettanti) e massimo mostrabile. */
export const CUSTOMER_TIMELINE_PAGE = 20;
export const CUSTOMER_TIMELINE_MAX = 200;

/**
 * Quanti eventi mostrare (`?historial=40`): multipli di 20 da 20 a 200; un valore sbagliato vale
 * la prima pagina.
 */
export function customerTimelineLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed)) return CUSTOMER_TIMELINE_PAGE;
  const pages = Math.ceil(parsed / CUSTOMER_TIMELINE_PAGE);
  return Math.min(Math.max(pages, 1) * CUSTOMER_TIMELINE_PAGE, CUSTOMER_TIMELINE_MAX);
}

/**
 * Tappe di un ordine che entrano nella cronologia, oltre alla sua nascita: quelle che contano per
 * il rapporto col cliente. Preparazione, pronto e in viaggio restano nella scheda dell'ordine.
 */
export const CUSTOMER_TIMELINE_ORDER_STATUSES = [
  'CONFIRMED',
  'DELIVERED',
  'PICKED_UP',
  'CANCELLED',
] as const satisfies readonly OrderStatus[];
