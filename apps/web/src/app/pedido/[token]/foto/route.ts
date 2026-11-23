/**
 * Foto del ramo finito vista dal cliente con il link pubblico (ADR-056, ADR-058): solo l'ordine
 * del link, finché il link è attivo. Niente sessione: vale solo il token firmato.
 */
import { getPublicOrderPhoto } from '@floral/core';
import { serverEnv } from '@/lib/env';
import { photoVariant, privateImageResponse } from '@/lib/image-response';

export async function GET(
  request: Request,
  { params }: RouteContext<'/pedido/[token]/foto'>,
): Promise<Response> {
  const { token } = await params;
  const image = await getPublicOrderPhoto(
    serverEnv().BETTER_AUTH_SECRET,
    token,
    photoVariant(request),
  );
  if (!image) return new Response(null, { status: 404 });
  return privateImageResponse(image);
}
