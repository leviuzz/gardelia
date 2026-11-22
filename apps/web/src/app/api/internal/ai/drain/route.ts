/**
 * Svuota la coda dei job AI (motore `serverless`, ADR-037). La chiamano: il server web appena
 * accoda un job, le pagine che aspettano un job (ogni tanto) e Vercel Cron come rete di sicurezza.
 * Protetta da `CRON_SECRET`; senza segreto valido risponde 404 (non rivela che esiste).
 * Risponde subito (202) e lavora dopo la risposta, entro la durata massima della funzione.
 */
import { after } from 'next/server';
import { drainAiQueue, logger } from '@floral/core';
import { aiConfig } from '@floral/core/config';
import { isAuthorizedInternalRequest } from '@/lib/internal-auth';

// Massimo del piano Hobby di Vercel; con Pro si può portare a 800.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BUDGET_MS = 290_000;

async function handle(request: Request): Promise<Response> {
  const config = aiConfig();
  if (!isAuthorizedInternalRequest(request.headers.get('authorization'), config.CRON_SECRET)) {
    return new Response('Not found', { status: 404 });
  }
  after(async () => {
    try {
      const result = await drainAiQueue({ budgetMs: BUDGET_MS });
      if (result.processed > 0) logger.info(result, 'coda dei job AI svuotata');
    } catch (error) {
      logger.error({ err: error }, 'svuotamento della coda dei job AI non riuscito');
    }
  });
  return new Response(null, { status: 202 });
}

export const GET = handle;
export const POST = handle;
