/**
 * Lavori giornalieri della piattaforma: Vercel Cron li chiama una volta al giorno, alle 9 del
 * Messico (`vercel.json`; col piano Hobby l'ora è indicativa, dentro l'ora indicata).
 *  1. Manutenzione (fase 0): porta a EXPIRED preventivi e inviti scaduti di tutte le fiorerie
 *     (`runDailyMaintenance`, core). Le pagine mostrano già lo stato effettivo: l'ora non conta.
 *  2. Promo delle date speciali (ADR-047): le email con lo sconto ai clienti (`runOccasionPromos`);
 *     per questo il cron gira di mattina e non a mezzanotte.
 * I due lavori sono indipendenti: se uno fallisce l'altro gira lo stesso. Protetta da
 * `CRON_SECRET`; senza segreto valido risponde 404 (non rivela che esiste). Idempotente:
 * chiamarla due volte non fa danni e non rimanda email.
 */
import {
  getMailer,
  logger,
  runDailyMaintenance,
  runOccasionPromos,
  type MaintenanceResult,
  type OccasionPromoRunResult,
} from '@floral/core';
import { aiConfig } from '@floral/core/config';
import { serverEnv } from '@/lib/env';
import { isAuthorizedInternalRequest } from '@/lib/internal-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  if (!isAuthorizedInternalRequest(request.headers.get('authorization'), aiConfig().CRON_SECRET)) {
    return new Response('Not found', { status: 404 });
  }
  let maintenance: MaintenanceResult | null = null;
  let promos: OccasionPromoRunResult | null = null;
  try {
    maintenance = await runDailyMaintenance();
  } catch (error) {
    logger.error({ err: error }, 'manutenzione giornaliera non riuscita');
  }
  try {
    const env = serverEnv();
    promos = await runOccasionPromos({
      mailer: getMailer(),
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
    });
  } catch (error) {
    logger.error({ err: error }, 'promo delle date speciali non riuscita');
  }
  if (!maintenance || !promos) return Response.json({ status: 'error' }, { status: 500 });
  return Response.json({ ...maintenance, promos });
}

export const GET = handle;
export const POST = handle;
