/**
 * Manutenzione giornaliera della piattaforma (fase 0): porta a EXPIRED i preventivi inviati oltre
 * la validità e gli inviti scaduti, in tutte le fiorerie, con la funzione SQL `app_expire_overdue`
 * (migrazione `expire_overdue`); cancella le coordinate avute da Google da più di 30 giorni
 * (`app_purge_place_coordinates`, regole di Google Places, ADR-059); chiude le bozze di import di
 * clienti dimenticate da più di un giorno e ne cancella il file (`app_close_stale_customer_imports`,
 * ADR-070); annulla gli ordini online che nessuna fioreria ha accettato in tempo e lo scrive a chi
 * compra (ADR-067); emette i cargos del mese di Floral Care (ADR-082), allunga le visite, chiude
 * i contratti finiti (ADR-075), ne cancella le foto 30 giorni dopo e riprova i resoconti rimasti
 * indietro (ADR-078). Le pagine
 * mostrano già lo stato effettivo calcolato in lettura: questo lavoro rende il dato salvato coerente
 * (filtri, report, esportazioni).
 *
 * La chiamano Vercel Cron (una volta al giorno alle 9 del Messico, `/api/internal/maintenance`,
 * insieme alla promo delle date speciali) e, fuori da Vercel, il ciclo nel processo del server. È
 * idempotente: una seconda esecuzione non trova nulla.
 */
import { getDb } from '@floral/db';
import { logger } from '../logger';
import { expireUnacceptedOrders, remindPendingOrders } from '../marketplace-orders';
import { purgeOrderMessagePhotos } from '../services/order-messages';
import { purgeDeletedTenants } from '../services/tenant-deletion';
import type { OrderMailDeps } from '../order-mail';
import { refreshStoreCoordinates } from '../public-directory';
import { closeStaleCustomerImports } from '../services/customer-import';
import { runCareMaintenance } from './care';

export interface MaintenanceResult {
  readonly quotesExpired: number;
  readonly invitationsExpired: number;
  /** Indirizzi, sedi e ordini di cui si sono cancellate le coordinate scadute. */
  readonly coordinatesPurged: number;
  /** Tiendas pubblicate con le coordinate richieste di nuovo a Google (ADR-066). */
  readonly storePlacesRefreshed: number;
  /** Bozze di import di clienti chiuse, con il file cancellato (ADR-070). */
  readonly customerImportsClosed: number;
  /** Ordini online annullati perché nessuno li ha accettati in tempo. */
  readonly onlineOrdersExpired: number;
  /** Floral Care (ADR-082): cargos nati e contratti con mesi ancora da emettere. */
  readonly careChargesIssued: number;
  readonly careChargesPending: number;
  /** Floral Care (ADR-075): visite nuove (con posto o da riprogrammare) e contratti chiusi. */
  readonly careVisitsCreated: number;
  readonly careContractsEnded: number;
  /** Floral Care (ADR-084): accessi alla pagina del cliente chiusi (contratto finito da 30 giorni). */
  readonly carePortalAccessClosed: number;
  /** Floral Care (ADR-078): foto cancellate e resoconti mandati dal lavoro. */
  readonly carePhotosDeleted: number;
  readonly careEmailsSent: number;
  /** Floral Care (ADR-084): riassunti dei messaggi dei clienti mandati alle fiorerie. */
  readonly careMessageDigestsSent: number;
  /** Fiorerie cancellate davvero, 30 giorni dopo "Eliminar florería" (ADR-074). */
  readonly tenantsPurged: number;
  /** M3: promemoria alle fiorerie per gli ordini online che scadono prima del prossimo giro. */
  readonly onlineOrdersReminded: number;
  /** M3: foto dei messaggi degli ordini cancellate (30 giorni dopo la chiusura). */
  readonly orderMessagePhotosDeleted: number;
}

/** `mail`: per scrivere a chi compra quando il suo ordine scade (null nei test senza email). */
export async function runDailyMaintenance(
  mail: OrderMailDeps | null = null,
): Promise<MaintenanceResult> {
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
  const customerImportsClosed = await closeStaleCustomerImports();
  const onlineOrdersExpired = await expireUnacceptedOrders(mail);
  const onlineOrdersReminded = await remindPendingOrders(mail);
  const orderMessagePhotosDeleted = await purgeOrderMessagePhotos();
  const care = await runCareMaintenance(mail);
  const tenantsPurged = await purgeDeletedTenants();
  const result: MaintenanceResult = {
    quotesExpired: row?.quotes_expired ?? 0,
    invitationsExpired: row?.invitations_expired ?? 0,
    coordinatesPurged:
      (purge?.addresses_purged ?? 0) +
      (purge?.locations_purged ?? 0) +
      (purge?.orders_purged ?? 0) +
      (purge?.buyer_addresses_purged ?? 0),
    storePlacesRefreshed,
    customerImportsClosed,
    onlineOrdersExpired,
    careChargesIssued: care.chargesIssued,
    careChargesPending: care.chargesPending,
    careVisitsCreated: care.visitsScheduled + care.visitsToReschedule,
    careContractsEnded: care.contractsEnded,
    carePortalAccessClosed: care.portalAccessClosed,
    carePhotosDeleted: care.photosDeleted,
    careEmailsSent: care.emailsSent,
    careMessageDigestsSent: care.messageDigestsSent,
    tenantsPurged,
    onlineOrdersReminded,
    orderMessagePhotosDeleted,
  };
  logger.info(result, 'manutenzione giornaliera completata');
  return result;
}

/** Ogni quanto gira la manutenzione nel processo (fuori da Vercel). */
export const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
