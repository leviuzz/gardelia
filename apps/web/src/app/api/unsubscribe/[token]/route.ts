/**
 * Disiscrizione con un clic dalle email della promo (RFC 8058, intestazioni List-Unsubscribe e
 * List-Unsubscribe-Post): il programma di posta manda un POST, senza pagina. Il link firmato è la
 * sola prova richiesta (ADR-047). Un GET (anteprime dei link, scanner) non disiscrive mai: porta
 * alla pagina con il pulsante di conferma.
 */
import { logger, unsubscribeFromPromotions } from '@floral/core';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

type Context = RouteContext<'/api/unsubscribe/[token]'>;

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { token } = await params;
  try {
    const info = await unsubscribeFromPromotions(serverEnv().BETTER_AUTH_SECRET, token, {
      requestId: request.headers.get('x-request-id') ?? undefined,
    });
    return new Response(null, { status: info ? 200 : 404 });
  } catch (error) {
    logger.error({ err: error }, 'disiscrizione con un clic non riuscita');
    return new Response(null, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const { token } = await params;
  return Response.redirect(
    new URL(`/unsubscribe/${encodeURIComponent(token)}`, serverEnv().APP_URL),
    303,
  );
}
