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
  STORE_LIMITS,
  formatTimeOfDay,
  isUuid,
  resolveLocale,
  type Availability,
  type CatalogItemType,
  type SaleUnit,
  type StorePaymentMethod,
  type SupportedLocale,
} from '@floral/domain';
import { NotFoundError } from './errors';
import { logger } from './logger';
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
  /** Dove si ritira (indirizzo della tienda principale), o null. */
  readonly address: {
    readonly line: string;
    readonly neighborhood: string | null;
    readonly city: string;
    readonly region: string;
  } | null;
  readonly delivery: {
    readonly windows: readonly { readonly start: string; readonly end: string }[];
    readonly closedWeekdays: readonly number[];
    /** Costo di consegna abituale (0 = da concordare o gratis: la pagina non promette nulla). */
    readonly defaultFeeMinor: number;
    readonly radiusKm: number | null;
  };
  readonly paymentMethods: readonly StorePaymentMethod[];
  readonly paymentInstructions: string | null;
  readonly items: readonly PublicStoreItemDto[];
}

export interface PublicStoreItemDetailDto {
  readonly store: Pick<
    PublicStoreDto,
    'slug' | 'name' | 'locale' | 'currency' | 'isDemo' | 'phone' | 'paymentMethods'
  >;
  readonly item: PublicStoreItemDto & {
    /** Tutte le foto, nell'ordine del catalogo. */
    readonly photoIds: readonly string[];
    /** Di cosa è fatto un ramo (dalla sua distinta), senza costi. */
    readonly includes: readonly { readonly name: string; readonly quantity: number }[];
  };
}

/** Fioreria con la tienda pubblicata, o null (slug sconosciuto, tienda non pubblicata, sospesa). */
async function publishedTenantId(slug: unknown): Promise<string | null> {
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

const onlineItemWhere = (tenantId: string) => ({
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
} as const;

async function readStoreHeader(tx: TransactionClient, tenantId: string) {
  const [tenant, store] = await Promise.all([
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        slug: true,
        displayName: true,
        defaultLocale: true,
        currency: true,
        mode: true,
        contactPhone: true,
        deliveryClosedWeekdays: true,
        defaultDeliveryFeeMinor: true,
      },
    }),
    tx.onlineStore.findUniqueOrThrow({ where: { tenantId } }),
  ]);
  return {
    tenant,
    store,
    header: {
      slug: tenant.slug,
      name: tenant.displayName,
      locale: resolveLocale(tenant.defaultLocale),
      currency: tenant.currency,
      isDemo: tenant.mode === 'DEMO',
      phone: tenant.contactPhone,
      paymentMethods: store.paymentMethods as StorePaymentMethod[],
    },
  };
}

/** La pagina della fioreria: dati pubblici e prodotti visibili. */
export async function getPublicStore(slug: unknown): Promise<PublicStoreDto | null> {
  return withPublishedStore(slug, async (tx, tenantId) => {
    const { tenant, store, header } = await readStoreHeader(tx, tenantId);
    const [location, windows, items] = await Promise.all([
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
      tx.catalogItem.findMany({
        where: onlineItemWhere(tenantId),
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: STORE_LIMITS.publicItems,
        select: {
          ...ITEM_SELECT,
          photos: {
            where: { status: 'ACTIVE' },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            take: 1,
            select: { id: true },
          },
        },
      }),
    ]);
    const region = (code: string) => MX_REGIONS.find((item) => item.code === code)?.name ?? code;
    return {
      ...header,
      description: store.description,
      address: location
        ? {
            line: location.addressLine1,
            neighborhood: location.neighborhood,
            city: location.city,
            region: region(location.region),
          }
        : null,
      delivery: {
        windows: windows.map((window) => ({
          start: formatTimeOfDay(window.startMinutes),
          end: formatTimeOfDay(window.endMinutes),
        })),
        closedWeekdays: tenant.deliveryClosedWeekdays,
        defaultFeeMinor: tenant.defaultDeliveryFeeMinor,
        radiusKm: location?.deliveryRadiusKm ?? null,
      },
      paymentInstructions: store.paymentInstructions,
      items: items.map(({ photos, ...item }) => ({ ...item, photoId: photos[0]?.id ?? null })),
    };
  });
}

/** Un prodotto della pagina, con le foto e (per i ramos) di cosa è fatto. */
export async function getPublicStoreItem(
  slug: unknown,
  itemId: unknown,
): Promise<PublicStoreItemDetailDto | null> {
  if (!isUuid(itemId)) return null;
  return withPublishedStore(slug, async (tx, tenantId) => {
    const item = await tx.catalogItem.findFirst({
      where: { ...onlineItemWhere(tenantId), id: itemId },
      select: {
        ...ITEM_SELECT,
        photos: {
          where: { status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
        },
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
    const { header } = await readStoreHeader(tx, tenantId);
    const { photos, recipe, ...rest } = item;
    return {
      store: header,
      item: {
        ...rest,
        photoId: photos[0]?.id ?? null,
        photoIds: photos.map((photo) => photo.id),
        includes: (recipe?.lines ?? []).map((line) => ({
          name: line.ingredient.name,
          quantity: line.quantity,
        })),
      },
    };
  });
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
