/**
 * L'immagine del ramo di una riga dell'ordine, nel conto di chi l'ha fatto (M3): con la sessione,
 * non con il link di stato (che può scadere). 404 se l'ordine non è suo o la riga non ha immagine.
 */
import { NotFoundError, getBuyerOrderLineImage } from '@floral/core';
import { privateImageResponse } from '@/lib/image-response';
import { getSession } from '@/lib/session';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/cuenta/pedidos/[orderId]/imagen/[lineId]'>,
): Promise<Response> {
  const { orderId, lineId } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });
  try {
    const image = await getBuyerOrderLineImage(
      { userId: session.user.id, country: 'MX' },
      orderId,
      lineId,
    );
    if (!image) return new Response(null, { status: 404 });
    return privateImageResponse(image, { maxAgeSeconds: 300 });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response(null, { status: 404 });
    throw error;
  }
}
