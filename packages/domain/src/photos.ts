/**
 * Foto del catalogo e "Mis ramos" — regole pure [CAT-01, AI-BQ-07/08] (ADR-029).
 *
 *  - Foto del catalogo: fiori e follaje da più angolazioni; carte, vasi e nastri con una foto
 *    per colore (il colore dev'essere uno di quelli dell'articolo). Sono la base della futura
 *    composizione con numeri esatti (ADR-028).
 *  - "Mis ramos": foto di ramos fatti dalla fioreria, usate come riferimento di stile per le
 *    anteprime AI. Si caricano solo con il consenso esplicito; mai per addestrare modelli.
 *  - Il server rivalida sempre tipo, dimensione e misure dell'immagine e la ricodifica
 *    (niente metadati EXIF/GPS): il browser riduce le foto solo per velocizzare l'invio.
 */
import { z } from 'zod';
import { BUILDER_STYLES } from './builder';
import type { CatalogItemType } from './catalog';
import { CATALOG_COLORS } from './colors';
import { checkboxField, optionalText, toTrimmedString } from './validation';

export const CATALOG_PHOTO_VIEWS = ['FRONT', 'SIDE', 'TOP', 'DETAIL'] as const;
export type CatalogPhotoView = (typeof CATALOG_PHOTO_VIEWS)[number];

export const PHOTO_LIMITS = {
  /** Foto attive per articolo del catalogo. */
  perItem: 12,
  /** Foto attive in "Mis ramos". */
  references: 30,
  /** Byte massimi di un file ricevuto dal server (dopo la riduzione nel browser). */
  maxUploadBytes: 8 * 1024 * 1024,
  /** Pixel massimi decodificati (protezione da immagini "bomba"). */
  maxInputPixels: 50_000_000,
  /** Lato corto minimo per una foto utile (px). */
  minSide: 320,
  /** Lato lungo massimo dell'immagine salvata e della miniatura (px). */
  fullMaxSide: 1600,
  thumbMaxSide: 480,
  /** Lato lungo a cui il browser riduce le foto prima dell'invio (px). */
  clientMaxSide: 2048,
  caption: 120,
} as const;

/** Formati accettati in upload (il server li riconosce dai byte, non dal nome). */
export const PHOTO_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Servizi e consegne non hanno foto di prodotto. */
const PHOTO_TYPES = [
  'CUT_FLOWER',
  'FOLIAGE',
  'PLANT',
  'BOUQUET',
  'CONTAINER',
  'PACKAGING',
  'ACCESSORY',
] as const satisfies readonly CatalogItemType[];

export function allowsPhotos(type: CatalogItemType): boolean {
  return (PHOTO_TYPES as readonly CatalogItemType[]).includes(type);
}

/** Per carte, vasi e nastri conta soprattutto il colore: una foto per colore. */
export function photoByColor(type: CatalogItemType): boolean {
  return type === 'PACKAGING' || type === 'CONTAINER' || type === 'ACCESSORY';
}

const emptyToNull = (value: unknown) => {
  const trimmed = toTrimmedString(value);
  return trimmed === '' ? null : trimmed;
};

/** Dati di una foto del catalogo (il colore va poi verificato sui colori dell'articolo). */
export const catalogPhotoInputSchema = z.object({
  view: z.preprocess(
    (value) => emptyToNull(value) ?? 'FRONT',
    z.enum(CATALOG_PHOTO_VIEWS, { error: 'invalid_option' }),
  ),
  color: z.preprocess(emptyToNull, z.enum(CATALOG_COLORS, { error: 'invalid_option' }).nullable()),
});
export type CatalogPhotoInput = z.infer<typeof catalogPhotoInputSchema>;

/** Dati di una foto di "Mis ramos": stile facoltativo, nota breve, consenso obbligatorio. */
export const styleReferenceInputSchema = z.object({
  style: z.preprocess(emptyToNull, z.enum(BUILDER_STYLES, { error: 'invalid_option' }).nullable()),
  caption: optionalText(PHOTO_LIMITS.caption),
  consent: checkboxField().pipe(z.literal(true, { error: 'consent_required' })),
});
export type StyleReferenceInput = z.infer<typeof styleReferenceInputSchema>;
