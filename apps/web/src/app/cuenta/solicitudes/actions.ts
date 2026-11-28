'use server';

/**
 * «Cancelar solicitud» dal conto di chi compra (M5). La persona arriva SOLO dalla sessione; l'ID
 * della richiesta viene dal browser e diventa una richiesta solo se è sua (`withBuyerRequest`).
 */
import { cancelBuyerServiceRequest } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { runBuyerAction } from '@/lib/buyer';
import { orderMailDeps } from '@/lib/order-mail';
import { accountRoutes } from '@/lib/routes';

export async function cancelServiceRequestAction(
  requestId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(async ({ ctx }) => {
    await cancelBuyerServiceRequest(ctx, requestId, orderMailDeps());
    return {
      revalidate: [accountRoutes.requests.detail(requestId), accountRoutes.home],
      success: 'account.requests.cancelled',
    };
  });
}
