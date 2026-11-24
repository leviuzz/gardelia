'use server';

/**
 * "Eliminar florería" (ADR-074): il servizio ricontrolla titolare, nome scritto e ordini in corso.
 * Dopo la richiesta la fioreria non si apre più: si torna alla scelta della fioreria, dove c'è
 * "Recuperar".
 */
import { getMailer, requestTenantDeletion } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { serverEnv } from '@/lib/env';
import { formDataToObject } from '@/lib/form-data';
import { appRoutes, withQuery } from '@/lib/routes';
import { runTenantAction } from '@/lib/tenant-action';

export async function requestShopDeletionAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx }) => {
    const base = serverEnv().APP_URL.replace(/\/+$/, '');
    await requestTenantDeletion(ctx, formDataToObject(formData), {
      mailer: getMailer(),
      restoreUrl: `${base}${appRoutes.home}`,
    });
    return { redirectTo: withQuery(appRoutes.home, { eliminacion: 'programada' }) };
  });
}
