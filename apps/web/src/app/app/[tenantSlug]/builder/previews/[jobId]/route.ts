/**
 * Immagine di un'anteprima AI: servita solo a chi è membro della fioreria proprietaria e ha il
 * piano con il Builder. Mai URL pubblici dell'archivio. Regole comuni: lib/private-image-route.ts.
 */
import { getAiPreviewImage } from '@floral/core';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<RouteContext<'/app/[tenantSlug]/builder/previews/[jobId]'>>(
  (ctx, { jobId }) => getAiPreviewImage(ctx, jobId),
);
