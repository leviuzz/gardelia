import { NextResponse } from 'next/server';
import { FOUND_COOKIE, FOUND_COOKIE_DAYS, isStoreSlug, withFoundSlug } from '@/lib/attribution';
import { buyerRoutes, publicStoreRoutes } from '@/lib/routes';

/**
 * Dalla ricerca di Gardelia alla tienda (ADR-067): ricorda lo slug nel cookie dell'attribuzione e
 * porta alla pagina della fioreria. Non legge il database: una tienda inesistente risponde 404 nella
 * sua pagina.
 */
export async function GET(request: Request, { params }: RouteContext<'/buscar/ir/[slug]'>) {
  const { slug } = await params;
  if (!isStoreSlug(slug)) {
    return NextResponse.redirect(new URL(buyerRoutes.home, request.url), 303);
  }
  const response = NextResponse.redirect(new URL(publicStoreRoutes(slug).home, request.url), 303);
  const current = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${FOUND_COOKIE}=`))
    ?.slice(FOUND_COOKIE.length + 1);
  response.cookies.set(FOUND_COOKIE, withFoundSlug(current, slug), {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(request.url).protocol === 'https:',
    path: '/',
    maxAge: FOUND_COOKIE_DAYS * 24 * 60 * 60,
  });
  return response;
}
