/**
 * La foto del ramo consegnato (prova di consegna, ADR-058) nel conto di chi ha fatto l'ordine
 * (M3; `?size=thumb` per la miniatura). Con la sessione; 404 se l'ordine non è suo, è annullato o
 * non ha la foto.
 */
import { NotFoundError, getBuyerOrderPhoto } from '@floral/core';
import { photoVariant, privateImageResponse } from '@/lib/image-response';
import { getSession } from '@/lib/session';

export async function GET(
  request: Request,
  { params }: RouteContext<'/cuenta/pedidos/[orderId]/foto'>,
): Promise<Response> {
  const { orderId } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });
  try {
    const image = await getBuyerOrderPhoto(
      { userId: session.user.id, country: 'MX' },
      orderId,
      photoVariant(request),
    );
    if (!image) return new Response(null, { status: 404 });
    return privateImageResponse(image, { maxAgeSeconds: 300 });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response(null, { status: 404 });
    throw error;
  }
}
