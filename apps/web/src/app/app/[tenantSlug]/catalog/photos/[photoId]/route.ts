/**
 * Foto di un articolo del catalogo (`?size=thumb` per la miniatura, `cutout` / `cutout-thumb`
 * per la versione senza fondo): servita solo ai membri della fioreria proprietaria, con gli
 * stessi controlli dei servizi. Mai URL pubblici.
 */
import { NotFoundError, getCatalogPhotoImage } from '@floral/core';
import { catalogPhotoVariant, notFoundResponse, privateImageResponse } from '@/lib/image-response';
import { getTenantContext } from '@/lib/tenant';

export async function GET(
  request: Request,
  { params }: RouteContext<'/app/[tenantSlug]/catalog/photos/[photoId]'>,
): Promise<Response> {
  const { tenantSlug, photoId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  try {
    return privateImageResponse(
      await getCatalogPhotoImage(ctx, photoId, catalogPhotoVariant(request)),
    );
  } catch (error) {
    if (error instanceof NotFoundError) return notFoundResponse();
    throw error;
  }
}
