/**
 * Foto vera del ramo di un disegno (ADR-052, `?size=thumb` per la miniatura): solo per i membri
 * della fioreria proprietaria con il piano che include il Builder. Mai URL pubblici. Regole
 * comuni: lib/private-image-route.ts.
 */
import { getBouquetPhotoImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<RouteContext<'/app/[tenantSlug]/builder/photos/[photoId]'>>(
  (ctx, { photoId }, request) => getBouquetPhotoImage(ctx, photoId, photoVariant(request)),
);
