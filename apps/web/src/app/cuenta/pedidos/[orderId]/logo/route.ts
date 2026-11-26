/**
 * Il logo della fioreria di un ordine, nel conto di chi l'ha fatto (M3). Con la sessione; 404 se
 * l'ordine non è suo o la fioreria non ha il logo.
 */
import { NotFoundError, getBuyerOrderShopLogo } from '@floral/core';
import { privateImageResponse } from '@/lib/image-response';
import { getSession } from '@/lib/session';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/cuenta/pedidos/[orderId]/logo'>,
): Promise<Response> {
  const { orderId } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });
  try {
    const image = await getBuyerOrderShopLogo({ userId: session.user.id, country: 'MX' }, orderId);
    if (!image) return new Response(null, { status: 404 });
    return privateImageResponse(image, { maxAgeSeconds: 300 });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response(null, { status: 404 });
    throw error;
  }
}
