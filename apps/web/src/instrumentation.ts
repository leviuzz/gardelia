/**
 * Eseguito una volta all'avvio del server Node.js.
 * Verifica che il ruolo database dell'app sia soggetto alla Row-Level Security:
 * in produzione l'app si rifiuta di partire con un ruolo superuser/BYPASSRLS.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { checkRlsSafety, getDb, onSystemContext } = await import('@floral/db');
  const { logger } = await import('@floral/core');

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
}
