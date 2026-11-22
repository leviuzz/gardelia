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

/** Host dell'indirizzo canonico dell'app (`APP_URL`); `null` se manca o non è un indirizzo. */
export function canonicalHost(appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  try {
    return new URL(appUrl).host;
  } catch {
    return null;
  }
}

/** Esito di un avvio, per il log (nessun dato sensibile). */
export interface DrainKickResult {
  readonly ok: boolean;
  /** Stato HTTP dell'ultima risposta. */
  readonly status: number;
  readonly reason?: 'rejected' | 'redirect_not_allowed' | 'too_many_redirects';
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Chiama la funzione che svuota la coda, con il segreto. Un dominio del progetto può rimandare a un
 * altro (es. `gardelia.vercel.app` → `gardelia-staging.vercel.app`, rimando configurato su
 * Vercel): `fetch` lo seguirebbe togliendo il segreto, e l'avvio fallirebbe. Lo si segue quindi a
 * mano, una volta sola e solo verso l'indirizzo canonico dell'app (host di `APP_URL`, in https):
 * un rimando verso qualunque altro sito non riceve il segreto.
 */
export async function postAiDrain(
  url: URL,
  secret: string,
  appHost: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<DrainKickResult> {
  const post = (target: URL) =>
    fetchImpl(target, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });

  let response = await post(url);
  if (REDIRECT_STATUSES.has(response.status)) {
    const next = redirectTarget(response, url);
    await response.body?.cancel();
    if (!next || next.protocol !== 'https:' || appHost === null || next.host !== appHost) {
      return { ok: false, status: response.status, reason: 'redirect_not_allowed' };
    }
    response = await post(next);
    if (REDIRECT_STATUSES.has(response.status)) {
      await response.body?.cancel();
      return { ok: false, status: response.status, reason: 'too_many_redirects' };
    }
  }
  return response.ok
    ? { ok: true, status: response.status }
    : { ok: false, status: response.status, reason: 'rejected' };
}

function redirectTarget(response: Response, from: URL): URL | null {
  const location = response.headers.get('location');
  if (!location) return null;
  try {
    return new URL(location, from);
  } catch {
    return null;
  }
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
  const appHost = canonicalHost(config.APP_URL);
  after(async () => {
    try {
      const result = await postAiDrain(url, secret, appHost);
      if (!result.ok) {
        logger.warn({ status: result.status, reason: result.reason }, 'avvio dei job AI rifiutato');
      }
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
