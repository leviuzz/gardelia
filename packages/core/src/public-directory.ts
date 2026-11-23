/**
 * Ricerca delle fiorerie per chi compra (marketplace, blocco C3, ADR-066). Chi cerca non ha
 * sessione: l'elenco delle tiendas pubblicate arriva dalla funzione SQL
 * `app_public_store_directory()` (solo fiorerie attive con la tienda pubblicata, solo dati che la
 * loro pagina mostra già). Le regole su raggio, distanza e città sono nel dominio.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  directoryCities,
  rankStoresForAddress,
  readCoordinates,
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
}

export interface StoreSearchResultDto {
  /** Consegnano all'indirizzo, dalla più vicina. */
  readonly nearby: readonly DirectoryStoreDto[];
  /** Stessa città, posizione sconosciuta. */
  readonly sameCity: readonly DirectoryStoreDto[];
}

type Listed = DirectoryStore & Omit<DirectoryStoreDto, 'distanceKm'>;

async function readDirectory(): Promise<Listed[]> {
  const rows = await getDb().$queryRaw<DirectoryRow[]>`SELECT * FROM app_public_store_directory()`;
  return (
    rows
      // Una tienda rimasta senza prodotti visibili non serve a chi cerca.
      .filter((row) => row.online_items > 0)
      .map((row) => ({
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
      }))
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
  };
}

/**
 * Tiendas per un indirizzo (coordinate dalla ricerca di Google, se c'è) e/o una città. Valori
 * sbagliati si ignorano: senza coordinate valide resta la città.
 */
export async function searchPublicStores(query: {
  readonly latitude?: unknown;
  readonly longitude?: unknown;
  readonly city?: unknown;
}): Promise<StoreSearchResultDto> {
  const near = readCoordinates(query.latitude, query.longitude);
  const city = typeof query.city === 'string' ? query.city.slice(0, 120) : null;
  if (!near && !city?.trim()) return { nearby: [], sameCity: [] };
  const ranked = rankStoresForAddress(await readDirectory(), { near, city }, new Date());
  return {
    nearby: ranked.nearby.map((store) => toDto(store, store.distanceKm)),
    sameCity: ranked.sameCity.map((store) => toDto(store, null)),
  };
}

/** Le città con almeno una tienda (per scegliere senza la ricerca dell'indirizzo). */
export async function listPublicStoreCities(): Promise<string[]> {
  return directoryCities(await readDirectory());
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
