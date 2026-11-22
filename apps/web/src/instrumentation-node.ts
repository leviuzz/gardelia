/**
 * Avvio del server Node.js (caricato da `instrumentation.ts` solo nel runtime Node, così
 * il bundle Edge non include moduli Node).
 *  - Controlla TUTTA la configurazione (web e piattaforma) prima di ogni altra cosa: se qualcosa
 *    manca o non torna, l'app non parte ed elenca tutti i problemi insieme.
 *  - Verifica che il ruolo database dell'app sia soggetto alla Row-Level Security: in
 *    produzione l'app si rifiuta di partire con un ruolo superuser/BYPASSRLS.
 *  - Anteprime AI (ADR-025) e scontorno delle foto (ADR-033): valida provider e archivio e
 *    avvia il worker in questo processo.
 */
import { checkRlsSafety, getDb, onSystemContext } from '@floral/db';
import {
  createAiProviderFromEnv,
  createBackgroundRemoverFromEnv,
  createStorageFromEnv,
  logger,
  startAiWorker,
} from '@floral/core';
import { assertConfiguration } from './lib/config-check';
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
    const message = `Il ruolo database "${report.role}" può aggirare la Row-Level Security (superuser o BYPASSRLS). Configura DATABASE_URL con il ruolo applicativo (vedi docs/ARCHITECTURE.md).`;
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
}

function startAiWorkerIfConfigured(): void {
  const provider = createAiProviderFromEnv();
  const remover = createBackgroundRemoverFromEnv();
  if (!provider && !remover) return;
  createStorageFromEnv();
  const state = globalThis as { __floralAiWorker?: unknown };
  if (state.__floralAiWorker) return;
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
