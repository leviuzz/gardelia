/**
 * La foto di una consulta dell'Asistente de plantas vista dalla persona che l'ha fatta (ADR-085):
 * solo con la sessione, l'accesso al contratto e il caso suo (404 altrimenti), mai una foto
 * cancellata. Cache breve, come le altre foto di Mi Floral Care.
 */
import { getMyAssistantPhoto } from '@floral/core';
import { photoVariant, privateImageResponse } from '@/lib/image-response';
import { getSession } from '@/lib/session';

export async function GET(
  request: Request,
  { params }: RouteContext<'/cuenta/floral-care/[subscriptionId]/asistente/foto/[caseId]'>,
): Promise<Response> {
  const { subscriptionId, caseId } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });
  const image = await getMyAssistantPhoto(
    { userId: session.user.id, country: 'MX' },
    subscriptionId,
    caseId,
    photoVariant(request),
  );
  if (!image) return new Response(null, { status: 404 });
  return privateImageResponse(image, { maxAgeSeconds: 300 });
}
