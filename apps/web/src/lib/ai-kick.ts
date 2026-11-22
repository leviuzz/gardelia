import 'server-only';
import { after } from 'next/server';
import { logger } from '@floral/core';
import { aiConfig } from '@floral/core/config';

/** Funzione che svuota la coda dei job AI (motore `serverless`, ADR-037). */
export const AI_DRAIN_PATH = '/api/internal/ai/drain';
/** Mentre una pagina aspetta un job, al massimo un nuovo avvio ogni 15 s per istanza. */
export const WAITING_KICK_INTERVAL_MS = 15_000;

/** Pura: è passato abbastanza tempo dall'ultimo avvio "di controllo"? */
export function shouldKickAgain(
  lastKickAt: number,
  now: number,
  intervalMs = WAITING_KICK_INTERVAL_MS,
): boolean {
  return now - lastKickAt >= intervalMs;
}

/**
 * Avvia la funzione che svuota la coda dei job AI. Solo con il motore `serverless` (Vercel): in
 * locale e nei container i job li lavora il worker nel processo. Va chiamata dentro una richiesta
 * (usa `after`: la richiesta di avvio parte dopo la risposta all'utente).
 */
export function kickAiDrain(): void {
  const config = aiConfig();
  if (config.AI_WORKER_MODE !== 'serverless' || config.AI_PROVIDER === 'none') return;
  if (!config.CRON_SECRET || !config.APP_URL) return;
  const url = new URL(AI_DRAIN_PATH, config.APP_URL);
  const secret = config.CRON_SECRET;
  after(async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) logger.warn({ status: response.status }, 'avvio dei job AI rifiutato');
    } catch (error) {
      logger.warn({ err: error }, 'avvio dei job AI non riuscito: riproverà la pagina o il cron');
    }
  });
}

let lastWaitingKickAt = 0;

/**
 * Mentre una pagina mostra un job AI in coda o in corso, riavvia ogni tanto la coda: un job rimasto
 * a metà (funzione fermata) riparte senza aspettare il cron, che su Vercel Hobby gira di rado.
 */
export function kickAiDrainWhileWaiting(waiting: boolean): void {
  if (!waiting) return;
  const now = Date.now();
  if (!shouldKickAgain(lastWaitingKickAt, now)) return;
  lastWaitingKickAt = now;
  kickAiDrain();
}
