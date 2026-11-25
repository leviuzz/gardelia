/**
 * Il carrello della vetrina nel browser (M1, ADR-087): lo stesso cookie che legge il server
 * (`gardelia_cart`, percorso `/f/<slug>`, 30 giorni). Solo ID e quantità: prezzi e disponibilità li
 * decide sempre il server. Da usare solo nei componenti client.
 */
import {
  STOREFRONT_CART_COOKIE,
  STOREFRONT_CART_DAYS,
  parseCart,
  serializeCart,
  type CartLine,
} from '@floral/domain';
import { publicStoreRoutes } from './routes';

export function readCartInBrowser(): CartLine[] {
  const prefix = `${STOREFRONT_CART_COOKIE}=`;
  const entry = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  return parseCart(entry?.slice(prefix.length));
}

/** Scrive (o cancella, se vuoto) il carrello della fioreria. */
export function writeCartInBrowser(slug: string, lines: readonly CartLine[]): void {
  const value = serializeCart(lines);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const maxAge = value ? STOREFRONT_CART_DAYS * 24 * 60 * 60 : 0;
  document.cookie = `${STOREFRONT_CART_COOKIE}=${value}; Path=${publicStoreRoutes(slug).home}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}
