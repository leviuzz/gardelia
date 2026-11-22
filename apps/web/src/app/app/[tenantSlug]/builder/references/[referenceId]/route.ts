/**
 * Foto di "Mis ramos" (`?size=thumb` per la miniatura): solo per i membri della fioreria
 * proprietaria con il piano che include il Builder. Mai URL pubblici. Regole comuni:
 * lib/private-image-route.ts.
 */
import { getStyleReferenceImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/builder/references/[referenceId]'>
>((ctx, { referenceId }, request) =>
  getStyleReferenceImage(ctx, referenceId, photoVariant(request)),
);
