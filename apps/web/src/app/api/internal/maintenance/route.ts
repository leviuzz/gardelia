/**
 * Manutenzione giornaliera (fase 0): Vercel Cron la chiama una volta al giorno, poco dopo la
 * mezzanotte del Messico. Porta a EXPIRED preventivi e inviti scaduti di tutte le fiorerie
 * (`runDailyMaintenance`, core). Protetta da `CRON_SECRET`; senza segreto valido risponde 404
 * (non rivela che esiste). Idempotente: chiamarla due volte non fa danni.
 */
import { logger, runDailyMaintenance } from '@floral/core';
import { aiConfig } from '@floral/core/config';
import { isAuthorizedInternalRequest } from '@/lib/internal-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  if (!isAuthorizedInternalRequest(request.headers.get('authorization'), aiConfig().CRON_SECRET)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    return Response.json(await runDailyMaintenance());
  } catch (error) {
    logger.error({ err: error }, 'manutenzione giornaliera non riuscita');
    return Response.json({ status: 'error' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
