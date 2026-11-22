/**
 * Foto di un articolo del catalogo (`?size=thumb` per la miniatura, `cutout` / `cutout-thumb`
 * per la versione senza fondo): servita solo ai membri della fioreria proprietaria, con gli
 * stessi controlli dei servizi. Mai URL pubblici. Regole comuni: lib/private-image-route.ts.
 */
import { getCatalogPhotoImage } from '@floral/core';
import { catalogPhotoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<RouteContext<'/app/[tenantSlug]/catalog/photos/[photoId]'>>(
  (ctx, { photoId }, request) => getCatalogPhotoImage(ctx, photoId, catalogPhotoVariant(request)),
);
