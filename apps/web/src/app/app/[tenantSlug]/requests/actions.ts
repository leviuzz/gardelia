'use server';

/**
 * «Rifiuta» una richiesta (M5): proprietario e gerente (`requests:write`, lo controlla il servizio).
 * L'ID legato con `.bind()` viene dal browser: un ID di un'altra fioreria è un 404 con l'evento di
 * sicurezza.
 */
import { declineServiceRequest } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import { orderMailDeps } from '@/lib/order-mail';
import { runTenantAction } from '@/lib/tenant-action';

export async function declineServiceRequestAction(
  slug: string,
  requestId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await declineServiceRequest(ctx, requestId, formDataToObject(formData), orderMailDeps());
    return {
      revalidate: [routes.requests.list(), routes.requests.detail(requestId), routes.home],
      success: 'requests.declined',
    };
  });
}
