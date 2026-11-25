'use server';

/**
 * Server action dei messaggi di Floral Care lato fioreria (ADR-084). Contratto e messaggio legati
 * con `.bind()` arrivano dal browser: il servizio li cerca solo nella fioreria della sessione.
 */
import { markCareThreadRead, postCareMessage, removeCareMessagePhoto } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { orderMailDeps } from '@/lib/order-mail';
import { runTenantAction } from '@/lib/tenant-action';
import { optionalUploadedBytes } from '@/lib/uploads';

/** Un messaggio della fioreria: testo e/o una foto (il modulo la riduce prima dell'invio). */
export async function postCareMessageAction(
  slug: string,
  subscriptionId: string,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const photo = await optionalUploadedBytes(formData);
    await postCareMessage(
      ctx,
      subscriptionId,
      { body: formData.get('body'), submitKey: formData.get('submitKey') },
      photo,
      orderMailDeps(),
    );
    return {
      revalidate: [routes.subscriptions.detail(subscriptionId), routes.subscriptions.messages()],
      success: 'care.messages.sent',
    };
  });
}

/** Il filo si è visto: i messaggi del cliente sono letti (senza ricaricare la pagina). */
export async function markCareThreadReadAction(
  slug: string,
  subscriptionId: string,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx }) => {
    await markCareThreadRead(ctx, subscriptionId);
    return {};
  });
}

/** "Quitar foto" di un messaggio (chi gestisce i contratti). */
export async function removeCareMessagePhotoAction(
  slug: string,
  subscriptionId: string,
  messageId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeCareMessagePhoto(ctx, subscriptionId, messageId);
    return {
      revalidate: routes.subscriptions.detail(subscriptionId),
      success: 'care.messages.photoRemoved',
    };
  });
}
