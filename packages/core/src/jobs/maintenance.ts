/**
 * Manutenzione giornaliera della piattaforma (fase 0): porta a EXPIRED i preventivi inviati oltre
 * la validità e gli inviti scaduti, in tutte le fiorerie, con la funzione SQL `app_expire_overdue`
 * (migrazione `expire_overdue`). Le pagine mostrano già lo stato effettivo calcolato in lettura:
 * questo lavoro rende il dato salvato coerente (filtri, report, esportazioni).
 *
 * La chiamano Vercel Cron (una volta al giorno alle 9 del Messico, `/api/internal/maintenance`,
 * insieme alla promo delle date speciali) e, fuori da Vercel, il ciclo nel processo del server. È
 * idempotente: una seconda esecuzione non trova nulla.
 */
import { getDb } from '@floral/db';
import { logger } from '../logger';

export interface MaintenanceResult {
  readonly quotesExpired: number;
  readonly invitationsExpired: number;
}

export async function runDailyMaintenance(): Promise<MaintenanceResult> {
  const rows = await getDb().$queryRaw<{ quotes_expired: number; invitations_expired: number }[]>`
    SELECT quotes_expired, invitations_expired FROM app_expire_overdue()`;
  const row = rows[0];
  const result: MaintenanceResult = {
    quotesExpired: row?.quotes_expired ?? 0,
    invitationsExpired: row?.invitations_expired ?? 0,
  };
  logger.info(result, 'manutenzione giornaliera completata');
  return result;
}

/** Ogni quanto gira la manutenzione nel processo (fuori da Vercel). */
export const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
