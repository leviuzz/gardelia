import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Proxy (ex middleware) di Next.js 16:
 *  1. assegna un requestId a ogni richiesta, API comprese (correlazione log/audit/errori);
 *  2. imposta un Content-Security-Policy con nonce per richiesta (script inline solo con nonce);
 *  3. redirect ottimistico al login per le aree autenticate senza cookie di sessione.
 *
 * Il punto 3 NON è un controllo di sicurezza: la verifica autorevole di sessione e
 * membership avviene lato server in ogni pagina/server action (lib/session.ts, lib/tenant.ts).
 */
const PROTECTED_PREFIXES = ['/app', '/onboarding', '/seguridad'];

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  // Solo con HTTPS reale: su http://localhost il browser proverebbe a passare a https.
  const isHttps = (process.env.APP_URL ?? '').startsWith('https://');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Gli attributi style inline (Radix, toast) richiedono 'unsafe-inline' per gli stili.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isHttps ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (isProtected && !getSessionCookie(request)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const requestId = crypto.randomUUID();
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
