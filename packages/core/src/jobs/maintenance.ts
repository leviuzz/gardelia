/**
 * Manutenzione giornaliera della piattaforma (fase 0): porta a EXPIRED i preventivi inviati oltre
 * la validità e gli inviti scaduti, in tutte le fiorerie, con la funzione SQL `app_expire_overdue`
 * (migrazione `expire_overdue`); cancella le coordinate avute da Google da più di 30 giorni
 * (`app_purge_place_coordinates`, regole di Google Places, ADR-059). Le pagine mostrano già lo stato effettivo calcolato in lettura:
 * questo lavoro rende il dato salvato coerente (filtri, report, esportazioni).
 *
 * La chiamano Vercel Cron (una volta al giorno alle 9 del Messico, `/api/internal/maintenance`,
 * insieme alla promo delle date speciali) e, fuori da Vercel, il ciclo nel processo del server. È
 * idempotente: una seconda esecuzione non trova nulla.
 */
import { getDb } from '@floral/db';
import { logger } from '../logger';
import { refreshStoreCoordinates } from '../public-directory';

export interface MaintenanceResult {
  readonly quotesExpired: number;
  readonly invitationsExpired: number;
  /** Indirizzi, sedi e ordini di cui si sono cancellate le coordinate scadute. */
  readonly coordinatesPurged: number;
  /** Tiendas pubblicate con le coordinate richieste di nuovo a Google (ADR-066). */
  readonly storePlacesRefreshed: number;
}

export async function runDailyMaintenance(): Promise<MaintenanceResult> {
  const rows = await getDb().$queryRaw<{ quotes_expired: number; invitations_expired: number }[]>`
    SELECT quotes_expired, invitations_expired FROM app_expire_overdue()`;
  const row = rows[0];
  // Prima si rinnovano le coordinate delle tiendas (a 25 giorni), poi si cancellano le scadute.
  const storePlacesRefreshed = await refreshStoreCoordinates();
  const purged = await getDb().$queryRaw<
    {
      addresses_purged: number;
      locations_purged: number;
      orders_purged: number;
      buyer_addresses_purged: number;
    }[]
  >`SELECT addresses_purged, locations_purged, orders_purged, buyer_addresses_purged
    FROM app_purge_place_coordinates()`;
  const purge = purged[0];
  const result: MaintenanceResult = {
    quotesExpired: row?.quotes_expired ?? 0,
    invitationsExpired: row?.invitations_expired ?? 0,
    coordinatesPurged:
      (purge?.addresses_purged ?? 0) +
      (purge?.locations_purged ?? 0) +
      (purge?.orders_purged ?? 0) +
      (purge?.buyer_addresses_purged ?? 0),
    storePlacesRefreshed,
  };
  logger.info(result, 'manutenzione giornaliera completata');
  return result;
}

/** Ogni quanto gira la manutenzione nel processo (fuori da Vercel). */
export const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
