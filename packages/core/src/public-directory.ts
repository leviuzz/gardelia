/**
 * Ricerca delle fiorerie per chi compra (marketplace, blocco C3, ADR-066). Chi cerca non ha
 * sessione: l'elenco delle tiendas pubblicate arriva dalla funzione SQL
 * `app_public_store_directory()` (solo fiorerie attive con la tienda pubblicata, solo dati che la
 * loro pagina mostra già). Le regole su raggio, distanza e città sono nel dominio.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  directoryCities,
  directoryFee,
  firstOrderableDate,
  normalizeOccasions,
  occasionFromSlug,
  rankStoresForAddress,
  readCoordinates,
  toIsoDate,
  todayInTimeZone,
  type CatalogOccasion,
  type DeliveryFeeSummary,
  type DirectoryStore,
} from '@floral/domain';
import { logger } from './logger';
import { PlacesUnavailableError, getPlacesProvider } from './places';

interface DirectoryRow {
  slug: string;
  name: string;
  neighborhood: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinates_at: Date | null;
  delivery_radius_km: number | null;
  logo_id: string | null;
  online_items: number;
  orders_enabled: boolean;
  min_lead_days: number;
  closed_weekdays: number[];
  timezone: string;
  currency: string;
  default_fee_minor: number;
  fee_tiers: { maxMeters: number; feeMinor: number }[];
  occasions: string[];
}

export interface DirectoryStoreDto {
  readonly slug: string;
  readonly name: string;
  readonly neighborhood: string | null;
  readonly city: string | null;
  readonly logoId: string | null;
  readonly onlineItems: number;
  /** Distanza dall'indirizzo cercato (km), o null se la posizione della tienda non si conosce. */
  readonly distanceKm: number | null;
  /**
   * Si ordina dalla pagina (ordini online accesi e un giorno libero nei prossimi 60), altrimenti
   * solo su WhatsApp (M1-2).
   */
  readonly ordersOnline: boolean;
  /** Primo giorno di consegna e oggi, nell'ora della fioreria (`YYYY-MM-DD`). */
  readonly firstDate: string | null;
  readonly today: string;
  /** Costo per l'indirizzo cercato (`exact`) o il riassunto della vetrina. */
  readonly fee: { readonly summary: DeliveryFeeSummary; readonly exact: boolean };
  readonly currency: string;
  /** Occasioni dei prodotti online (M1-2). */
  readonly occasions: readonly CatalogOccasion[];
}

export interface StoreSearchResultDto {
  /** Consegnano all'indirizzo, dalla più vicina. */
  readonly nearby: readonly DirectoryStoreDto[];
  /** Stessa città, posizione sconosciuta. */
  readonly sameCity: readonly DirectoryStoreDto[];
}

interface Listed extends DirectoryStore {
  readonly slug: string;
  readonly name: string;
  readonly neighborhood: string | null;
  readonly logoId: string | null;
  readonly onlineItems: number;
  readonly ordersOnline: boolean;
  readonly firstDate: string | null;
  readonly today: string;
  readonly currency: string;
  readonly defaultFeeMinor: number;
  readonly feeTiers: readonly { readonly maxMeters: number; readonly feeMinor: number }[];
  readonly occasions: readonly CatalogOccasion[];
}

async function readDirectory(): Promise<Listed[]> {
  const rows = await getDb().$queryRaw<DirectoryRow[]>`SELECT * FROM app_public_store_directory()`;
  return (
    rows
      // Una tienda rimasta senza prodotti visibili non serve a chi cerca.
      .filter((row) => row.online_items > 0)
      .map((row) => {
        // Le stesse regole della testata della vetrina (`public-store.ts`).
        const today = todayInTimeZone(row.timezone);
        const first = firstOrderableDate(today, {
          minLeadDays: row.min_lead_days,
          closedWeekdays: row.closed_weekdays,
        });
        return {
          slug: row.slug,
          name: row.name,
          neighborhood: row.neighborhood,
          city: row.city,
          logoId: row.logo_id,
          onlineItems: row.online_items,
          latitude: row.latitude,
          longitude: row.longitude,
          coordinatesAt: row.coordinates_at,
          deliveryRadiusKm: row.delivery_radius_km,
          ordersOnline: row.orders_enabled && first !== null,
          firstDate: first ? toIsoDate(first) : null,
          today: toIsoDate(today),
          currency: row.currency,
          defaultFeeMinor: row.default_fee_minor,
          feeTiers: row.fee_tiers,
          occasions: normalizeOccasions(row.occasions),
        };
      })
  );
}

function toDto(store: Listed, distanceKm: number | null): DirectoryStoreDto {
  return {
    slug: store.slug,
    name: store.name,
    neighborhood: store.neighborhood,
    city: store.city,
    logoId: store.logoId,
    onlineItems: store.onlineItems,
    distanceKm,
    ordersOnline: store.ordersOnline,
    firstDate: store.firstDate,
    today: store.today,
    fee: directoryFee({
      tiers: store.feeTiers,
      defaultFeeMinor: store.defaultFeeMinor,
      distanceKm,
    }),
    currency: store.currency,
    occasions: store.occasions,
  };
}

/** Le tiendas con prodotti per l'occasione (nome dell'indirizzo, M1-2); tutte senza occasione. */
async function readDirectoryFor(occasionSlug: unknown): Promise<Listed[]> {
  const stores = await readDirectory();
  const occasion = occasionFromSlug(occasionSlug);
  return occasion ? stores.filter((store) => store.occasions.includes(occasion)) : stores;
}

/**
 * Tiendas per un indirizzo (coordinate dalla ricerca di Google, se c'è) e/o una città, e se
 * richiesta un'occasione (M1-2). Valori sbagliati si ignorano: senza coordinate valide resta la
 * città.
 */
export async function searchPublicStores(query: {
  readonly latitude?: unknown;
  readonly longitude?: unknown;
  readonly city?: unknown;
  readonly occasion?: unknown;
}): Promise<StoreSearchResultDto> {
  const near = readCoordinates(query.latitude, query.longitude);
  const city = typeof query.city === 'string' ? query.city.slice(0, 120) : null;
  if (!near && !city?.trim()) return { nearby: [], sameCity: [] };
  const ranked = rankStoresForAddress(
    await readDirectoryFor(query.occasion),
    { near, city },
    new Date(),
  );
  return {
    nearby: ranked.nearby.map((store) => toDto(store, store.distanceKm)),
    sameCity: ranked.sameCity.map((store) => toDto(store, null)),
  };
}

/**
 * Le città con almeno una tienda (per scegliere senza la ricerca dell'indirizzo); con
 * un'occasione, solo quelle con prodotti per l'occasione (M1-2).
 */
export async function listPublicStoreCities(occasionSlug?: unknown): Promise<string[]> {
  return directoryCities(await readDirectoryFor(occasionSlug));
}

/** Le occasioni con prodotti in almeno una tienda: le scorciatoie della home (M1-2). */
export async function listPublicStoreOccasions(): Promise<CatalogOccasion[]> {
  const stores = await readDirectory();
  return normalizeOccasions(stores.flatMap((store) => store.occasions));
}

/** Giorni dopo i quali le coordinate di una tienda si richiedono a Google (prima dei 30 permessi). */
const REFRESH_AFTER_DAYS = 25;
/** Richieste a Google al massimo per giro della manutenzione. */
const REFRESH_PER_RUN = 50;

/**
 * Manutenzione giornaliera: coordinate nuove per le tiendas pubblicate che le hanno vecchie o le
 * hanno perse, dal place ID salvato (permesso senza limiti, ADR-059). Senza la chiave di Google
 * non fa nulla; un errore di Google salta quella tienda e riprova il giorno dopo.
 */
export async function refreshStoreCoordinates(): Promise<number> {
  const provider = getPlacesProvider();
  if (!provider) return 0;
  const rows = await getDb().$queryRaw<
    { tenant_id: string; location_id: string; place_id: string }[]
  >`SELECT tenant_id, location_id, place_id FROM app_store_places_to_refresh(${REFRESH_AFTER_DAYS}, ${REFRESH_PER_RUN})`;
  let refreshed = 0;
  for (const row of rows) {
    try {
      const details = await provider.details({
        placeId: row.place_id,
        sessionToken: null,
        languageCode: 'es-MX',
      });
      if (!details?.coordinates) continue;
      await withTenantContext(getDb(), { tenantId: row.tenant_id, userId: null }, (tx) =>
        tx.location.updateMany({
          where: { id: row.location_id, tenantId: row.tenant_id, placeId: row.place_id },
          data: {
            latitude: details.coordinates!.latitude,
            longitude: details.coordinates!.longitude,
            coordinatesAt: new Date(),
          },
        }),
      );
      refreshed += 1;
    } catch (error) {
      if (!(error instanceof PlacesUnavailableError)) throw error;
      logger.warn({ tenantId: row.tenant_id }, 'tiendas: coordinate non aggiornate (Google)');
    }
  }
  return refreshed;
}

export interface SitemapEntryDto {
  readonly slug: string;
  /** Null per la vetrina stessa. */
  readonly itemId: string | null;
  readonly updatedAt: Date;
}

/** Righe della sitemap per vetrine e prodotti: le pagine fisse (home, fioristi) restano fuori. */
const SITEMAP_ROWS = 49_990;

/**
 * Vetrine pubblicate e loro prodotti online per la sitemap.xml (M1-2, ADR-087): la funzione SQL
 * `app_public_sitemap` dà solo fiorerie attive e pubblicate e prodotti online e attivi.
 */
export async function listSitemapEntries(): Promise<SitemapEntryDto[]> {
  const rows = await getDb().$queryRaw<
    { slug: string; item_id: string | null; updated_at: Date }[]
  >`SELECT slug, item_id, updated_at FROM app_public_sitemap(${SITEMAP_ROWS}::integer)`;
  // Una vetrina senza prodotti online sarebbe una pagina vuota per Google: resta fuori.
  const withItems = new Set(rows.filter((row) => row.item_id !== null).map((row) => row.slug));
  return rows
    .filter((row) => row.item_id !== null || withItems.has(row.slug))
    .map((row) => ({ slug: row.slug, itemId: row.item_id, updatedAt: row.updated_at }));
}
