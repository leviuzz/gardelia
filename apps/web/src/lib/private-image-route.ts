import 'server-only';
import { ForbiddenError, NotFoundError, PlanRequiredError, type TenantContext } from '@floral/core';
import { notFoundResponse, privateImageResponse } from './image-response';
import { getTenantContext } from './tenant';

interface ImageRouteContext {
  readonly params: Promise<{ readonly tenantSlug: string }>;
}

interface PrivateImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/**
 * Route di un'immagine privata della fioreria (foto, ritagli, anteprime, boceto, immagine del
 * preventivo), con le stesse regole per tutte:
 *  - contesto della fioreria dallo slug (non membro → 404);
 *  - la funzione `load` del servizio applica permessi, piano e isolamento;
 *  - "non esiste", "di un'altra fioreria", "il tuo ruolo non può" e "il piano non lo include"
 *    rispondono tutti 404: un'immagine non rivela mai perché non si vede;
 *  - risposta privata (`privateImageResponse`), con nome del file se va scaricata.
 *
 * Uso: `export const GET = privateImageRoute<RouteContext<'/app/[tenantSlug]/…'>>(…)`.
 */
export function privateImageRoute<Context extends ImageRouteContext>(
  load: (
    ctx: TenantContext,
    params: Awaited<Context['params']>,
    request: Request,
  ) => Promise<PrivateImage>,
  options: { readonly downloadName?: (request: Request) => string | undefined } = {},
): (request: Request, context: Context) => Promise<Response> {
  return async (request, context) => {
    const params = (await context.params) as Awaited<Context['params']>;
    const ctx = await getTenantContext(params.tenantSlug);
    try {
      const image = await load(ctx, params, request);
      const downloadName = options.downloadName?.(request);
      return privateImageResponse(image, downloadName ? { downloadName } : {});
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        error instanceof ForbiddenError ||
        error instanceof PlanRequiredError
      ) {
        return notFoundResponse();
      }
      throw error;
    }
  };
}
