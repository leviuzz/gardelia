/**
 * Eseguito una volta all'avvio del server. Il codice Node (database, worker AI) vive in
 * `instrumentation-node.ts` ed è importato solo nel runtime Node.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
