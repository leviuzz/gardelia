/**
 * Vetrina della fioreria (marketplace, blocco M1 «Vetrina che vende», ADR-087): schede per
 * categoria, ricerca, ordine, pagine, prodotti in evidenza, primo giorno ordinabile, riassunto del
 * costo di consegna, carrello e ordine delle foto. Regole pure: la vetrina legge le righe leggere
 * di tutti i prodotti online (al massimo `STORE_LIMITS.onlineItems`) e qui decide cosa mostrare.
 * Parametri e valori nell'indirizzo sono in spagnolo come gli altri della pagina pubblica
 * (`producto`, `ciudad`): chi compra li vede.
 */
import { z } from 'zod';
import { addDays, compareDates, type CalendarDate } from './calendar';
import { isUuid } from './ids';
import {
  MARKETPLACE_ORDER_LIMITS,
  earliestMarketplaceDate,
  marketplaceDateProblem,
} from './marketplace-order';
import {
  CATALOG_OCCASIONS,
  OCCASION_SLUG_VALUES,
  occasionFromSlug,
  type CatalogOccasion,
} from './occasions';
import { STORE_LIMITS, type ONLINE_ITEM_TYPES } from './online-store';
import { normalizeSpeciesText } from './species';

type OnlineItemType = (typeof ONLINE_ITEM_TYPES)[number];

/** Le schede della vetrina, una per tipo di prodotto online, in quest'ordine. */
export const STOREFRONT_CATEGORIES = ['ramos', 'flores', 'plantas', 'accesorios'] as const;
export type StorefrontCategory = (typeof STOREFRONT_CATEGORIES)[number];

const CATEGORY_TYPE: Record<StorefrontCategory, OnlineItemType> = {
  ramos: 'BOUQUET',
  flores: 'CUT_FLOWER',
  plantas: 'PLANT',
  accesorios: 'ACCESSORY',
};

/** Scheda di un tipo di prodotto, o null se il tipo non si vende online. */
export function storefrontCategoryOf(type: string): StorefrontCategory | null {
  return STOREFRONT_CATEGORIES.find((category) => CATEGORY_TYPE[category] === type) ?? null;
}

/**
 * Ordini della vetrina. «Recomendados»: prima i prodotti in evidenza (nell'ordine in cui la
 * fioreria li ha scelti), poi gli altri per nome. In tutti gli ordini gli esauriti vanno in fondo.
 */
export const STOREFRONT_SORTS = ['recomendados', 'precio-asc', 'precio-desc', 'nombre'] as const;
export type StorefrontSort = (typeof STOREFRONT_SORTS)[number];

export const STOREFRONT_LIMITS = {
  /** Prodotti per pagina. */
  pageSize: 24,
  /** Caratteri della ricerca. */
  query: 60,
} as const;

const firstValue = (value: unknown) => (Array.isArray(value) ? value[0] : value);

/**
 * Parametri della vetrina dall'indirizzo (`?categoria=ramos&ocasion=cumpleanos&q=rosa&orden=
 * precio-asc&pagina=2`). Mai un errore: un valore sbagliato torna al suo predefinito (è un link che
 * chiunque può scrivere).
 */
export const storefrontQuerySchema = z.object({
  categoria: z.preprocess(firstValue, z.enum(STOREFRONT_CATEGORIES).optional()).catch(undefined),
  /** Occasione (M1-2), col nome in spagnolo dell'indirizzo. */
  ocasion: z.preprocess(firstValue, z.enum(OCCASION_SLUG_VALUES).optional()).catch(undefined),
  q: z
    .preprocess(firstValue, z.string().optional())
    .transform((value) => value?.trim().slice(0, STOREFRONT_LIMITS.query) || undefined)
    .catch(undefined),
  orden: z.preprocess(firstValue, z.enum(STOREFRONT_SORTS)).catch('recomendados'),
  pagina: z.preprocess(firstValue, z.coerce.number().int().min(1).max(10_000)).catch(1),
});
export type StorefrontQuery = z.infer<typeof storefrontQuerySchema>;

export function parseStorefrontQuery(raw: unknown): StorefrontQuery {
  return storefrontQuerySchema.parse(raw && typeof raw === 'object' ? raw : {});
}

/** I filtri che cambiano l'elenco (la pagina e l'ordine no). */
export function storefrontFiltered(query: StorefrontQuery): boolean {
  return query.categoria !== undefined || query.ocasion !== undefined || query.q !== undefined;
}

/** Riga leggera di un prodotto online, quanto basta per filtrare, ordinare e impaginare. */
export interface StorefrontRow {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly availability: string;
  readonly featuredAt: Date | null;
  /** Occasioni scelte dalla fioreria (M1-2). */
  readonly occasions?: readonly string[];
}

export interface StorefrontPlan {
  /** Schede con almeno un prodotto (su tutta la vetrina), nell'ordine di `STOREFRONT_CATEGORIES`. */
  readonly categories: readonly { readonly category: StorefrontCategory; readonly count: number }[];
  /** Occasioni con almeno un prodotto (su tutta la vetrina), nell'ordine di `CATALOG_OCCASIONS`. */
  readonly occasions: readonly { readonly occasion: CatalogOccasion; readonly count: number }[];
  /** Prodotti che corrispondono ai filtri (in evidenza compresi). */
  readonly total: number;
  /** Pagina mostrata (dentro i limiti) e quante sono. */
  readonly page: number;
  readonly pageCount: number;
  /** Prodotti della griglia di questa pagina, in ordine. */
  readonly itemIds: readonly string[];
  /** Riga «Destacados»: solo nella prima pagina senza filtri e con l'ordine consigliato. */
  readonly featuredIds: readonly string[];
}

const soldOut = (row: StorefrontRow) => row.availability === 'OUT_OF_STOCK';

function byName(a: StorefrontRow & { key: string }, b: StorefrontRow & { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Cosa mostra la vetrina: filtri (scheda e ricerca senza accenti: «orquidea» trova «Orquídea»),
 * ordine, pagina e riga «Destacados». Con la riga, i prodotti in evidenza non si ripetono nella
 * griglia (in nessuna pagina, così le pagine non cambiano), ma contano nel totale.
 */
export function planStorefront(
  rows: readonly StorefrontRow[],
  query: StorefrontQuery,
): StorefrontPlan {
  const keyed = rows.map((row) => ({ ...row, key: normalizeSpeciesText(row.name) }));
  const counts = new Map<StorefrontCategory, number>();
  for (const row of keyed) {
    const category = storefrontCategoryOf(row.type);
    if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const categories = STOREFRONT_CATEGORIES.filter((category) => counts.has(category)).map(
    (category) => ({ category, count: counts.get(category)! }),
  );
  const occasions = CATALOG_OCCASIONS.map((occasion) => ({
    occasion,
    count: keyed.filter((row) => row.occasions?.includes(occasion)).length,
  })).filter((entry) => entry.count > 0);

  const needle = query.q ? normalizeSpeciesText(query.q) : '';
  const occasion = occasionFromSlug(query.ocasion);
  const matching = keyed.filter(
    (row) =>
      (!query.categoria || row.type === CATEGORY_TYPE[query.categoria]) &&
      (!occasion || (row.occasions?.includes(occasion) ?? false)) &&
      (!needle || row.key.includes(needle)),
  );

  const featuredOrder = (a: StorefrontRow, b: StorefrontRow) =>
    a.featuredAt!.getTime() - b.featuredAt!.getTime() || (a.id < b.id ? -1 : 1);
  const showStrip = !storefrontFiltered(query) && query.orden === 'recomendados';
  const strip = showStrip
    ? matching
        .filter((row) => row.featuredAt !== null && !soldOut(row))
        .sort(featuredOrder)
        .slice(0, STORE_LIMITS.featured)
    : [];
  const inStrip = new Set(strip.map((row) => row.id));

  const grid = matching
    .filter((row) => !inStrip.has(row.id))
    .sort((a, b) => {
      // Gli esauriti sempre in fondo.
      if (soldOut(a) !== soldOut(b)) return soldOut(a) ? 1 : -1;
      switch (query.orden) {
        case 'precio-asc':
          return a.priceMinor - b.priceMinor || byName(a, b);
        case 'precio-desc':
          return b.priceMinor - a.priceMinor || byName(a, b);
        case 'nombre':
          return byName(a, b);
        case 'recomendados': {
          const featured = (a.featuredAt !== null ? 0 : 1) - (b.featuredAt !== null ? 0 : 1);
          if (featured !== 0) return featured;
          return a.featuredAt && b.featuredAt ? featuredOrder(a, b) : byName(a, b);
        }
      }
    });

  const pageCount = Math.max(1, Math.ceil(grid.length / STOREFRONT_LIMITS.pageSize));
  const page = Math.min(query.pagina, pageCount);
  const start = (page - 1) * STOREFRONT_LIMITS.pageSize;
  return {
    categories,
    occasions,
    total: matching.length,
    page,
    pageCount,
    itemIds: grid.slice(start, start + STOREFRONT_LIMITS.pageSize).map((row) => row.id),
    featuredIds: page === 1 ? strip.map((row) => row.id) : [],
  };
}

/**
 * Primo giorno che chi compra può scegliere: oggi più l'anticipo della fioreria, saltando i giorni
 * di chiusura. Null se nei prossimi 60 giorni non c'è un giorno aperto (niente pulsante d'ordine).
 * È sempre un giorno che `marketplaceDateProblem` accetta.
 */
export function firstOrderableDate(
  today: CalendarDate,
  rules: { readonly minLeadDays: number; readonly closedWeekdays: readonly number[] },
): CalendarDate | null {
  const last = addDays(today, MARKETPLACE_ORDER_LIMITS.scheduleDaysMax);
  for (
    let date = earliestMarketplaceDate(today, rules.minLeadDays);
    compareDates(date, last) <= 0;
    date = addDays(date, 1)
  ) {
    if (marketplaceDateProblem(date, { today, ...rules }) === null) return date;
  }
  return null;
}

/**
 * Il costo di consegna nella scheda della ricerca delle fiorerie (M1-2): con la distanza
 * dall'indirizzo cercato, quello della fascia che ci arriva (`exact`, la stessa regola del modulo
 * d'ordine); altrimenti il riassunto della vetrina. Mai «gratis» per un costo a 0.
 */
export function directoryFee(input: {
  readonly tiers: readonly { readonly maxMeters: number; readonly feeMinor: number }[];
  readonly defaultFeeMinor: number;
  readonly distanceKm: number | null;
}): { readonly summary: DeliveryFeeSummary; readonly exact: boolean } {
  const tiers = [...input.tiers].sort((a, b) => a.maxMeters - b.maxMeters);
  if (input.distanceKm !== null) {
    const meters = Math.round(input.distanceKm * 1000);
    const tier = tiers.find((candidate) => meters <= candidate.maxMeters);
    if (tier) {
      return {
        summary:
          tier.feeMinor > 0 ? { kind: 'fixed', feeMinor: tier.feeMinor } : { kind: 'to_confirm' },
        exact: true,
      };
    }
  }
  return {
    summary: deliveryFeeSummary({
      defaultFeeMinor: input.defaultFeeMinor,
      tierFeesMinor: tiers.map((tier) => tier.feeMinor),
    }),
    exact: false,
  };
}

/**
 * Il costo di consegna in una riga, per la testata della vetrina: fisso, da-a con le fasce per
 * distanza, oppure «lo confirma la florería». Un costo a 0 non si mostra mai come «gratis»: per la
 * fioreria 0 vuol dire anche «da concordare» (M0).
 */
export type DeliveryFeeSummary =
  | { readonly kind: 'fixed'; readonly feeMinor: number }
  | { readonly kind: 'range'; readonly minMinor: number; readonly maxMinor: number }
  | { readonly kind: 'to_confirm' };

export function deliveryFeeSummary(input: {
  readonly defaultFeeMinor: number;
  readonly tierFeesMinor: readonly number[];
}): DeliveryFeeSummary {
  if (input.tierFeesMinor.length > 0) {
    const min = Math.min(...input.tierFeesMinor);
    const max = Math.max(...input.tierFeesMinor);
    if (max === 0) return { kind: 'to_confirm' };
    return min === max
      ? { kind: 'fixed', feeMinor: max }
      : { kind: 'range', minMinor: min, maxMinor: max };
  }
  return input.defaultFeeMinor > 0
    ? { kind: 'fixed', feeMinor: input.defaultFeeMinor }
    : { kind: 'to_confirm' };
}

// -----------------------------------------------------------------------------
// Carrello
// -----------------------------------------------------------------------------

/**
 * Il carrello di chi compra resta in un cookie per fioreria (percorso `/f/<slug>`), 30 giorni:
 * solo ID e quantità, mai prezzi o nomi. Serve solo a riempire il modulo d'ordine: prezzi e
 * disponibilità li decide sempre il server.
 */
export const STOREFRONT_CART_COOKIE = 'gardelia_cart';
export const STOREFRONT_CART_DAYS = 30;
const CART_VERSION = 'v1';

export interface CartLine {
  readonly itemId: string;
  readonly quantity: number;
}

/**
 * Il cookie del carrello (`v1.<id>~<quantità>.<id>~<quantità>`). Un valore rovinato non è un
 * errore: le parti sbagliate si scartano, i doppioni pure, le quantità si fermano a 50 e le righe
 * a 20.
 */
export function parseCart(raw: unknown): CartLine[] {
  if (typeof raw !== 'string') return [];
  const [version, ...parts] = raw.split('.');
  if (version !== CART_VERSION) return [];
  const lines: CartLine[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const [itemId, rawQuantity] = part.split('~');
    const quantity = Number(rawQuantity);
    if (!isUuid(itemId) || seen.has(itemId) || !Number.isInteger(quantity) || quantity < 1) {
      continue;
    }
    seen.add(itemId);
    lines.push({ itemId, quantity: Math.min(quantity, MARKETPLACE_ORDER_LIMITS.quantityMax) });
    if (lines.length === MARKETPLACE_ORDER_LIMITS.lines) break;
  }
  return lines;
}

/** Il valore del cookie; stringa vuota per un carrello vuoto (il cookie si cancella). */
export function serializeCart(lines: readonly CartLine[]): string {
  if (lines.length === 0) return '';
  return [CART_VERSION, ...lines.map((line) => `${line.itemId}~${line.quantity}`)].join('.');
}

/**
 * Mette un prodotto nel carrello con la quantità data (0 lo toglie). Con 20 prodotti diversi un
 * prodotto nuovo non entra: `full` lo dice a chi compra.
 */
export function setCartLine(
  lines: readonly CartLine[],
  itemId: string,
  quantity: number,
): { readonly lines: CartLine[]; readonly full: boolean } {
  const clamped = Math.max(
    0,
    Math.min(
      Math.trunc(Number.isFinite(quantity) ? quantity : 0),
      MARKETPLACE_ORDER_LIMITS.quantityMax,
    ),
  );
  const index = lines.findIndex((line) => line.itemId === itemId);
  if (clamped === 0) {
    return { lines: lines.filter((line) => line.itemId !== itemId), full: false };
  }
  if (index >= 0) {
    return {
      lines: lines.map((line, at) => (at === index ? { itemId, quantity: clamped } : line)),
      full: false,
    };
  }
  if (lines.length >= MARKETPLACE_ORDER_LIMITS.lines) return { lines: [...lines], full: true };
  return { lines: [...lines, { itemId, quantity: clamped }], full: false };
}

/** «Agregar»: uno (o `add`) in più di quello che c'è già. */
export function addToCart(
  lines: readonly CartLine[],
  itemId: string,
  add = 1,
): { readonly lines: CartLine[]; readonly full: boolean } {
  const current = lines.find((line) => line.itemId === itemId)?.quantity ?? 0;
  return setCartLine(lines, itemId, current + add);
}

// -----------------------------------------------------------------------------
// Foto del prodotto
// -----------------------------------------------------------------------------

/** «Usa come copertina» (prima) o le frecce ←/→ nella scheda del prodotto. */
export const PHOTO_MOVES = ['first', 'earlier', 'later'] as const;
export type PhotoMove = (typeof PHOTO_MOVES)[number];

export function isPhotoMove(value: unknown): value is PhotoMove {
  return typeof value === 'string' && (PHOTO_MOVES as readonly string[]).includes(value);
}

/** Il nuovo ordine delle foto, o null se la foto non c'è. Ai bordi l'ordine resta com'è. */
export function movePhotoId(
  order: readonly string[],
  photoId: string,
  move: PhotoMove,
): string[] | null {
  const index = order.indexOf(photoId);
  if (index < 0) return null;
  const next = [...order];
  next.splice(index, 1);
  const target = move === 'first' ? 0 : move === 'earlier' ? Math.max(0, index - 1) : index + 1;
  next.splice(Math.min(target, next.length), 0, photoId);
  return next;
}
