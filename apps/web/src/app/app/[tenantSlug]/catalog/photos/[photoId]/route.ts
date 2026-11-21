/**
 * Foto di un articolo del catalogo (`?size=thumb` per la miniatura): servita solo ai membri
 * della fioreria proprietaria, con gli stessi controlli dei servizi. Mai URL pubblici.
 */
import { NotFoundError, getCatalogPhotoImage } from '@floral/core';
import { notFoundResponse, photoVariant, privateImageResponse } from '@/lib/image-response';
import { getTenantContext } from '@/lib/tenant';

export async function GET(
  request: Request,
  { params }: RouteContext<'/app/[tenantSlug]/catalog/photos/[photoId]'>,
): Promise<Response> {
  const { tenantSlug, photoId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  try {
    return privateImageResponse(await getCatalogPhotoImage(ctx, photoId, photoVariant(request)));
  } catch (error) {
    if (error instanceof NotFoundError) return notFoundResponse();
    throw error;
  }
}
