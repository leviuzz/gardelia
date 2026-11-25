/**
 * Una foto di un servizio di Floral Care vista dalla persona invitata (ADR-084): solo con la
 * sessione e l'accesso al contratto (404 altrimenti), mai una foto tolta o cancellata. Cache breve:
 * se la fioreria toglie l'accesso, la foto smette presto di vedersi anche nel browser.
 */
import { getMyCarePhoto } from '@floral/core';
import { photoVariant, privateImageResponse } from '@/lib/image-response';
import { getSession } from '@/lib/session';

export async function GET(
  request: Request,
  { params }: RouteContext<'/cuenta/floral-care/[subscriptionId]/foto/[photoId]'>,
): Promise<Response> {
  const { subscriptionId, photoId } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });
  const image = await getMyCarePhoto(
    { userId: session.user.id, country: 'MX' },
    subscriptionId,
    photoId,
    photoVariant(request),
  );
  if (!image) return new Response(null, { status: 404 });
  return privateImageResponse(image, { maxAgeSeconds: 300 });
}
