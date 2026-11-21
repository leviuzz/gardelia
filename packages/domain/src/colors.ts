/**
 * Chiavi colore controllate (catalogo, foto, colore di carta e nastro nel Builder).
 * Modulo senza dipendenze: lo importano catalogo, Builder e foto senza cicli.
 * Le etichette es-MX sono in `messages/es-MX.json` → `catalog.colors.*`.
 */
export const CATALOG_COLORS = [
  'red',
  'pink',
  'fuchsia',
  'white',
  'cream',
  'yellow',
  'orange',
  'peach',
  'coral',
  'purple',
  'lilac',
  'blue',
  'green',
  'burgundy',
  'multicolor',
  // Carte, vasi e nastri (ADR-030).
  'black',
  'gold',
  'silver',
  'brown',
  'transparent',
] as const;
export type CatalogColor = (typeof CATALOG_COLORS)[number];
