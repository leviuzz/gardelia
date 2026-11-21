/**
 * Bouquet Builder deterministico [AI-BQ-01…04, AI-BQ-06, BQ-01].
 *
 * Il prezzo si calcola SOLO con `priceBouquet`: la stessa funzione pura produce l'anteprima
 * nel browser e il valore autorevole sul server (che rilegge prezzi e disponibilità dal DB).
 * Prezzo = Σ (quantità × prezzo di listino dei componenti, packaging incluso) + armado.
 * Nessuna AI interviene nel prezzo: la distinta (BOM) è la fonte di verità per la vendita.
 * Imposte: prezzi finali come nei preventivi (ADR-020, O-06 aperta).
 */
import { z } from 'zod';
import type { Availability, CatalogItemType } from './catalog';
import { CATALOG_COLORS } from './colors';
import { MAX_AMOUNT_MINOR, multiplyMinor, sumMinor, type CurrencyCode } from './money';
import { optionalMoneyField, optionalText, requiredText, toTrimmedString } from './validation';

export const BUILDER_PRICING_VERSION = 'builder-v1';

/** Ruolo di un componente nel bouquet (determina il gruppo in UI e le regole). */
export const BUILDER_ROLES = ['FLOWER', 'FOLIAGE', 'PACKAGING', 'ACCESSORY'] as const;
export type BuilderRole = (typeof BUILDER_ROLES)[number];

/** Tipologie di catalogo utilizzabili come componenti (le piante in vaso no). */
export const BUILDER_COMPONENT_TYPES = [
  'CUT_FLOWER',
  'FOLIAGE',
  'PACKAGING',
  'CONTAINER',
  'ACCESSORY',
] as const satisfies readonly CatalogItemType[];

export function builderRoleOf(type: CatalogItemType): BuilderRole | null {
  switch (type) {
    case 'CUT_FLOWER':
      return 'FLOWER';
    case 'FOLIAGE':
      return 'FOLIAGE';
    case 'PACKAGING':
    case 'CONTAINER':
      return 'PACKAGING';
    case 'ACCESSORY':
      return 'ACCESSORY';
    default:
      return null;
  }
}

export function isBuilderComponentType(type: CatalogItemType): boolean {
  return builderRoleOf(type) !== null;
}

export const BUILDER_STYLES = [
  'ROMANTIC',
  'CLASSIC',
  'MODERN',
  'GARDEN',
  'MINIMAL',
  'TROPICAL',
] as const;
export type BuilderStyle = (typeof BUILDER_STYLES)[number];

/** Dimensione indicativa (non influisce sul prezzo: lo determinano i componenti). */
export const BUILDER_SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE'] as const;
export type BuilderSize = (typeof BUILDER_SIZES)[number];

export const BUILDER_LIMITS = {
  lines: 30,
  quantityMax: 300,
  name: 80,
  notes: 1000,
} as const;

export const BUILDER_PAGE_SIZE = 20;

// -----------------------------------------------------------------------------
// Prezzo
// -----------------------------------------------------------------------------

export interface BuilderPricedLine {
  readonly role: BuilderRole;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  /** null = costo non registrato: il costo stimato totale diventa sconosciuto. */
  readonly unitCostMinor: number | null;
}

export type BouquetPricing =
  | {
      readonly ok: true;
      readonly lineTotals: readonly number[];
      /** Fiori e follaje. */
      readonly flowersMinor: number;
      readonly packagingMinor: number;
      readonly accessoriesMinor: number;
      readonly componentsMinor: number;
      readonly laborMinor: number;
      readonly totalMinor: number;
      /** Costo dei materiali (armado escluso); null se manca anche un solo costo. */
      readonly estimatedCostMinor: number | null;
    }
  | { readonly ok: false; readonly error: 'amount_too_large' };

export function priceBouquet(input: {
  readonly lines: readonly BuilderPricedLine[];
  readonly laborMinor: number;
}): BouquetPricing {
  const lineTotals = input.lines.map((line) => multiplyMinor(line.unitPriceMinor, line.quantity));
  const byRole = (roles: readonly BuilderRole[]) =>
    sumMinor(lineTotals.filter((_, index) => roles.includes(input.lines[index]!.role)));
  const flowersMinor = byRole(['FLOWER', 'FOLIAGE']);
  const packagingMinor = byRole(['PACKAGING']);
  const accessoriesMinor = byRole(['ACCESSORY']);
  const componentsMinor = flowersMinor + packagingMinor + accessoriesMinor;
  const totalMinor = componentsMinor + input.laborMinor;
  if (totalMinor > MAX_AMOUNT_MINOR) return { ok: false, error: 'amount_too_large' };
  const costKnown = input.lines.every((line) => line.unitCostMinor !== null);
  return {
    ok: true,
    lineTotals,
    flowersMinor,
    packagingMinor,
    accessoriesMinor,
    componentsMinor,
    laborMinor: input.laborMinor,
    totalMinor,
    estimatedCostMinor: costKnown
      ? sumMinor(input.lines.map((line) => multiplyMinor(line.unitCostMinor ?? 0, line.quantity)))
      : null,
  };
}

// -----------------------------------------------------------------------------
// Regole di composizione
// -----------------------------------------------------------------------------

export type BuilderCompositionError =
  'builder_needs_flower' | 'builder_one_packaging' | 'builder_line_limit';

/** Almeno un fiore; al massimo un packaging (quantità 1); numero di righe limitato. */
export function checkComposition(
  lines: readonly { readonly role: BuilderRole; readonly quantity: number }[],
): BuilderCompositionError | null {
  if (lines.length > BUILDER_LIMITS.lines) return 'builder_line_limit';
  if (!lines.some((line) => line.role === 'FLOWER')) return 'builder_needs_flower';
  const packaging = lines.filter((line) => line.role === 'PACKAGING');
  if (packaging.length > 1 || packaging.some((line) => line.quantity !== 1)) {
    return 'builder_one_packaging';
  }
  return null;
}

/** Disponibilità più critica fra i componenti (per gli avvisi). */
export function worstAvailability(
  values: readonly (Availability | null | undefined)[],
): Availability | null {
  const order: readonly Availability[] = ['OUT_OF_STOCK', 'ON_REQUEST', 'LIMITED', 'AVAILABLE'];
  for (const state of order) if (values.includes(state)) return state;
  return null;
}

// -----------------------------------------------------------------------------
// Colore di carta, vaso e nastro (ADR-030)
// -----------------------------------------------------------------------------

/**
 * Ruoli per cui si sceglie il colore nel Builder. I fiori no: ogni colore di fiore è un
 * articolo a sé ("Rosa roja", "Rosa blanca"), con il suo prezzo e la sua disponibilità.
 */
export const BUILDER_COLOR_ROLES = [
  'PACKAGING',
  'ACCESSORY',
] as const satisfies readonly BuilderRole[];

export function isColorChoiceRole(role: BuilderRole): boolean {
  return (BUILDER_COLOR_ROLES as readonly BuilderRole[]).includes(role);
}

export type LineColorResult =
  | { readonly ok: true; readonly color: string | null }
  | { readonly ok: false; readonly error: 'builder_color_required' | 'invalid_option' };

/**
 * Colore effettivo di una riga, calcolato dal server sui colori ATTUALI dell'articolo:
 *  - carta/vaso/nastro con un solo colore → quello, anche se non indicato;
 *  - con più colori → obbligatorio e dev'essere uno di quelli dell'articolo;
 *  - senza colori, o per fiori e follaje → nessun colore (un colore indicato è un errore).
 */
export function resolveLineColor(
  role: BuilderRole,
  itemColors: readonly string[],
  requested: string | null | undefined,
): LineColorResult {
  const wanted = requested ?? null;
  if (!isColorChoiceRole(role) || itemColors.length === 0) {
    return wanted === null ? { ok: true, color: null } : { ok: false, error: 'invalid_option' };
  }
  if (wanted === null) {
    return itemColors.length === 1
      ? { ok: true, color: itemColors[0] ?? null }
      : { ok: false, error: 'builder_color_required' };
  }
  return itemColors.includes(wanted)
    ? { ok: true, color: wanted }
    : { ok: false, error: 'invalid_option' };
}

// -----------------------------------------------------------------------------
// Input
// -----------------------------------------------------------------------------

const builderLineSchema = z.object({
  catalogItemId: z.uuid({ error: 'invalid_option' }),
  quantity: z.int({ error: 'invalid_number' }).min(1).max(BUILDER_LIMITS.quantityMax),
  color: z.preprocess(
    (value) => (value === undefined || toTrimmedString(value) === '' ? null : value),
    z.enum(CATALOG_COLORS, { error: 'invalid_option' }).nullable(),
  ),
});

/**
 * Configurazione inviata dall'editor (oggetto, non FormData). Gli importi arrivano come
 * stringhe digitate dall'utente e si convertono qui; i prezzi dei componenti NON sono
 * mai accettati dal client.
 */
export function builderConfigurationSchema(currency: CurrencyCode) {
  return z.object({
    name: requiredText(BUILDER_LIMITS.name),
    style: z.preprocess(
      (value) => (toTrimmedString(value) === '' ? null : toTrimmedString(value)),
      z.enum(BUILDER_STYLES, { error: 'invalid_option' }).nullable(),
    ),
    size: z.preprocess(
      (value) => (toTrimmedString(value) === '' ? null : toTrimmedString(value)),
      z.enum(BUILDER_SIZES, { error: 'invalid_option' }).nullable(),
    ),
    budget: optionalMoneyField(currency),
    notes: optionalText(BUILDER_LIMITS.notes),
    lines: z
      .array(builderLineSchema)
      .max(BUILDER_LIMITS.lines, { error: 'builder_line_limit' })
      .refine((lines) => new Set(lines.map((line) => line.catalogItemId)).size === lines.length, {
        error: 'invalid',
      }),
  });
}
export type BuilderConfigurationInput = z.infer<ReturnType<typeof builderConfigurationSchema>>;

/** Cargo per l'armado configurato dal fiorista (impostazioni). */
export function builderSettingsSchema(currency: CurrencyCode) {
  return z.object({
    laborFee: optionalMoneyField(currency).transform((value) => value ?? 0),
  });
}
