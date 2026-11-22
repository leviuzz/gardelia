import type { Instrumentation } from 'next';

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

/**
 * Ogni errore non gestito di pagine, route e server action passa da qui: riga di log JSON con
 * ID della richiesta e `digest` (il "Referencia" mostrato all'utente). Vedi lib/request-errors.ts.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reportNodeRequestError } = await import('./instrumentation-node');
    reportNodeRequestError(error, request, context);
  }
};
