/**
 * Conto del cliente del marketplace (blocco C1): regole dei dati di chi compra. Gli indirizzi
 * hanno gli stessi campi e la stessa validazione della rubrica della fioreria, così un indirizzo
 * salvato dal cliente si copia in un ordine senza conversioni.
 */
import { z } from 'zod';
import { customerAddressSchema, optionalPhoneField } from './customer';
import type { MarketCountry } from './markets';

export const BUYER_LIMITS = {
  /** Indirizzi attivi per persona: abbastanza per casa, lavoro e chi si festeggia spesso. */
  addresses: 20,
} as const;

/** Dati di contatto di chi compra (il nome e l'email sono quelli dell'accesso). */
export function buyerProfileSchema(country: MarketCountry) {
  return z.object({ phone: optionalPhoneField(country) });
}
export type BuyerProfileInput = z.infer<ReturnType<typeof buyerProfileSchema>>;

/** Un indirizzo di consegna di chi compra: come quello della rubrica della fioreria. */
export function buyerAddressSchema(country: MarketCountry) {
  return customerAddressSchema(country);
}
export type BuyerAddressInput = z.infer<ReturnType<typeof buyerAddressSchema>>;
