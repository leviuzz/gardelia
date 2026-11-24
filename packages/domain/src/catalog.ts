/**
 * Catalogo del fiorista [CAT-01]: tipologie, unità di vendita, disponibilità, colori
 * e schemi di validazione degli articoli.
 */
import { z } from 'zod';
import { isBuilderComponentType } from './builder';
import { CATALOG_COLORS } from './colors';
import { MAX_AMOUNT_MINOR, type CurrencyCode } from './money';
import { canShowOnline } from './online-store';
import {
  checkboxField,
  moneyField,
  multiValueField,
  optionalMoneyField,
  optionalInteger,
  optionalText,
  requiredText,
  tagsField,
  toTrimmedString,
} from './validation';

export const CATALOG_ITEM_TYPES = [
  'CUT_FLOWER',
  'FOLIAGE',
  'PLANT',
  'BOUQUET',
  'CONTAINER',
  'PACKAGING',
  'ACCESSORY',
  'SERVICE',
  'SERVICE_ADDON',
] as const;
export type CatalogItemType = (typeof CATALOG_ITEM_TYPES)[number];

export const SALE_UNITS = ['STEM', 'BUNCH', 'PIECE', 'SERVICE'] as const;
export type SaleUnit = (typeof SALE_UNITS)[number];

export const AVAILABILITY_STATES = ['AVAILABLE', 'LIMITED', 'OUT_OF_STOCK', 'ON_REQUEST'] as const;
export type Availability = (typeof AVAILABILITY_STATES)[number];

export const RECORD_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

/** Vocabolario controllato dei colori (filtri, Builder, matching futuro). */
export { CATALOG_COLORS, colorNameOf, isCatalogColor, type CatalogColor } from './colors';

/** Unità di vendita ammesse per ciascuna tipologia. */
export const ALLOWED_UNITS_BY_TYPE: Readonly<Record<CatalogItemType, readonly SaleUnit[]>> = {
  CUT_FLOWER: ['STEM', 'BUNCH'],
  FOLIAGE: ['STEM', 'BUNCH'],
  PLANT: ['PIECE'],
  BOUQUET: ['PIECE'],
  CONTAINER: ['PIECE'],
  PACKAGING: ['PIECE'],
  ACCESSORY: ['PIECE'],
  SERVICE: ['SERVICE'],
  SERVICE_ADDON: ['SERVICE', 'PIECE'],
};

export const DEFAULT_UNIT_BY_TYPE: Readonly<Record<CatalogItemType, SaleUnit>> = {
  CUT_FLOWER: 'STEM',
  FOLIAGE: 'BUNCH',
  PLANT: 'PIECE',
  BOUQUET: 'PIECE',
  CONTAINER: 'PIECE',
  PACKAGING: 'PIECE',
  ACCESSORY: 'PIECE',
  SERVICE: 'SERVICE',
  SERVICE_ADDON: 'SERVICE',
};

/** Tipologie che possono essere ingredienti di una distinta bouquet. */
export const INGREDIENT_TYPES = [
  'CUT_FLOWER',
  'FOLIAGE',
  'PLANT',
  'CONTAINER',
  'PACKAGING',
  'ACCESSORY',
] as const satisfies readonly CatalogItemType[];

/** Tipologie collegabili alla tassonomia normalizzata (CanonicalFlower). */
export const CANONICAL_LINKABLE_TYPES = [
  'CUT_FLOWER',
  'FOLIAGE',
  'PLANT',
] as const satisfies readonly CatalogItemType[];

export function isIngredientType(type: CatalogItemType): boolean {
  return (INGREDIENT_TYPES as readonly CatalogItemType[]).includes(type);
}

export function isCanonicalLinkable(type: CatalogItemType): boolean {
  return (CANONICAL_LINKABLE_TYPES as readonly CatalogItemType[]).includes(type);
}

export function isUnitAllowed(type: CatalogItemType, unit: SaleUnit): boolean {
  return ALLOWED_UNITS_BY_TYPE[type].includes(unit);
}

/** Servizi e servizi aggiuntivi: hanno durata e zona, non un proveedor (ADR-081). */
export const SERVICE_TYPES = [
  'SERVICE',
  'SERVICE_ADDON',
] as const satisfies readonly CatalogItemType[];

export function isServiceType(type: CatalogItemType): boolean {
  return (SERVICE_TYPES as readonly CatalogItemType[]).includes(type);
}

/** Prodotti che si comprano da un proveedor: tutto tranne i servizi (ADR-081). */
export function hasSupplier(type: CatalogItemType): boolean {
  return !isServiceType(type);
}

/**
 * Durate proposte per un servizio, in minuti (ADR-081): una tendina, non un numero da scrivere.
 * Da 15 minuti a una giornata di montaggio.
 */
export const SERVICE_DURATION_OPTIONS = [
  15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 1440,
] as const;

export const SKU_PATTERN = /^[A-Za-z0-9._-]+$/;

export const CATALOG_LIMITS = {
  name: 120,
  description: 2000,
  sku: 40,
  variety: 80,
  /** Carte e nastri hanno spesso molti colori (papel coreano, listón de satín). */
  colors: 12,
  tags: 20,
  tagLength: 30,
  prepMinutesMax: 24 * 60,
  dimensionCmMax: 1000,
  serviceDurationMax: 24 * 60,
  serviceRadiusKmMax: 200,
} as const;

function refineCatalogItem(
  value: {
    type: CatalogItemType;
    saleUnit: SaleUnit;
    canonicalFlowerId: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (!isUnitAllowed(value.type, value.saleUnit)) {
    ctx.addIssue({ code: 'custom', path: ['saleUnit'], message: 'unit_not_allowed_for_type' });
  }
  if (value.canonicalFlowerId !== null && !isCanonicalLinkable(value.type)) {
    ctx.addIssue({
      code: 'custom',
      path: ['canonicalFlowerId'],
      message: 'canonical_not_allowed_for_type',
    });
  }
}

/** Input normalizzato di un articolo: quello che i servizi accettano (e rivalidano). */
export const catalogItemInputSchema = z
  .object({
    type: z.enum(CATALOG_ITEM_TYPES, { error: 'invalid_option' }),
    name: z.string().trim().min(1, { error: 'required' }).max(CATALOG_LIMITS.name),
    description: z.string().trim().max(CATALOG_LIMITS.description).nullable(),
    sku: z
      .string()
      .trim()
      .max(CATALOG_LIMITS.sku, { error: 'too_long' })
      .regex(SKU_PATTERN, { error: 'invalid_sku' })
      .nullable(),
    canonicalFlowerId: z.uuid({ error: 'invalid_option' }).nullable(),
    variety: z.string().trim().max(CATALOG_LIMITS.variety).nullable(),
    colors: z
      .array(z.enum(CATALOG_COLORS, { error: 'invalid_option' }))
      .max(CATALOG_LIMITS.colors, { error: 'too_many_items' }),
    saleUnit: z.enum(SALE_UNITS, { error: 'invalid_option' }),
    priceMinor: z.int().min(0).max(MAX_AMOUNT_MINOR),
    costMinor: z.int().min(0).max(MAX_AMOUNT_MINOR).nullable(),
    availability: z.enum(AVAILABILITY_STATES, { error: 'invalid_option' }),
    prepMinutes: z.int().min(0).max(CATALOG_LIMITS.prepMinutesMax).nullable(),
    heightCm: z.int().min(1).max(CATALOG_LIMITS.dimensionCmMax).nullable(),
    widthCm: z.int().min(1).max(CATALOG_LIMITS.dimensionCmMax).nullable(),
    /**
     * Proveedor habitual (ADR-081). `undefined` = non cambiarlo (il campo c'è solo con
     * l'inventario): chi modifica senza il piano non lo perde.
     */
    supplierId: z.uuid({ error: 'invalid_option' }).nullable().optional(),
    /** Servizi (ADR-081): durata indicativa e raggio dalla fioreria. `undefined` = non cambiarli. */
    serviceDurationMinutes: z
      .int()
      .min(1, { error: 'out_of_range' })
      .max(CATALOG_LIMITS.serviceDurationMax, { error: 'out_of_range' })
      .nullable()
      .optional(),
    serviceRadiusKm: z
      .int()
      .min(1, { error: 'out_of_range' })
      .max(CATALOG_LIMITS.serviceRadiusKmMax, { error: 'out_of_range' })
      .nullable()
      .optional(),
    tags: z
      .array(z.string().trim().toLowerCase().min(1).max(CATALOG_LIMITS.tagLength))
      .max(CATALOG_LIMITS.tags),
    /** Utilizzabile nel Bouquet Builder [AI-BQ-01]; se omesso, attivo per i componenti. */
    isBuilderEnabled: z.boolean().optional(),
    /** Mostrato nella pagina pubblica della fioreria (blocco C2); se omesso, no. */
    isOnline: z.boolean().optional(),
  })
  .superRefine(refineCatalogItem)
  .transform((value) => ({
    ...value,
    // Solo le tipologie componenti possono stare nel Builder (mai bouquet, piante, servizi).
    isBuilderEnabled: isBuilderComponentType(value.type) ? (value.isBuilderEnabled ?? true) : false,
    // Solo ramos, piante, fiori e accessori si mostrano in linea (mai materiali o servizi).
    isOnline: canShowOnline(value.type) ? (value.isOnline ?? false) : false,
    // I servizi non si comprano da un proveedor e hanno una durata, non un tempo di preparazione;
    // durata e zona valgono solo per i servizi.
    prepMinutes: isServiceType(value.type) ? null : value.prepMinutes,
    supplierId: hasSupplier(value.type) ? value.supplierId : null,
    serviceDurationMinutes: isServiceType(value.type) ? value.serviceDurationMinutes : null,
    serviceRadiusKm: isServiceType(value.type) ? value.serviceRadiusKm : null,
  }));

export type CatalogItemInput = z.infer<typeof catalogItemInputSchema>;

/**
 * Schema del form "articolo": accetta le stringhe del browser (prezzi decimali,
 * checkbox ripetuti, tag separati da virgola) e produce un `CatalogItemInput`.
 */
export function catalogItemFormSchema(currency: CurrencyCode) {
  return z
    .object({
      type: z.preprocess(toTrimmedString, z.enum(CATALOG_ITEM_TYPES, { error: 'invalid_option' })),
      name: requiredText(CATALOG_LIMITS.name),
      description: optionalText(CATALOG_LIMITS.description),
      sku: optionalText(CATALOG_LIMITS.sku),
      canonicalFlowerId: optionalText(36),
      variety: optionalText(CATALOG_LIMITS.variety),
      colors: multiValueField(
        z.enum(CATALOG_COLORS, { error: 'invalid_option' }),
        CATALOG_LIMITS.colors,
      ),
      saleUnit: z.preprocess(toTrimmedString, z.enum(SALE_UNITS, { error: 'invalid_option' })),
      price: moneyField(currency),
      cost: optionalMoneyField(currency),
      availability: z.preprocess(
        toTrimmedString,
        z.enum(AVAILABILITY_STATES, { error: 'invalid_option' }),
      ),
      prepMinutes: optionalInteger({ min: 0, max: CATALOG_LIMITS.prepMinutesMax }),
      heightCm: optionalInteger({ min: 1, max: CATALOG_LIMITS.dimensionCmMax }),
      widthCm: optionalInteger({ min: 1, max: CATALOG_LIMITS.dimensionCmMax }),
      // Campi che il form mostra solo a volte: assenti = non cambiarli.
      supplierId: z.undefined().or(optionalText(36)),
      serviceDurationMinutes: z
        .undefined()
        .or(optionalInteger({ min: 1, max: CATALOG_LIMITS.serviceDurationMax })),
      serviceRadiusKm: z
        .undefined()
        .or(optionalInteger({ min: 1, max: CATALOG_LIMITS.serviceRadiusKmMax })),
      tags: tagsField(CATALOG_LIMITS.tags, CATALOG_LIMITS.tagLength),
      isBuilderEnabled: checkboxField(),
      isOnline: checkboxField(),
    })
    .transform(({ price, cost, ...rest }): z.input<typeof catalogItemInputSchema> => ({
      ...rest,
      priceMinor: price,
      costMinor: cost,
    }))
    .pipe(catalogItemInputSchema);
}

/** Filtri dell'elenco catalogo (query string). */
export const catalogListFiltersSchema = z.object({
  q: z.preprocess(toTrimmedString, z.string().max(80).catch('')),
  type: z.preprocess(toTrimmedString, z.enum(CATALOG_ITEM_TYPES).nullable().catch(null)),
  status: z.preprocess(toTrimmedString, z.enum(RECORD_STATUSES).catch('ACTIVE')),
  availability: z.preprocess(toTrimmedString, z.enum(AVAILABILITY_STATES).nullable().catch(null)),
  page: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.int().min(1).max(10_000).catch(1),
  ),
});

export type CatalogListFilters = z.infer<typeof catalogListFiltersSchema>;

export const CATALOG_PAGE_SIZE = 20;
