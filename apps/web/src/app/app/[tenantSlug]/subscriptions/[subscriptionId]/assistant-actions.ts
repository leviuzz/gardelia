'use server';

/**
 * Server action dei crediti dell'Asistente de plantas lato fioreria (ADR-085, blocco 6b). Il
 * contratto legato con `.bind()` arriva dal browser: il servizio lo cerca solo nella fioreria della
 * sessione, controlla il permesso (proprietario e gerente) e il saldo della fioreria.
 */
import { giveAssistantCredits } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { runTenantAction } from '@/lib/tenant-action';

/** «Dar créditos» a un contratto attivo o in pausa. */
export async function giveAssistantCreditsAction(
  slug: string,
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await giveAssistantCredits(ctx, subscriptionId, { credits: formData.get('credits') });
    return {
      revalidate: [routes.subscriptions.detail(subscriptionId), routes.settings.care],
      success: 'care.assistant.card.done',
    };
  });
}
