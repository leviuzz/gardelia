'use server';

/**
 * Server action degli ordini (ADR-054). Totali, stati e pagamenti li decide SOLO il servizio
 * (@floral/core): il client invia i dati del form e lo stato richiesto.
 * Contesto, errori, pagine da ricaricare e messaggi: `runTenantAction`.
 */
import {
  addCatalogItemToOrder,
  addOrderPhoto,
  assignOrder,
  addCustomLineToOrder,
  cancelOrder,
  changeOrderStatus,
  confirmDraftOrder,
  createDraftOrder,
  createOrderFromQuote,
  discardDraftOrder,
  recordOrderPayment,
  removeOrderLine,
  reverseOrderPayment,
  setOrderReceiver,
  revokePublicLink,
  sharePublicLink,
  updateOrderDiscount,
  updateOrderFulfillment,
  updateOrderLineQuantity,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { serverEnv } from '@/lib/env';
import { formDataToObject } from '@/lib/form-data';
import { uploadedBytes } from '@/lib/uploads';
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

// -----------------------------------------------------------------------------
// Pedido diretto: borrador, righe, sconto e conferma (A1b)
// -----------------------------------------------------------------------------

/** "Nuevo pedido": il cliente scelto ed eventualmente il ramo di un disegno del Diseñador. */
export async function createDraftOrderAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { id } = await createDraftOrder(ctx, {
      customerId: formData.get('customerId'),
      configurationId: formData.get('configurationId') ?? undefined,
    });
    return { revalidate: section(routes.orders.list()), redirectTo: routes.orders.detail(id) };
  });
}

export async function addCatalogLineToOrderAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCatalogItemToOrder(ctx, orderId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'quotes.editor.lineAdded' };
  });
}

export async function addCustomLineToOrderAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCustomLineToOrder(ctx, orderId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'quotes.editor.lineAdded' };
  });
}

export async function updateOrderLineQuantityAction(
  slug: string,
  orderId: string,
  lineId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateOrderLineQuantity(ctx, orderId, lineId, formData.get('quantity'));
    return { revalidate: section(routes.orders.list()), success: 'quotes.editor.lineUpdated' };
  });
}

export async function removeOrderLineAction(
  slug: string,
  orderId: string,
  lineId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeOrderLine(ctx, orderId, lineId);
    return { revalidate: section(routes.orders.list()), success: 'quotes.editor.lineRemoved' };
  });
}

export async function updateOrderDiscountAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateOrderDiscount(ctx, orderId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'orders.draft.discountSaved' };
  });
}

export async function confirmDraftOrderAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await confirmDraftOrder(ctx, orderId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'orders.draft.confirmed' };
  });
}

/** Il borrador scartato non compare più negli elenchi: si torna ai pedidos (niente toast). */
export async function discardDraftOrderAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await discardDraftOrder(ctx, orderId);
    return { revalidate: section(routes.orders.list()), redirectTo: routes.orders.list() };
  });
}

// -----------------------------------------------------------------------------
// Link pubblico per il cliente (ADR-056)
// -----------------------------------------------------------------------------

/** Crea il link (o lo rinnova con `renew=1`): il servizio ricontrolla permessi e stato. */
export async function shareOrderLinkAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const renew = formData.get('renew') === '1';
    await sharePublicLink(
      ctx,
      serverEnv().BETTER_AUTH_SECRET,
      { kind: 'ORDER', id: orderId },
      {
        renew,
      },
    );
    return {
      revalidate: section(routes.orders.list()),
      success: renew ? 'shareLink.renewed' : 'shareLink.created',
    };
  });
}

export async function revokeOrderLinkAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await revokePublicLink(ctx, { kind: 'ORDER', id: orderId });
    return { revalidate: section(routes.orders.list()), success: 'shareLink.revoked' };
  });
}

/** Repartidor di un ordine a domicilio (ADR-058); vuoto = nessuno. */
export async function assignOrderAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await assignOrder(ctx, orderId, formData.get('assignee'));
    return { revalidate: section(routes.orders.list()), success: 'orders.assign.saved' };
  });
}

// -----------------------------------------------------------------------------
// Prova di consegna (ADR-058)
// -----------------------------------------------------------------------------

/** Foto del ramo finito, una per richiesta: il servizio ricontrolla permessi, stato e immagine. */
export async function uploadOrderPhotoAction(
  slug: string,
  orderId: string,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addOrderPhoto(ctx, orderId, await uploadedBytes(formData));
    return { revalidate: section(routes.orders.list()) };
  });
}

export async function setOrderReceiverAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setOrderReceiver(ctx, orderId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'orders.handover.saved' };
  });
}
