/**
 * Attribuzione degli ordini online (fee D-24, ADR-067): chi apre una tienda dalla ricerca di
 * Gardelia porta con sé un cookie con lo slug; l'ordine fatto in quella tienda entro 30 giorni è
 * "portato da Gardelia". Funzioni pure: il cookie lo leggono e scrivono la rotta e l'azione.
 */

export const FOUND_COOKIE = 'gardelia_found';
/** Durata dell'attribuzione (PROPOSTO; la finestra definitiva è O-10). */
export const FOUND_COOKIE_DAYS = 30;
/** Tiendas ricordate al massimo (le più recenti). */
const MAX_SLUGS = 20;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isStoreSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value);
}

/** Gli slug nel cookie (quelli validi, senza ripetizioni). */
export function foundSlugs(cookie: string | undefined): string[] {
  if (!cookie) return [];
  return [...new Set(cookie.split('.').filter(isStoreSlug))].slice(0, MAX_SLUGS);
}

/** Il nuovo valore del cookie con `slug` per primo. */
export function withFoundSlug(cookie: string | undefined, slug: string): string {
  return [slug, ...foundSlugs(cookie).filter((item) => item !== slug)]
    .slice(0, MAX_SLUGS)
    .join('.');
}
