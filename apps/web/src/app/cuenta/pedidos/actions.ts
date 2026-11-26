'use server';

/**
 * Server action della pagina di un ordine online nel conto di chi l'ha fatto (M3, ADR-088). La
 * persona arriva SOLO dalla sessione (`runBuyerAction`); l'ID dell'ordine legato con `.bind()` viene
 * dal browser e il servizio lo cerca solo fra gli ordini della persona (un altro risponde 404).
 */
import { markBuyerOrderRead, postBuyerOrderMessage } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { runBuyerAction } from '@/lib/buyer';
import { orderMailDeps } from '@/lib/order-mail';
import { accountRoutes } from '@/lib/routes';
import { optionalUploadedBytes } from '@/lib/uploads';

/** Un messaggio alla fioreria: testo e/o una foto (il modulo la riduce prima dell'invio). */
export async function postBuyerOrderMessageAction(
  orderId: string,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      const photo = await optionalUploadedBytes(formData);
      await postBuyerOrderMessage(
        ctx,
        orderId,
        { body: formData.get('body'), submitKey: formData.get('submitKey') },
        photo,
        orderMailDeps(),
      );
      return {
        revalidate: [accountRoutes.orders.detail(orderId), accountRoutes.home],
        success: 'account.orderPage.messages.sent',
      };
    },
    { next: accountRoutes.orders.detail(orderId) },
  );
}

/** Il filo si è visto: i messaggi della fioreria non sono più nuovi (senza ricaricare la pagina). */
export async function markBuyerOrderReadAction(orderId: string): Promise<ActionState> {
  return runBuyerAction(async ({ ctx }) => {
    await markBuyerOrderRead(ctx, orderId);
    return {};
  });
}
