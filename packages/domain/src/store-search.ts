/**
 * Ricerca delle fiorerie per chi compra (marketplace, blocco C3, ADR-066). Regole pure: quali
 * tiendas consegnano a un indirizzo e in che ordine.
 *
 * 1. Con le coordinate dell'indirizzo e quelle (ancora valide, ADR-059) della tienda: entra se
 *    l'indirizzo sta nel suo raggio di consegna, in ordine di distanza.
 * 2. Poi le tiendas della stessa città di cui non sappiamo la posizione (coordinate mancanti o
 *    scadute): forse consegnano, lo dirà la fioreria.
 */
import { areCoordinatesFresh, distanceKm, type Coordinates } from './places';

/** Raggio usato quando la fioreria non l'ha indicato (PROPOSTO, si cambia qui). */
export const DEFAULT_DELIVERY_RADIUS_KM = 10;

export interface DirectoryStore {
  readonly city: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly coordinatesAt: Date | null;
  readonly deliveryRadiusKm: number | null;
}

/** "Aguascalientes", " aguascalientes " e "AGUASCALIENTES" sono la stessa città; accenti ignorati. */
export function normalizeCity(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface RankedStores<T> {
  /** Consegnano all'indirizzo, dalla più vicina (distanza in km, un decimale). */
  readonly nearby: readonly (T & { readonly distanceKm: number })[];
  /** Stessa città, posizione sconosciuta. */
  readonly sameCity: readonly T[];
}

export function rankStoresForAddress<T extends DirectoryStore>(
  stores: readonly T[],
  query: { readonly near: Coordinates | null; readonly city: string | null },
  now: Date,
): RankedStores<T> {
  const city = normalizeCity(query.city);
  const nearby: (T & { distanceKm: number })[] = [];
  const sameCity: T[] = [];
  for (const store of stores) {
    const located =
      store.latitude !== null &&
      store.longitude !== null &&
      areCoordinatesFresh(store.coordinatesAt, now);
    if (query.near && located) {
      const distance = distanceKm(query.near, {
        latitude: store.latitude as number,
        longitude: store.longitude as number,
      });
      if (distance <= (store.deliveryRadiusKm ?? DEFAULT_DELIVERY_RADIUS_KM)) {
        nearby.push({ ...store, distanceKm: Math.round(distance * 10) / 10 });
      }
      continue;
    }
    // Posizione sconosciuta (o ricerca solo per città): conta la città.
    if (city !== '' && normalizeCity(store.city) === city) sameCity.push(store);
  }
  nearby.sort((a, b) => a.distanceKm - b.distanceKm);
  return { nearby, sameCity };
}

/** Le città con almeno una tienda, per scegliere senza la ricerca dell'indirizzo. */
export function directoryCities(stores: readonly { readonly city: string | null }[]): string[] {
  const byKey = new Map<string, string>();
  for (const store of stores) {
    const key = normalizeCity(store.city);
    if (key !== '' && !byKey.has(key)) byKey.set(key, (store.city ?? '').trim());
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'es'));
}
