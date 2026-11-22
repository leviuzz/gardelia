'use server';

/**
 * Server action della promo delle date speciali (ADR-047): il servizio di @floral/core valida
 * l'input e ricontrolla permessi e fioreria. Contesto, errori e messaggi: `runTenantAction`.
 */
import { updateOccasionPromo } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import { runTenantAction } from '@/lib/tenant-action';

export async function updateOccasionPromoAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateOccasionPromo(ctx, formDataToObject(formData));
    // Il calendario mostra se e quando parte la promo di ogni data.
    return { revalidate: [routes.promotions, routes.calendar()], success: 'promotions.saved' };
  });
}
