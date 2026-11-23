'use server';

/**
 * Server action degli ordini (ADR-054). Totali, stati e pagamenti li decide SOLO il servizio
 * (@floral/core): il client invia i dati del form e lo stato richiesto.
 * Contesto, errori, pagine da ricaricare e messaggi: `runTenantAction`.
 */
import {
  cancelOrder,
  changeOrderStatus,
  createOrderFromQuote,
  recordOrderPayment,
  reverseOrderPayment,
  updateOrderFulfillment,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import { runTenantAction, section } from '@/lib/tenant-action';

export async function createOrderFromQuoteAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { id } = await createOrderFromQuote(ctx, quoteId, formDataToObject(formData));
    return {
      revalidate: [section(routes.orders.list()), routes.quotes.detail(quoteId)],
      redirectTo: routes.orders.detail(id),
    };
  });
}

export async function updateFulfillmentAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateOrderFulfillment(ctx, orderId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'orders.detail.saved' };
  });
}

/** Lo stato richiesto arriva dal pulsante premuto: il servizio verifica il passo e i permessi. */
export async function changeOrderStatusAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const status = await changeOrderStatus(ctx, orderId, formData.get('status'));
    return {
      revalidate: section(routes.orders.list()),
      success: (t) => t('orders.detail.stepDone', { status: t(`orders.statuses.${status}`) }),
    };
  });
}

export async function cancelOrderAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await cancelOrder(ctx, orderId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'orders.detail.cancelled' };
  });
}

export async function recordPaymentAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await recordOrderPayment(ctx, orderId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'orders.detail.paymentRecorded' };
  });
}

export async function reversePaymentAction(
  slug: string,
  orderId: string,
  paymentId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await reverseOrderPayment(ctx, orderId, paymentId);
    return { revalidate: section(routes.orders.list()), success: 'orders.detail.paymentReversed' };
  });
}
