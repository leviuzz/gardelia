/**
 * Una foto di ispirazione di una richiesta vista da chi l'ha fatta (M5; `?size=thumb` per la
 * miniatura): solo con la sessione e la richiesta sua (404 altrimenti), mai una foto già cancellata.
 */
import { NotFoundError, getBuyerServiceRequestPhoto } from '@floral/core';
import { photoVariant, privateImageResponse } from '@/lib/image-response';
import { getSession } from '@/lib/session';

export async function GET(
  request: Request,
  { params }: RouteContext<'/cuenta/solicitudes/[requestId]/foto/[photoId]'>,
): Promise<Response> {
  const { requestId, photoId } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });
  try {
    const image = await getBuyerServiceRequestPhoto(
      { userId: session.user.id, country: 'MX' },
      requestId,
      photoId,
      photoVariant(request),
    );
    return privateImageResponse(image, { maxAgeSeconds: 300 });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response(null, { status: 404 });
    throw error;
  }
}
