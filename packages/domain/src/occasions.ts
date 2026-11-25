/**
 * Occasioni dei prodotti (marketplace, blocco M1-2, ADR-087, PROPOSTO): il fiorista le sceglie
 * nella scheda del prodotto, chi compra le usa come scorciatoia nella vetrina e nella ricerca delle
 * fiorerie. Nel database sono identificativi in inglese (CHECK nella migrazione
 * `storefront_visibility`); nell'indirizzo un nome in spagnolo, che chi compra vede
 * (`?ocasion=cumpleanos`); i nomi da leggere sono nei testi, nelle tre lingue.
 */

export const CATALOG_OCCASIONS = [
  'BIRTHDAY',
  'ANNIVERSARY',
  'LOVE',
  'MOTHERS_DAY',
  'SYMPATHY',
  'NEW_BABY',
  'GRADUATION',
  'THANK_YOU',
  'GET_WELL',
] as const;
export type CatalogOccasion = (typeof CATALOG_OCCASIONS)[number];

/** Il nome nell'indirizzo, in spagnolo e senza accenti. */
export const OCCASION_SLUGS: Readonly<Record<CatalogOccasion, string>> = {
  BIRTHDAY: 'cumpleanos',
  ANNIVERSARY: 'aniversario',
  LOVE: 'amor',
  MOTHERS_DAY: 'dia-de-las-madres',
  SYMPATHY: 'condolencias',
  NEW_BABY: 'nacimiento',
  GRADUATION: 'graduacion',
  THANK_YOU: 'agradecimiento',
  GET_WELL: 'recuperate',
};

export const OCCASION_SLUG_VALUES = CATALOG_OCCASIONS.map(
  (occasion) => OCCASION_SLUGS[occasion],
) as [string, ...string[]];

export function isCatalogOccasion(value: unknown): value is CatalogOccasion {
  return typeof value === 'string' && (CATALOG_OCCASIONS as readonly string[]).includes(value);
}

/** L'occasione di un indirizzo (`cumpleanos` → `BIRTHDAY`), o null. */
export function occasionFromSlug(slug: unknown): CatalogOccasion | null {
  if (typeof slug !== 'string') return null;
  return CATALOG_OCCASIONS.find((occasion) => OCCASION_SLUGS[occasion] === slug) ?? null;
}

/** Le occasioni scelte, senza doppioni né valori sconosciuti, nell'ordine di `CATALOG_OCCASIONS`. */
export function normalizeOccasions(values: readonly unknown[]): CatalogOccasion[] {
  return CATALOG_OCCASIONS.filter((occasion) => values.includes(occasion));
}
