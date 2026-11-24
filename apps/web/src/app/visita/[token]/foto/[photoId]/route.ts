/**
 * Una foto del resoconto di una visita vista dal cliente con il link pubblico (ADR-076): solo le
 * foto di quella visita, finché il link è attivo e la foto non è tolta né cancellata. Niente
 * sessione: vale solo il token firmato.
 */
import { getPublicCareVisitPhoto } from '@floral/core';
import { serverEnv } from '@/lib/env';
import { photoVariant, privateImageResponse } from '@/lib/image-response';

export async function GET(
  request: Request,
  { params }: RouteContext<'/visita/[token]/foto/[photoId]'>,
): Promise<Response> {
  const { token, photoId } = await params;
  const image = await getPublicCareVisitPhoto(
    serverEnv().BETTER_AUTH_SECRET,
    token,
    photoId,
    photoVariant(request),
  );
  if (!image) return new Response(null, { status: 404 });
  return privateImageResponse(image);
}
