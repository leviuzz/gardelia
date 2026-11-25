/**
 * Link pubblici di preventivi e ordini (ADR-056) e dei resoconti delle visite di Floral Care
 * (ADR-078): il cliente apre il documento senza account, vede lo stato e accetta il preventivo. Regole pure: durata e documenti che si possono condividere.
 */
import type { OrderStatus } from './order';
import type { QuoteStatus } from './quote';

/** `CARE_VISIT`: il resoconto di una visita di Floral Care (ADR-078). */
export const PUBLIC_LINK_KINDS = ['QUOTE', 'ORDER', 'CARE_VISIT'] as const;
export type PublicLinkKind = (typeof PUBLIC_LINK_KINDS)[number];

/** Quanto vale un link dalla sua creazione; poi se ne crea uno nuovo. */
export const PUBLIC_LINK_DAYS = 60;

export function publicLinkExpiry(from: Date): Date {
  return new Date(from.getTime() + PUBLIC_LINK_DAYS * 24 * 60 * 60 * 1000);
}

/** Giorni in cui il link di un ordine vale ancora dopo la consegna. */
export const ORDER_LINK_DAYS_AFTER_DELIVERY = 30;

/**
 * Fin quando il link di un ordine deve valere almeno: 30 giorni dopo la consegna, giorno compreso.
 * `deliveryDate` è la mezzanotte UTC del giorno di consegna.
 */
export function orderLinkDeliveryExpiry(deliveryDate: Date): Date {
  return new Date(
    deliveryDate.getTime() + (ORDER_LINK_DAYS_AFTER_DELIVERY + 1) * 24 * 60 * 60 * 1000,
  );
}

/**
 * Scadenza del link di un ordine: i soliti 60 giorni, ma mai prima di 30 giorni dopo la consegna
 * (un ordine fissato fra 50 giorni deve poter essere seguito fino alla foto della consegna).
 * `deliveryDate` è la mezzanotte UTC del giorno di consegna, o null se non c'è.
 */
export function orderLinkExpiry(from: Date, deliveryDate: Date | null): Date {
  const base = publicLinkExpiry(from);
  if (!deliveryDate) return base;
  const afterDelivery = orderLinkDeliveryExpiry(deliveryDate);
  return afterDelivery > base ? afterDelivery : base;
}

/**
 * Un preventivo si condivide quando è stato inviato o accettato (stato effettivo: uno scaduto
 * no). La bozza no: prima si segna come inviata.
 */
export function canShareQuote(effectiveStatus: QuoteStatus): boolean {
  return effectiveStatus === 'SENT' || effectiveStatus === 'ACCEPTED';
}

/** Un ordine si condivide da confermato in poi; il borrador e l'annullato no. */
export function canShareOrder(status: OrderStatus): boolean {
  return status !== 'DRAFT' && status !== 'CANCELLED';
}

/** Il cliente accetta dal link solo un preventivo inviato e ancora valido. */
export function canAcceptQuoteOnline(effectiveStatus: QuoteStatus): boolean {
  return effectiveStatus === 'SENT';
}
