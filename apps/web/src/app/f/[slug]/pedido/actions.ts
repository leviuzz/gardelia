'use server';

/**
 * "Enviar pedido" dalla tienda en línea (ADR-067). Chi compra arriva SOLO dalla sessione
 * (`runBuyerAction`); lo slug legato con `.bind()` viene dal browser, ma diventa una fioreria solo
 * se la sua tienda è pubblicata e riceve ordini (lo verifica il servizio). Prezzi, costo di
 * consegna e totali li decide il server.
 */
import { cookies } from 'next/headers';
import { placeMarketplaceOrder } from '@floral/core';
import { STOREFRONT_CART_COOKIE } from '@floral/domain';
import type { ActionState } from '@/lib/action-state';
import { FOUND_COOKIE, foundSlugs } from '@/lib/attribution';
import { runBuyerAction } from '@/lib/buyer';
import { formDataToObject } from '@/lib/form-data';
import { orderMailDeps } from '@/lib/order-mail';
import { accountRoutes, publicStoreRoutes, withQuery } from '@/lib/routes';
import { getRequestMeta } from '@/lib/request-meta';

export async function placeOrderAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      // Arrivato dalla ricerca di Gardelia (cookie dell'attribuzione): fee D-24.
      const fromSearch = foundSlugs((await cookies()).get(FOUND_COOKIE)?.value).includes(slug);
      const placed = await placeMarketplaceOrder(
        ctx,
        slug,
        formDataToObject(formData),
        { fromSearch, request: await getRequestMeta() },
        orderMailDeps(),
      );
      // Ordine inviato: il carrello di questa fioreria si svuota (M1).
      (await cookies()).delete({
        name: STOREFRONT_CART_COOKIE,
        path: publicStoreRoutes(slug).home,
      });
      return {
        revalidate: accountRoutes.home,
        redirectTo: withQuery(placed.trackingPath, { enviado: '1' }),
      };
    },
    { next: publicStoreRoutes(slug).checkout() },
  );
}
