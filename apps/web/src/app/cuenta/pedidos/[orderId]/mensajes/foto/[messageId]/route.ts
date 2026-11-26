/**
 * La foto di un messaggio di un ordine online vista da chi l'ha fatto (M3, ADR-088; `?size=thumb`
 * per la miniatura): solo con la sessione e l'ordine suo (404 altrimenti), mai una foto tolta o
 * cancellata. Cache breve, come le foto di Mi Floral Care.
 */
import { NotFoundError, getBuyerOrderMessagePhoto } from '@floral/core';
import { photoVariant, privateImageResponse } from '@/lib/image-response';
import { getSession } from '@/lib/session';

export async function GET(
  request: Request,
  { params }: RouteContext<'/cuenta/pedidos/[orderId]/mensajes/foto/[messageId]'>,
): Promise<Response> {
  const { orderId, messageId } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });
  try {
    const image = await getBuyerOrderMessagePhoto(
      { userId: session.user.id, country: 'MX' },
      orderId,
      messageId,
      photoVariant(request),
    );
    if (!image) return new Response(null, { status: 404 });
    return privateImageResponse(image, { maxAgeSeconds: 300 });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response(null, { status: 404 });
    throw error;
  }
}
