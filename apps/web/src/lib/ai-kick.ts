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

/** Solo un nome di host (es. `gardelia.vercel.app`): niente protocollo, porta, percorso o spazi. */
const HOST_NAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;

/**
 * Indirizzo della funzione che svuota la coda. La richiesta porta il segreto `CRON_SECRET`: su
 * Vercel va quindi sempre al dominio di produzione del progetto stesso
 * (`VERCEL_PROJECT_PRODUCTION_URL`, impostata da Vercel), mai ad `APP_URL`, che se sbagliato (un
 * altro progetto, un refuso) manderebbe il segreto a un sito non nostro. Se quel dominio non è un
 * nome di host valido non si avvia nulla (ci pensano le pagine in attesa e il cron). Fuori da
 * Vercel si usa `APP_URL`.
 */
export function drainUrl(config: {
  readonly APP_URL?: string | undefined;
  readonly VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
}): URL | null {
  const productionHost = config.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionHost !== undefined) {
    return HOST_NAME.test(productionHost)
      ? new URL(AI_DRAIN_PATH, `https://${productionHost}`)
      : null;
  }
  return config.APP_URL ? new URL(AI_DRAIN_PATH, config.APP_URL) : null;
}

/**
 * Avvia la funzione che svuota la coda dei job AI. Solo con il motore `serverless` (Vercel): in
 * locale e nei container i job li lavora il worker nel processo. Va chiamata dentro una richiesta
 * (usa `after`: la richiesta di avvio parte dopo la risposta all'utente).
 */
export function kickAiDrain(): void {
  const config = aiConfig();
  if (config.AI_WORKER_MODE !== 'serverless' || config.AI_PROVIDER === 'none') return;
  const url = drainUrl(config);
  if (!config.CRON_SECRET || !url) return;
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
