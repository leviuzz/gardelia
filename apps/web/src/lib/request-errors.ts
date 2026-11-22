/**
 * Errori non gestiti di pagine, route e server action (hook `onRequestError` di Next.js):
 * finiscono nel nostro log strutturato con l'ID della richiesta (impostato da `proxy.ts`) e il
 * `digest`, cioè il "Referencia" che l'utente vede nella pagina d'errore. Così chi fa supporto
 * trova la riga di log partendo da ciò che l'utente legge.
 *
 * Privacy: si registra il percorso della ROUTE (es. `/invite/[token]`), mai quello reale né la
 * query: possono contenere token di invito, di verifica o di reset.
 */

/** Richiesta come la passa Next.js a `onRequestError`. */
export interface ErroredRequest {
  readonly path: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** Contesto della route come lo passa Next.js a `onRequestError`. */
export interface ErroredRequestContext {
  readonly routerKind: string;
  readonly routePath: string;
  readonly routeType: string;
  readonly renderSource?: string | undefined;
  readonly revalidateReason?: string | undefined;
}

export interface ErrorLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

function headerValue(headers: ErroredRequest['headers'], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function digestOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return undefined;
  return typeof error.digest === 'string' ? error.digest : undefined;
}

/** Campi della riga di log (senza l'errore): niente percorsi reali, query o intestazioni. */
export function describeRequestError(
  error: unknown,
  request: ErroredRequest,
  context: ErroredRequestContext,
): Record<string, string | undefined> {
  return {
    requestId: headerValue(request.headers, 'x-request-id'),
    digest: digestOf(error),
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
  };
}

export function reportRequestError(
  log: ErrorLogger,
  error: unknown,
  request: ErroredRequest,
  context: ErroredRequestContext,
): void {
  log.error(
    { err: error, ...describeRequestError(error, request, context) },
    'errore non gestito in una richiesta',
  );
}
