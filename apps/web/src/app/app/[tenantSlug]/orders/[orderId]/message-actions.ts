'use server';

/**
 * Server action dei messaggi di un ordine online lato fioreria (M3, ADR-088). Ordine e messaggio
 * legati con `.bind()` arrivano dal browser: il servizio li cerca solo nella fioreria della
 * sessione (un ID di un'altra fioreria risponde 404 con l'evento di sicurezza).
 */
import { markOrderThreadRead, postOrderMessage, removeOrderMessagePhoto } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { orderMailDeps } from '@/lib/order-mail';
import { runTenantAction } from '@/lib/tenant-action';
import { optionalUploadedBytes } from '@/lib/uploads';

/** Un messaggio della fioreria: testo e/o una foto (il modulo la riduce prima dell'invio). */
export async function postOrderMessageAction(
  slug: string,
  orderId: string,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const photo = await optionalUploadedBytes(formData);
    await postOrderMessage(
      ctx,
      orderId,
      {
        body: formData.get('body'),
        submitKey: formData.get('submitKey'),
        // M3-2: con la casella «Domanda sì / no» chi compra risponde con un tocco.
        question: formData.get('question'),
      },
      photo,
      orderMailDeps(),
    );
    return { revalidate: routes.orders.detail(orderId), success: 'orders.messages.sent' };
  });
}

/** Il filo si è visto: i messaggi di chi compra sono letti (senza ricaricare la pagina). */
export async function markOrderThreadReadAction(
  slug: string,
  orderId: string,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx }) => {
    await markOrderThreadRead(ctx, orderId);
    return {};
  });
}

/** «Togli la foto» di un messaggio (chi gestisce gli ordini): i file si cancellano subito. */
export async function removeOrderMessagePhotoAction(
  slug: string,
  orderId: string,
  messageId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeOrderMessagePhoto(ctx, orderId, messageId);
    return { revalidate: routes.orders.detail(orderId), success: 'orders.messages.photoRemoved' };
  });
}
