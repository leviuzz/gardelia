/**
 * Logo della fioreria nella pagina del link pubblico (lo stesso della tienda en línea): solo finché
 * il link è attivo e la fioreria esiste. Niente sessione: vale solo il token firmato.
 */
import { getPublicShopLogo } from '@floral/core';
import { serverEnv } from '@/lib/env';
import { privateImageResponse } from '@/lib/image-response';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/cotizacion/[token]/logo'>,
): Promise<Response> {
  const { token } = await params;
  const image = await getPublicShopLogo(serverEnv().BETTER_AUTH_SECRET, token, 'QUOTE');
  if (!image) return new Response(null, { status: 404 });
  return privateImageResponse(image);
}
