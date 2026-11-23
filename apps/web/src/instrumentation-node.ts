/**
 * Avvio del server Node.js (caricato da `instrumentation.ts` solo nel runtime Node, così
 * il bundle Edge non include moduli Node).
 *  - Controlla TUTTA la configurazione (web e piattaforma) prima di ogni altra cosa: se qualcosa
 *    manca o non torna, l'app non parte ed elenca tutti i problemi insieme.
 *  - Verifica che il ruolo database dell'app sia soggetto alla Row-Level Security: in
 *    produzione l'app si rifiuta di partire con un ruolo superuser/BYPASSRLS.
 *  - Anteprime AI (ADR-025) e scontorno delle foto (ADR-033): valida provider e archivio e
 *    avvia il worker in questo processo; su Vercel (motore `serverless`, ADR-037) collega invece
 *    l'accodamento all'avvio della funzione che svuota la coda.
 *  - Manutenzione giornaliera (scadenze) e promo delle date speciali (ADR-047): ciclo nel
 *    processo; su Vercel le fa Vercel Cron.
 */
import { checkRlsSafety, getDb, onSystemContext } from '@floral/db';
import {
  createAiProviderFromEnv,
  createBackgroundRemoverFromEnv,
  createStorageFromEnv,
  logger,
  MAINTENANCE_INTERVAL_MS,
  onAiJobQueued,
  getMailer,
  runDailyMaintenance,
  runOccasionPromos,
  startAiWorker,
} from '@floral/core';
import { aiConfig } from '@floral/core/config';
import { kickAiDrain } from './lib/ai-kick';
import { assertConfiguration } from './lib/config-check';
import { serverEnv } from './lib/env';
import { orderMailDeps } from './lib/order-mail';
import { startupRetryDelayMs } from './lib/startup-retry';
import {
  reportRequestError,
  type ErroredRequest,
  type ErroredRequestContext,
} from './lib/request-errors';

/** Errori non gestiti delle richieste → log strutturato (vedi lib/request-errors.ts). */
export function reportNodeRequestError(
  error: unknown,
  request: ErroredRequest,
  context: ErroredRequestContext,
): void {
  reportRequestError(logger, error, request, context);
}

export async function registerNode(): Promise<void> {
  assertConfiguration();
  onSystemContext(({ reason }) => logger.info({ reason }, 'contesto di sistema (bypass RLS)'));
  // Errore di configurazione dei provider (es. modello fal non provato) = l'app non parte.
  createAiProviderFromEnv();
  await verifyDatabaseThenStartWorker(1);
}

/**
 * Controllo del ruolo database e poi avvio del worker AI. Se il database non risponde ancora
 * (riavvio contemporaneo, rete), non ci si arrende: nuovi tentativi in background con attesa
 * crescente, così il worker parte appena il database torna, senza riavviare l'app.
 */
async function verifyDatabaseThenStartWorker(attempt: number): Promise<void> {
  let report: Awaited<ReturnType<typeof checkRlsSafety>>;
  try {
    report = await checkRlsSafety(getDb());
  } catch (error) {
    const retryInMs = startupRetryDelayMs(attempt);
    logger.error(
      { err: error, attempt, retryInMs },
      'database non raggiungibile all’avvio: nuovo tentativo più tardi',
    );
    setTimeout(() => void verifyDatabaseThenStartWorker(attempt + 1), retryInMs).unref();
    return;
  }
  if (!report.rlsEffective) {
    const message = `Il ruolo database "${report.role}" può aggirare la Row-Level Security (superuser, BYPASSRLS o proprietario delle tabelle). Configura DATABASE_URL con il ruolo applicativo (vedi docs/ARCHITECTURE.md).`;
    if (process.env.NODE_ENV === 'production') {
      // Al primo tentativo l'avvio fallisce; più tardi (database tornato) si chiude il processo.
      if (attempt === 1) throw new Error(message);
      logger.fatal(message);
      process.exit(1);
    }
    logger.warn(message);
  }
  if (attempt > 1) logger.info({ attempt }, 'database raggiungibile: avvio completato');
  startAiWorkerIfConfigured();
  startMaintenanceLoopIfInline();
}

/**
 * Manutenzione giornaliera (scadenze di preventivi e inviti) e promo delle date speciali fuori da
 * Vercel: una volta poco dopo l'avvio e poi ogni 6 ore, nel processo. Su Vercel le chiama Vercel
 * Cron (`/api/internal/maintenance`, che fa entrambe le cose). Le pagine mostrano già lo
 * stato effettivo: un'esecuzione saltata non cambia ciò che vede l'utente; la promo non manda mai
 * due volte la stessa email.
 */
function startMaintenanceLoopIfInline(): void {
  if (aiConfig().AI_WORKER_MODE === 'serverless') return;
  const state = globalThis as { __floralMaintenance?: unknown };
  if (state.__floralMaintenance) return;
  const run = () => {
    runDailyMaintenance(orderMailDeps()).catch((error: unknown) =>
      logger.error({ err: error }, 'manutenzione giornaliera non riuscita'),
    );
    const env = serverEnv();
    runOccasionPromos({
      mailer: getMailer(),
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
    }).catch((error: unknown) =>
      logger.error({ err: error }, 'promo delle date speciali non riuscita'),
    );
  };
  setTimeout(run, 30_000).unref();
  state.__floralMaintenance = setInterval(run, MAINTENANCE_INTERVAL_MS).unref();
}

function startAiWorkerIfConfigured(): void {
  const provider = createAiProviderFromEnv();
  const remover = createBackgroundRemoverFromEnv();
  if (!provider && !remover) return;
  createStorageFromEnv();
  const state = globalThis as { __floralAiWorker?: unknown };
  if (state.__floralAiWorker) return;
  if (aiConfig().AI_WORKER_MODE === 'serverless') {
    // Vercel (ADR-037): nessun processo sempre acceso. Ogni job accodato avvia la funzione che
    // svuota la coda; le pagine in attesa e il cron la riavviano se un job resta indietro.
    state.__floralAiWorker = onAiJobQueued(kickAiDrain);
    logger.info({ provider: provider?.id ?? null }, 'job AI su funzioni: avvio a ogni accodamento');
    return;
  }
  state.__floralAiWorker = startAiWorker();
  logger.info(
    {
      provider: provider?.id ?? null,
      model: provider?.model ?? null,
      simulated: provider?.simulated ?? null,
      cutoutModel: remover?.model ?? null,
    },
    'worker AI avviato (anteprime e scontorni)',
  );
}
