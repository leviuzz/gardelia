'use server';

/**
 * Server action dell'Asistente de plantas lato fioreria (ADR-085). Contratto, visita e caso legati
 * con `.bind()` arrivano dal browser, come la pianta scelta nel modulo: il servizio li cerca solo
 * nella fioreria della sessione e ricontrolla limiti e budget.
 */
import { answerAssistantCase, startAssistantCase } from '@floral/core';
import { assistantQuestionSchema } from '@floral/domain';
import type { ActionState } from '@/lib/action-state';
import { parseForm } from '@/lib/form-data';
import { runTenantAction } from '@/lib/tenant-action';
import { uploadedBytes } from '@/lib/uploads';

/** «Analizar foto»: riconosce la pianta, apre il caso e ci va. */
export async function startAssistantCaseAction(
  slug: string,
  subscriptionId: string,
  visitId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const photo = await uploadedBytes(formData);
    const plantId = formData.get('plantId');
    const created = await startAssistantCase(
      ctx,
      { subscriptionId, plantId: typeof plantId === 'string' ? plantId : null, visitId },
      photo,
    );
    return {
      revalidate: routes.subscriptions.detail(subscriptionId),
      redirectTo: routes.subscriptions.assistant(subscriptionId, { case: created.id }),
    };
  });
}

/** Una domanda sul caso, con la specie confermata o corretta («No sé» = nessuna). */
export async function answerAssistantCaseAction(
  slug: string,
  subscriptionId: string,
  caseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const input = parseForm(assistantQuestionSchema, formData);
    await answerAssistantCase(ctx, caseId, input);
    return {
      revalidate: [
        routes.subscriptions.assistant(subscriptionId),
        routes.subscriptions.detail(subscriptionId),
      ],
      success: 'assistant.ask.answered',
    };
  });
}
