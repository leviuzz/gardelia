'use server';

/**
 * Server action degli ordini (ADR-054). Totali, stati e pagamenti li decide SOLO il servizio
 * (@floral/core): il client invia i dati del form e lo stato richiesto.
 * Contesto, errori, pagine da ricaricare e messaggi: `runTenantAction`.
 */
import {
  acceptOnlineOrder,
  askOrderChange,
  askSubstitutionInApp,
  addCatalogItemToOrder,
  addOrderPhoto,
  assignOrder,
  addCustomLineToOrder,
  cancelOrder,
  changeOrderStatus,
  confirmDraftOrder,
  confirmOrderCashCollection,
  confirmPaymentProof,
  createDraftOrder,
  createOrderFromQuote,
  discardDraftOrder,
  notifyOrderCustomer,
  proposeOrderDate,
  recordOrderPayment,
  refundOrderPayment,
  rejectOrderCashCollection,
  rejectPaymentProof,
  removeOrderLine,
  reverseOrderPayment,
  setOrderReceiver,
  revokePublicLink,
  submitOrderCashCollection,
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

/**
 * M3-2 «Chiedi conferma al cliente»: l'ordine da accettare è cambiato e chi compra lo conferma (o
 * no) dal suo conto. Messaggio facoltativo; a domicilio con la consegna a 0, la conferma che è gratis.
 */
export async function askOrderChangeAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await askOrderChange(ctx, orderId, formDataToObject(formData), orderMailDeps());
    return { revalidate: section(routes.orders.list()), success: 'orders.changes.asked' };
  });
}

/**
 * M3-2 «Proponi un'altra data» invece di rifiutare: giorno, fascia e messaggio in un passo; il
 * servizio cambia l'ordine e chiede conferma a chi compra.
 */
export async function proposeOrderDateAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await proposeOrderDate(ctx, orderId, formDataToObject(formData), orderMailDeps());
    return { revalidate: section(routes.orders.list()), success: 'orders.changes.proposed' };
  });
}

export async function recordPaymentAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    // M3-3: su un ordine online chi compra riceve «Registramos tu pago».
    await recordOrderPayment(ctx, orderId, formDataToObject(formData), orderMailDeps());
    return { revalidate: section(routes.orders.list()), success: 'orders.detail.paymentRecorded' };
  });
}

// -----------------------------------------------------------------------------
// M3-3 «Soldi e squadra»: rimborso, prove di pagamento e contanti
// -----------------------------------------------------------------------------

/** «Registra rimborso» su un ordine annullato: fino al pagato; chi compra online riceve l'email. */
export async function refundPaymentAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await refundOrderPayment(ctx, orderId, formDataToObject(formData), orderMailDeps());
    return { revalidate: section(routes.orders.list()), success: 'orders.money.refundedToast' };
  });
}

/** «Confermo» una prova di pagamento: diventa un pagamento con i dati del modulo. */
export async function confirmPaymentProofAction(
  slug: string,
  orderId: string,
  proofId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await confirmPaymentProof(ctx, orderId, proofId, formDataToObject(formData), orderMailDeps());
    return { revalidate: section(routes.orders.list()), success: 'orders.money.proofConfirmed' };
  });
}

/** «Non lo trovo»: la prova resta con il motivo, che chi compra legge. */
export async function rejectPaymentProofAction(
  slug: string,
  orderId: string,
  proofId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await rejectPaymentProof(ctx, orderId, proofId, formDataToObject(formData), orderMailDeps());
    return { revalidate: section(routes.orders.list()), success: 'orders.money.proofRejected' };
  });
}

/** «Ho incassato $X in contanti» (chi prepara o consegna): restano da confermare. */
export async function submitCashCollectionAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await submitOrderCashCollection(ctx, orderId, formDataToObject(formData));
    // La sezione degli ordini comprende anche Percorso → «Le mie consegne».
    return { revalidate: section(routes.orders.list()), success: 'orders.money.cashSubmitted' };
  });
}

/** Proprietario o gerente confermano i contanti: un saldo in Contanti. */
export async function confirmCashCollectionAction(
  slug: string,
  orderId: string,
  collectionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await confirmOrderCashCollection(
      ctx,
      orderId,
      collectionId,
      formDataToObject(formData),
      orderMailDeps(),
    );
    return { revalidate: section(routes.orders.list()), success: 'orders.money.cashConfirmed' };
  });
}

/** I contanti non entrano: il motivo lo legge chi li aveva segnati. */
export async function rejectCashCollectionAction(
  slug: string,
  orderId: string,
  collectionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await rejectOrderCashCollection(ctx, orderId, collectionId, formDataToObject(formData));
    return { revalidate: section(routes.orders.list()), success: 'orders.money.cashRejected' };
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
    // M3-3: la persona assegnata (se non è chi assegna) riceve l'avviso per email.
    await assignOrder(ctx, orderId, formData.get('assignee'), orderMailDeps());
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

/**
 * M3-2 «Chiedi nell'app» in «Mancano fiori»: la domanda «sì / no» a chi compra, con il testo
 * preparato dal server (riga, fiore che manca e fiore proposto arrivano dal browser e il servizio li
 * ricontrolla).
 */
export async function askSubstitutionInAppAction(
  slug: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await askSubstitutionInApp(ctx, orderId, formDataToObject(formData), orderMailDeps());
    return { revalidate: routes.orders.detail(orderId), success: 'orders.substitution.askedInApp' };
  });
}
