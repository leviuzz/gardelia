/**
 * «Pedir de nuevo» (M3, ADR-088): dalla pagina di un suo ordine chiuso, chi l'ha fatto rimette gli
 * stessi prodotti nel carrello della fioreria e apre il modulo d'ordine. È una rotta sotto
 * `/f/<slug>` perché il cookie del carrello vale solo lì: il server lo legge, aggiunge i prodotti
 * con le regole di sempre (20 prodotti, 50 pezzi) e lo riscrive. Il modulo toglie poi, con l'avviso
 * di sempre, quelli non più ordinabili; prezzi e disponibilità li decide sempre il server.
 *
 * Solo POST dal sito stesso (Origin uguale all'app), con la sessione; l'ordine si cerca solo fra
 * quelli della persona (`buyerReorderLines`), e deve essere di questa fioreria.
 */
import { cookies, headers } from 'next/headers';
import { ConflictError, NotFoundError, buyerReorderLines } from '@floral/core';
import {
  STOREFRONT_CART_COOKIE,
  STOREFRONT_CART_DAYS,
  isUuid,
  mergeIntoCart,
  serializeCart,
} from '@floral/domain';
import { serverEnv } from '@/lib/env';
import { readCartCookie } from '@/lib/public-store';
import { accountRoutes, publicStoreRoutes, withQuery } from '@/lib/routes';
import { getSession } from '@/lib/session';

function seeOther(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } });
}

export async function POST(
  request: Request,
  { params }: RouteContext<'/f/[slug]/pedido/repetir'>,
): Promise<Response> {
  const { slug } = await params;
  const origin = (await headers()).get('origin');
  if (!origin || origin !== new URL(serverEnv().APP_URL).origin) {
    return new Response(null, { status: 403 });
  }
  const form = await request.formData();
  const raw = form.get('orderId');
  const orderId = typeof raw === 'string' && isUuid(raw) ? raw : null;
  if (!orderId) return new Response(null, { status: 404 });
  const back = accountRoutes.orders.detail(orderId);
  const session = await getSession();
  if (!session) return seeOther(`/login?next=${encodeURIComponent(back)}`);
  try {
    const reorder = await buyerReorderLines({ userId: session.user.id, country: 'MX' }, orderId);
    if (reorder.shopSlug !== slug) return new Response(null, { status: 404 });
    const merged = mergeIntoCart(await readCartCookie(), reorder.lines);
    const store = publicStoreRoutes(slug);
    (await cookies()).set({
      name: STOREFRONT_CART_COOKIE,
      value: serializeCart(merged.lines),
      path: store.home,
      maxAge: STOREFRONT_CART_DAYS * 24 * 60 * 60,
      sameSite: 'lax',
      secure: new URL(serverEnv().APP_URL).protocol === 'https:',
    });
    // Composizioni e voci libere non si ripetono online: il modulo lo dice (`repetido`).
    return seeOther(
      store.checkout({
        repetido: '1',
        ...(reorder.skipped > 0 ? { omitidos: String(reorder.skipped) } : {}),
        ...(merged.skipped > 0 ? { llenos: String(merged.skipped) } : {}),
      }),
    );
  } catch (error) {
    if (error instanceof NotFoundError) return new Response(null, { status: 404 });
    // Ordine non più ripetibile (riaperto, negozio chiuso): si torna alla sua pagina.
    if (error instanceof ConflictError) return seeOther(withQuery(back, { repetir: 'no' }));
    throw error;
  }
}
