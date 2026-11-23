/**
 * Logo (`logo`) o copertina (`portada`) della pagina pubblica della fioreria (ADR-065): solo per
 * una tienda pubblicata e solo con l'ID attuale. Niente sessione: il servizio ricontrolla tutto.
 */
import { getPublicStoreImage } from '@floral/core';
import { privateImageResponse } from '@/lib/image-response';

const KINDS: Readonly<Record<string, 'LOGO' | 'COVER'>> = { logo: 'LOGO', portada: 'COVER' };

export async function GET(
  _request: Request,
  { params }: RouteContext<'/f/[slug]/imagen/[kind]/[imageId]'>,
): Promise<Response> {
  const { slug, kind, imageId } = await params;
  const image = await getPublicStoreImage(slug, KINDS[kind], imageId);
  if (!image) return new Response(null, { status: 404 });
  return privateImageResponse(image);
}
