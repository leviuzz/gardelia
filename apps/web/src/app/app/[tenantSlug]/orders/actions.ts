'use server';

/**
 * Server action degli ordini (ADR-054). Totali, stati e pagamenti li decide SOLO il servizio
 * (@floral/core): il client invia i dati del form e lo stato richiesto.
 * Contesto, errori, pagine da ricaricare e messaggi: `runTenantAction`.
 */
import {
  acceptOnlineOrder,
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
  notifyOrderCustomer,
  recordOrderPayment,
  removeOrderLine,
  reverseOrderPayment,
  setOrderReceiver,
  revokePublicLink,
  substituteOrderIngredient,
  sharePublicLink,
  updateOrderDiscount,
  updateOrderFulfillment,
  updateOrderLineQuantity,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { serverEnv } from '@/lib/env';
import { formDataToObject } from '@/lib/form-data';
import { orderMailDeps } from '@/lib/order-mail';
import { uploadedBytes } from '@/lib/uploads';
import { runTenantAction, section } from '@/lib/tenant-action';

export async function createOrderFromQuoteAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { id } = await createOrderFromQuote(
      ctx,
      quoteId,
      formDataToObject(formData),
      orderMailDeps(),
    );
    return {
      revalidate: [section(routes.orders.list()), routes.quotes.detail(quoteId)],
      redirectTo: routes.orders.detail(id),
    };
  });
}

/**
 * «Cambia consegna e biglietto». Su un ordine online accettato la casella «Avvisa il cliente per
 * email» (`notifyCustomer`) manda «Tu pedido cambió»: lo decide il servizio (M3).
 */
export async function updateFulfillmentAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateOrderFulfillment(ctx, orderId, formDataToObject(formData), orderMailDeps());
    return { revalidate: section(routes.orders.list()), success: 'orders.detail.saved' };
  });
}

/** «Avvisa il cliente dei cambi» (M3): un'email sola con il riepilogo di adesso. */
export async function notifyOrderCustomerAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await notifyOrderCustomer(ctx, orderId, orderMailDeps());
    return { revalidate: section(routes.orders.list()), success: 'orders.notify.sent' };
  });
}

/**
 * Lo stato richiesto arriva dal pulsante premuto: il servizio verifica il passo e i permessi.
 * `confirmShortage` c'è solo se la scheda ha mostrato che la merce non basta per "Listo" (ADR-071).
 */
export async function changeOrderStatusAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    // Un ordine online: a chi l'ha fatto un'email per il passo, la prima volta (M3).
    const status = await changeOrderStatus(ctx, orderId, formData.get('status'), {
      confirmShortage: formData.get('confirmShortage') === 'on',
      mail: orderMailDeps(),
    });
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
    // Un ordine online: chi compra riceve un'email con il motivo («Rifiuta» manda il motivo
    // pronto `reasonCode` e il dettaglio, M3).
    await cancelOrder(ctx, orderId, formDataToObject(formData), orderMailDeps());
    return { revalidate: section(routes.orders.list()), success: 'orders.detail.cancelled' };
  });
}

/**
 * "Aceptar pedido" (ordine della tienda en línea): chi compra riceve totale e come pagare. Con la
 * consegna a 0 arriva anche la conferma che è gratis (M0).
 */
export async function acceptOnlineOrderAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await acceptOnlineOrder(ctx, orderId, orderMailDeps(), formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'orders.online.accepted' };
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
    const { customerNotified } = await confirmDraftOrder(
      ctx,
      orderId,
      formDataToObject(formData),
      orderMailDeps(),
    );
    return {
      revalidate: section(routes.orders.list()),
      success: customerNotified ? 'orders.draft.confirmedNotified' : 'orders.draft.confirmed',
    };
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

/** "Cambiar flor" (ADR-081): la regola del ramo e l'ok del cliente li controlla il servizio. */
export async function substituteIngredientAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await substituteOrderIngredient(ctx, orderId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'orders.substitution.done' };
  });
}
