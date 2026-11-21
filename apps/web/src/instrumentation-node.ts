/**
 * Avvio del server Node.js (caricato da `instrumentation.ts` solo nel runtime Node, così
 * il bundle Edge non include moduli Node).
 *  - Verifica che il ruolo database dell'app sia soggetto alla Row-Level Security: in
 *    produzione l'app si rifiuta di partire con un ruolo superuser/BYPASSRLS.
 *  - Anteprime AI (ADR-025): valida provider e archivio e avvia il worker in questo processo.
 */
import { checkRlsSafety, getDb, onSystemContext } from '@floral/db';
import { createAiProviderFromEnv, createStorageFromEnv, logger, startAiWorker } from '@floral/core';

export async function registerNode(): Promise<void> {
  onSystemContext(({ reason }) => logger.info({ reason }, 'contesto di sistema (bypass RLS)'));

  let report: Awaited<ReturnType<typeof checkRlsSafety>>;
  try {
    report = await checkRlsSafety(getDb());
  } catch (error) {
    logger.error({ err: error }, 'impossibile verificare il ruolo database all’avvio');
    return;
  }
  if (!report.rlsEffective) {
    const message = `Il ruolo database "${report.role}" può aggirare la Row-Level Security (superuser o BYPASSRLS). Configura DATABASE_URL con il ruolo applicativo (vedi docs/ARCHITECTURE.md).`;
    if (process.env.NODE_ENV === 'production') throw new Error(message);
    logger.warn(message);
  }

  // Errore di configurazione (es. provider simulato con un APP_URL pubblico) = l'app non parte.
  const provider = createAiProviderFromEnv();
  if (!provider) return;
  createStorageFromEnv();
  const state = globalThis as { __floralAiWorker?: unknown };
  if (state.__floralAiWorker) return;
  state.__floralAiWorker = startAiWorker();
  logger.info(
    { provider: provider.id, model: provider.model, simulated: provider.simulated },
    'worker delle anteprime AI avviato',
  );
}
