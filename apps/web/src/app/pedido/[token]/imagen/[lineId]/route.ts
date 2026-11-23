/**
 * Immagine del ramo di una riga, aperta dal cliente con il link pubblico (ADR-056): solo righe del
 * documento del link, finché il link è attivo. Niente sessione: vale solo il token firmato.
 */
import { getPublicLineImage } from '@floral/core';
import { serverEnv } from '@/lib/env';
import { privateImageResponse } from '@/lib/image-response';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/pedido/[token]/imagen/[lineId]'>,
): Promise<Response> {
  const { token, lineId } = await params;
  const image = await getPublicLineImage(serverEnv().BETTER_AUTH_SECRET, token, 'ORDER', lineId);
  if (!image) return new Response(null, { status: 404 });
  return privateImageResponse(image);
}
