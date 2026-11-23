/**
 * Link pubblici di preventivi e ordini (ADR-056): il cliente apre il documento senza account,
 * vede lo stato e accetta il preventivo. Regole pure: durata e documenti che si possono condividere.
 */
import type { OrderStatus } from './order';
import type { QuoteStatus } from './quote';

export const PUBLIC_LINK_KINDS = ['QUOTE', 'ORDER'] as const;
export type PublicLinkKind = (typeof PUBLIC_LINK_KINDS)[number];

/** Quanto vale un link dalla sua creazione; poi se ne crea uno nuovo. */
export const PUBLIC_LINK_DAYS = 60;

export function publicLinkExpiry(from: Date): Date {
  return new Date(from.getTime() + PUBLIC_LINK_DAYS * 24 * 60 * 60 * 1000);
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
