/**
 * La foto di una propria prova di pagamento (M3-3, ADR-088; `?size=thumb` per la miniatura): solo
 * con la sessione e l'ordine suo (404 altrimenti), finché non è cancellata. Cache breve, come le
 * foto dei messaggi.
 */
import { NotFoundError, getBuyerPaymentProofPhoto } from '@floral/core';
import { photoVariant, privateImageResponse } from '@/lib/image-response';
import { getSession } from '@/lib/session';

export async function GET(
  request: Request,
  { params }: RouteContext<'/cuenta/pedidos/[orderId]/comprobantes/[proofId]'>,
): Promise<Response> {
  const { orderId, proofId } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });
  try {
    const image = await getBuyerPaymentProofPhoto(
      { userId: session.user.id, country: 'MX' },
      orderId,
      proofId,
      photoVariant(request),
    );
    if (!image) return new Response(null, { status: 404 });
    return privateImageResponse(image, { maxAgeSeconds: 300 });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response(null, { status: 404 });
    throw error;
  }
}
