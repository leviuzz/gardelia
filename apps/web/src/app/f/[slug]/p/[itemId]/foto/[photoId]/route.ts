/**
 * Foto di un prodotto della pagina pubblica della fioreria (ADR-065): solo prodotti attivi con
 * "Visible en línea" di una tienda pubblicata. Niente sessione: il servizio ricontrolla tutto.
 */
import { getPublicStoreItemPhoto } from '@floral/core';
import { photoVariant, privateImageResponse } from '@/lib/image-response';

export async function GET(
  request: Request,
  { params }: RouteContext<'/f/[slug]/p/[itemId]/foto/[photoId]'>,
): Promise<Response> {
  const { slug, itemId, photoId } = await params;
  const image = await getPublicStoreItemPhoto(slug, itemId, photoId, photoVariant(request));
  if (!image) return new Response(null, { status: 404 });
  return privateImageResponse(image);
}
