/**
 * Foto di un servizio della pagina pubblica della fioreria (M5): solo servizi pubblicati di una
 * tienda pubblicata. Niente sessione: il servizio ricontrolla tutto.
 */
import { getPublicStoreServicePhoto } from '@floral/core';
import { photoVariant, privateImageResponse } from '@/lib/image-response';

export async function GET(
  request: Request,
  { params }: RouteContext<'/f/[slug]/servicios/[serviceId]/foto/[photoId]'>,
): Promise<Response> {
  const { slug, serviceId, photoId } = await params;
  const image = await getPublicStoreServicePhoto(slug, serviceId, photoId, photoVariant(request));
  if (!image) return new Response(null, { status: 404 });
  return privateImageResponse(image);
}
