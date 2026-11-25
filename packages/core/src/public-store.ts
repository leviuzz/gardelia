/**
 * Pagina pubblica della fioreria, lato cliente (marketplace, blocco C2, ADR-065). Chi visita non ha
 * sessione: lo slug diventa una fioreria SOLO se la sua tienda è pubblicata e la fioreria è attiva
 * (funzione SQL `app_public_store_tenant`), poi i dati si leggono nel contesto di quella fioreria
 * con la RLS attiva, mai con un contesto di sistema. Si espone solo ciò che il cliente deve
 * vedere: prodotti attivi con "Visible en línea", prezzi di vendita, contatto, consegne. Niente
 * costi, codici interni, note o dati di clienti.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  MX_REGIONS,
  ONLINE_ITEM_TYPES,
  deliveryFeeSummary,
  firstOrderableDate,
  formatTimeOfDay,
  hasOpeningHours,
  isStoreImageKind,
  isUuid,
  parseStorefrontQuery,
  planStorefront,
  resolveLocale,
  toIsoDate,
  todayInTimeZone,
  type Availability,
  type CartLine,
  type CatalogOccasion,
  type CatalogItemType,
  type DeliveryFeeSummary,
  type OpeningDay,
  type SaleUnit,
  type StorefrontCategory,
  type StorefrontQuery,
  type StorePaymentMethod,
  type SupportedLocale,
} from '@floral/domain';
import { NotFoundError } from './errors';
import { logger } from './logger';
import { loadOpeningHours } from './services/opening-hours';
import {
  FLOWER_SELECT,
  speciesDto,
  type AssistantSpeciesDto,
} from './services/plant-assistant-internals';
import { readStoredImage, type StoredImage } from './media/stored-files';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface PublicStoreItemDto {
  readonly id: string;
  readonly type: CatalogItemType;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number;
  readonly saleUnit: SaleUnit;
  readonly availability: Availability;
  readonly colors: readonly string[];
  readonly heightCm: number | null;
  readonly widthCm: number | null;
  /** Prima foto (copertina), o null. */
  readonly photoId: string | null;
  /** «In evidenza» nella vetrina (M1). */
  readonly featured: boolean;
}

export interface PublicStoreDto {
  readonly slug: string;
  readonly name: string;
  readonly locale: SupportedLocale;
  readonly currency: string;
  /** Fioreria di prova: la pagina lo dice. */
  readonly isDemo: boolean;
  readonly description: string | null;
  /** Telefono per WhatsApp e chiamate (E.164), o null. */
  readonly phone: string | null;
  /** ID del logo e della copertina (nell'indirizzo dell'immagine), o null. */
  readonly logoId: string | null;
  readonly coverId: string | null;
  /** Dove si ritira (indirizzo della tienda principale), o null. */
  readonly address: {
    readonly line: string;
    readonly neighborhood: string | null;
    readonly city: string;
    readonly region: string;
  } | null;
  /** Orari di apertura, da domenica (0) a sabato; null se la fioreria non li ha indicati. */
  readonly openingHours: readonly OpeningDay[] | null;
  readonly delivery: {
    readonly windows: readonly { readonly start: string; readonly end: string }[];
    readonly closedWeekdays: readonly number[];
    /** Costo di consegna abituale (0 = da concordare o gratis: la pagina non promette nulla). */
    readonly defaultFeeMinor: number;
    /** Costo per distanza (ADR-069), dalla fascia più vicina; vuoto se la fioreria non lo usa. */
    readonly feeTiers: readonly { readonly maxKm: number; readonly feeMinor: number }[];
    readonly radiusKm: number | null;
    /** Il costo in una riga per la testata (M1): mai «gratis» per un costo a 0. */
    readonly feeSummary: DeliveryFeeSummary;
    /**
     * Primo giorno che si può scegliere in un ordine online (`YYYY-MM-DD`, ora della fioreria),
     * saltando i giorni chiusi; null se non ce n'è uno nei prossimi 60 giorni.
     */
    readonly firstDate: string | null;
    /** Oggi nell'ora della fioreria (`YYYY-MM-DD`): «desde hoy», «desde mañana». */
    readonly today: string;
  };
  readonly paymentMethods: readonly StorePaymentMethod[];
  readonly paymentInstructions: string | null;
  /** Chi compra può fare l'ordine dalla pagina (ADR-067). */
  readonly ordersEnabled: boolean;
  /** Politiche della fioreria (M1): testi suoi, null se non le ha scritte. */
  readonly policies: {
    readonly changes: string | null;
    readonly cancellations: string | null;
    readonly substitutions: string | null;
  };
}

/**
 * Il carrello di chi compra (cookie, M1) ai prezzi di oggi: solo i prodotti ancora ordinabili.
 * Serve alla barra «Tu pedido»; il modulo d'ordine e il server rifanno sempre tutto.
 */
export interface PublicCartSummaryDto {
  /** Prodotti diversi e pezzi in tutto. */
  readonly lines: number;
  readonly units: number;
  readonly subtotalMinor: number;
}

/** La vetrina (M1): scheda, ricerca, ordine e pagina scelti da chi compra. */
export interface PublicStorefrontDto {
  readonly store: PublicStoreDto;
  readonly query: StorefrontQuery;
  /** Schede con prodotti, su tutta la vetrina. */
  readonly categories: readonly {
    readonly category: StorefrontCategory;
    readonly count: number;
  }[];
  /** Occasioni con prodotti, su tutta la vetrina (M1-2). */
  readonly occasions: readonly {
    readonly occasion: CatalogOccasion;
    readonly count: number;
  }[];
  /** Prodotti che corrispondono ai filtri; tutti quelli online della fioreria. */
  readonly total: number;
  readonly onlineCount: number;
  readonly page: number;
  readonly pageCount: number;
  readonly items: readonly PublicStoreItemDto[];
  /** Riga «Destacados» (solo la prima pagina senza filtri). */
  readonly featured: readonly PublicStoreItemDto[];
  /** Il carrello di chi guarda, o null se è vuoto. */
  readonly cart: PublicCartSummaryDto | null;
}

export interface PublicStoreItemDetailDto {
  readonly store: PublicStoreDto;
  /** Il carrello di chi guarda, o null se è vuoto. */
  readonly cart: PublicCartSummaryDto | null;
  readonly item: PublicStoreItemDto & {
    /** Tutte le foto, nell'ordine del catalogo. */
    readonly photoIds: readonly string[];
    /** Di cosa è fatto un ramo (dalla sua distinta), senza costi. */
    readonly includes: readonly { readonly name: string; readonly quantity: number }[];
    /**
     * Solo per le piante con la specie: luce, acqua e cani e gatti dai nostri dati, con la fonte
     * (ADR-085). Null se mancano: la pagina allora non dice niente (mai «sicura»).
     */
    readonly species: AssistantSpeciesDto | null;
  };
}

/**
 * Fioreria con la tienda pubblicata, o null (slug sconosciuto, tienda non pubblicata, sospesa).
 * Interna al core (la usa anche l'ordine del cliente, `marketplace-orders.ts`).
 */
export async function publishedTenantId(slug: unknown): Promise<string | null> {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) return null;
  const rows = await getDb().$queryRaw<{ id: string | null }[]>`
    SELECT app_public_store_tenant(${slug}) AS id`;
  return rows[0]?.id ?? null;
}

async function withPublishedStore<T>(
  slug: unknown,
  fn: (tx: TransactionClient, tenantId: string) => Promise<T>,
): Promise<T | null> {
  const tenantId = await publishedTenantId(slug);
  if (!tenantId) return null;
  return withTenantContext(getDb(), { tenantId, userId: null }, (tx) => fn(tx, tenantId));
}

/** Prodotti che chi compra vede (e può ordinare): attivi, "visible en línea", di un tipo da vendere. */
export const onlineItemWhere = (tenantId: string) => ({
  tenantId,
  isOnline: true,
  status: 'ACTIVE' as const,
  type: { in: [...ONLINE_ITEM_TYPES] },
});

const ITEM_SELECT = {
  id: true,
  type: true,
  name: true,
  description: true,
  priceMinor: true,
  saleUnit: true,
  availability: true,
  colors: true,
  heightCm: true,
  widthCm: true,
  featuredAt: true,
} as const;

const COVER_PHOTO = {
  where: { status: 'ACTIVE' as const },
  orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  take: 1,
  select: { id: true },
};

function itemDto(item: {
  readonly id: string;
  readonly type: CatalogItemType;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number;
  readonly saleUnit: SaleUnit;
  readonly availability: Availability;
  readonly colors: string[];
  readonly heightCm: number | null;
  readonly widthCm: number | null;
  readonly featuredAt: Date | null;
  readonly photos: readonly { readonly id: string }[];
}): PublicStoreItemDto {
  const { photos, featuredAt, ...rest } = item;
  return { ...rest, photoId: photos[0]?.id ?? null, featured: featuredAt !== null };
}

/**
 * La testata pubblica della fioreria: chi è, dove, consegne, pagamenti e politiche. La usa anche
 * l'anteprima della fioreria (M1-2) nel suo contesto, dove il negozio può non essere ancora
 * configurato: senza la riga del negozio valgono i valori iniziali.
 */
export async function readStoreHeaderTx(
  tx: TransactionClient,
  tenantId: string,
): Promise<PublicStoreDto> {
  const [tenant, store, location, windows, feeTiers, openingHours] = await Promise.all([
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        slug: true,
        displayName: true,
        defaultLocale: true,
        currency: true,
        timezone: true,
        mode: true,
        contactPhone: true,
        deliveryClosedWeekdays: true,
        defaultDeliveryFeeMinor: true,
      },
    }),
    tx.onlineStore.findUnique({ where: { tenantId } }),
    tx.location.findFirst({
      where: { tenantId, isPrimary: true },
      select: {
        addressLine1: true,
        neighborhood: true,
        city: true,
        region: true,
        deliveryRadiusKm: true,
      },
    }),
    tx.deliveryWindow.findMany({
      where: { tenantId },
      orderBy: [{ startMinutes: 'asc' }, { endMinutes: 'asc' }],
      select: { startMinutes: true, endMinutes: true },
    }),
    tx.deliveryFeeTier.findMany({
      where: { tenantId },
      orderBy: { maxMeters: 'asc' },
      select: { maxMeters: true, feeMinor: true },
    }),
    loadOpeningHours(tx, tenantId),
  ]);
  const region = (code: string) => MX_REGIONS.find((item) => item.code === code)?.name ?? code;
  const today = todayInTimeZone(tenant.timezone);
  const firstDate = firstOrderableDate(today, {
    minLeadDays: store?.minLeadDays ?? 1,
    closedWeekdays: tenant.deliveryClosedWeekdays,
  });
  return {
    slug: tenant.slug,
    name: tenant.displayName,
    locale: resolveLocale(tenant.defaultLocale),
    currency: tenant.currency,
    isDemo: tenant.mode === 'DEMO',
    phone: tenant.contactPhone,
    logoId: store?.logoId ?? null,
    coverId: store?.coverId ?? null,
    description: store?.description ?? null,
    address: location
      ? {
          line: location.addressLine1,
          neighborhood: location.neighborhood,
          city: location.city,
          region: region(location.region),
        }
      : null,
    openingHours: hasOpeningHours(openingHours) ? openingHours : null,
    delivery: {
      windows: windows.map((window) => ({
        start: formatTimeOfDay(window.startMinutes),
        end: formatTimeOfDay(window.endMinutes),
      })),
      closedWeekdays: tenant.deliveryClosedWeekdays,
      defaultFeeMinor: tenant.defaultDeliveryFeeMinor,
      feeTiers: feeTiers.map((tier) => ({
        maxKm: tier.maxMeters / 1000,
        feeMinor: tier.feeMinor,
      })),
      radiusKm: location?.deliveryRadiusKm ?? null,
      feeSummary: deliveryFeeSummary({
        defaultFeeMinor: tenant.defaultDeliveryFeeMinor,
        tierFeesMinor: feeTiers.map((tier) => tier.feeMinor),
      }),
      firstDate: firstDate ? toIsoDate(firstDate) : null,
      today: toIsoDate(today),
    },
    paymentMethods: (store?.paymentMethods ?? []) as StorePaymentMethod[],
    paymentInstructions: store?.paymentInstructions ?? null,
    ordersEnabled: store?.ordersEnabled ?? false,
    policies: {
      changes: store?.policyChanges ?? null,
      cancellations: store?.policyCancellations ?? null,
      substitutions: store?.policySubstitutions ?? null,
    },
  };
}

/** La testata della fioreria (pagine del prodotto, del modulo d'ordine, prodotto tolto). */
export async function getPublicStore(slug: unknown): Promise<PublicStoreDto | null> {
  return withPublishedStore(slug, (tx, tenantId) => readStoreHeaderTx(tx, tenantId));
}

/**
 * Le righe leggere di tutti i prodotti online e i dettagli dei soli prodotti da mostrare. La usa
 * anche l'anteprima della fioreria (M1-2), nel contesto della fioreria.
 */
export async function readStorefrontTx(
  tx: TransactionClient,
  tenantId: string,
  query: StorefrontQuery,
) {
  const rows = await tx.catalogItem.findMany({
    where: onlineItemWhere(tenantId),
    select: {
      id: true,
      type: true,
      name: true,
      priceMinor: true,
      availability: true,
      featuredAt: true,
      occasions: true,
    },
  });
  const plan = planStorefront(rows, query);
  const ids = [...plan.featuredIds, ...plan.itemIds];
  const details =
    ids.length === 0
      ? []
      : await tx.catalogItem.findMany({
          where: { ...onlineItemWhere(tenantId), id: { in: ids } },
          select: { ...ITEM_SELECT, photos: COVER_PHOTO },
        });
  const byId = new Map(details.map((item) => [item.id, itemDto(item)]));
  const pick = (list: readonly string[]) =>
    list.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  return {
    categories: plan.categories,
    occasions: plan.occasions,
    total: plan.total,
    onlineCount: rows.length,
    page: plan.page,
    pageCount: plan.pageCount,
    items: pick(plan.itemIds),
    featured: pick(plan.featuredIds),
  };
}

/** Il carrello ai prezzi di oggi, solo con i prodotti ancora ordinabili (non esauriti). */
async function readCartSummaryTx(
  tx: TransactionClient,
  tenantId: string,
  cart: readonly CartLine[],
): Promise<PublicCartSummaryDto | null> {
  if (cart.length === 0) return null;
  const items = await tx.catalogItem.findMany({
    where: {
      ...onlineItemWhere(tenantId),
      availability: { not: 'OUT_OF_STOCK' },
      id: { in: cart.map((line) => line.itemId) },
    },
    select: { id: true, priceMinor: true },
  });
  const prices = new Map(items.map((item) => [item.id, item.priceMinor]));
  const valid = cart.filter((line) => prices.has(line.itemId));
  if (valid.length === 0) return null;
  return {
    lines: valid.length,
    units: valid.reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor: valid.reduce((sum, line) => sum + prices.get(line.itemId)! * line.quantity, 0),
  };
}

/** La vetrina della fioreria: testata e prodotti della scheda, ricerca, ordine e pagina scelti. */
export async function getPublicStorefront(
  slug: unknown,
  rawQuery: unknown,
  options: { readonly cart?: readonly CartLine[] } = {},
): Promise<PublicStorefrontDto | null> {
  const query = parseStorefrontQuery(rawQuery);
  return withPublishedStore(slug, async (tx, tenantId) => {
    const [store, catalog, cart] = await Promise.all([
      readStoreHeaderTx(tx, tenantId),
      readStorefrontTx(tx, tenantId, query),
      readCartSummaryTx(tx, tenantId, options.cart ?? []),
    ]);
    return { store, query, ...catalog, cart };
  });
}

/**
 * Un prodotto della vetrina con le foto, di cosa è fatto e (per le piante) la cura; null se non è
 * online. La usa anche l'anteprima della fioreria (M1-2), nel suo contesto.
 */
export async function readStoreItemTx(
  tx: TransactionClient,
  tenantId: string,
  itemId: string,
  cartLines: readonly CartLine[],
): Promise<PublicStoreItemDetailDto | null> {
  const item = await tx.catalogItem.findFirst({
    where: { ...onlineItemWhere(tenantId), id: itemId },
    select: {
      ...ITEM_SELECT,
      photos: {
        where: { status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      },
      canonicalFlower: { select: FLOWER_SELECT },
      recipe: {
        select: {
          lines: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: { quantity: true, ingredient: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!item) return null;
  const [store, cart] = await Promise.all([
    readStoreHeaderTx(tx, tenantId),
    readCartSummaryTx(tx, tenantId, cartLines),
  ]);
  const { recipe, canonicalFlower, ...rest } = item;
  const species =
    item.type === 'PLANT' && canonicalFlower ? speciesDto(canonicalFlower, store.locale) : null;
  return {
    store,
    cart,
    item: {
      ...itemDto(rest),
      photoIds: rest.photos.map((photo) => photo.id),
      includes: (recipe?.lines ?? []).map((line) => ({
        name: line.ingredient.name,
        quantity: line.quantity,
      })),
      // Senza dati di cura non si dice niente (né «tossica» né «sicura»).
      species: species?.care ? species : null,
    },
  };
}

/** Un prodotto della pagina, con le foto e (per i ramos) di cosa è fatto. */
export async function getPublicStoreItem(
  slug: unknown,
  itemId: unknown,
  options: { readonly cart?: readonly CartLine[] } = {},
): Promise<PublicStoreItemDetailDto | null> {
  if (!isUuid(itemId)) return null;
  return withPublishedStore(slug, (tx, tenantId) =>
    readStoreItemTx(tx, tenantId, itemId, options.cart ?? []),
  );
}

/** Foto di un prodotto visibile della pagina (`thumb` = miniatura). */
export async function getPublicStoreItemPhoto(
  slug: unknown,
  itemId: unknown,
  photoId: unknown,
  size: 'full' | 'thumb',
): Promise<StoredImage | null> {
  if (!isUuid(itemId) || !isUuid(photoId)) return null;
  const photo = await withPublishedStore(slug, (tx, tenantId) =>
    tx.catalogItemPhoto.findFirst({
      where: {
        id: photoId,
        tenantId,
        catalogItemId: itemId,
        status: 'ACTIVE',
        catalogItem: onlineItemWhere(tenantId),
      },
      select: { storageKey: true, thumbKey: true, contentType: true },
    }),
  );
  if (!photo) return null;
  try {
    return await readStoredImage(
      size === 'thumb' ? photo.thumbKey : photo.storageKey,
      photo.contentType,
      'CatalogItemPhoto',
    );
  } catch (error) {
    // File mancante nell'archivio (già registrato): per il cliente la foto semplicemente non c'è.
    if (error instanceof NotFoundError) return null;
    logger.error({ err: error }, 'tienda pública: errore nella lettura di una foto');
    return null;
  }
}

/** Logo o copertina di una tienda pubblicata; l'ID deve essere quello attuale. */
export async function getPublicStoreImage(
  slug: unknown,
  kind: unknown,
  imageId: unknown,
): Promise<StoredImage | null> {
  if (!isStoreImageKind(kind) || !isUuid(imageId)) return null;
  const key = await withPublishedStore(slug, async (tx, tenantId) => {
    const store = await tx.onlineStore.findUniqueOrThrow({ where: { tenantId } });
    if (kind === 'LOGO') return store.logoId === imageId ? store.logoKey : null;
    return store.coverId === imageId ? store.coverKey : null;
  });
  if (!key) return null;
  try {
    return await readStoredImage(key, 'image/jpeg', 'OnlineStore');
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    logger.error({ err: error }, 'tienda pública: errore nella lettura del logo o della copertina');
    return null;
  }
}
