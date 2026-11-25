'use server';

/**
 * Server action dell'Asistente de plantas del cliente (ADR-085, blocco 6b). La persona arriva SOLO
 * dalla sessione (`runBuyerAction`); contratto e caso legati con `.bind()` vengono dal browser,
 * come la pianta scelta nel modulo: il servizio apre il contratto solo con l'accesso (404
 * altrimenti), legge solo i casi della persona e ricontrolla crediti, limiti e budget. La lingua
 * della risposta è quella in cui la persona usa l'app.
 */
import { getLocale } from 'next-intl/server';
import {
  answerMyAssistantCase,
  askMyShopForAssistantCredits,
  sendMyAssistantCaseToShop,
  startMyAssistantCase,
} from '@floral/core';
import { assistantQuestionSchema, resolveLocale, type SupportedLocale } from '@floral/domain';
import type { ActionState } from '@/lib/action-state';
import { runBuyerAction } from '@/lib/buyer';
import { parseForm } from '@/lib/form-data';
import { accountRoutes } from '@/lib/routes';
import { uploadedBytes } from '@/lib/uploads';

async function personLocale(): Promise<SupportedLocale> {
  return resolveLocale(await getLocale());
}

/** «Analizar foto»: riconosce la pianta, apre il caso e ci va. */
export async function startMyAssistantCaseAction(
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      const photo = await uploadedBytes(formData);
      const plantId = formData.get('plantId');
      const created = await startMyAssistantCase(
        ctx,
        subscriptionId,
        { locale: await personLocale(), plantId: typeof plantId === 'string' ? plantId : null },
        photo,
      );
      return {
        revalidate: accountRoutes.care.contract(subscriptionId),
        redirectTo: accountRoutes.care.assistant(subscriptionId, { caso: created.id }),
      };
    },
    { next: accountRoutes.care.assistant(subscriptionId) },
  );
}

/** Una domanda sul caso: tipo, specie confermata o corretta («No sé» = nessuna), la domanda. */
export async function answerMyAssistantCaseAction(
  subscriptionId: string,
  caseId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      const input = parseForm(assistantQuestionSchema, formData);
      await answerMyAssistantCase(ctx, subscriptionId, caseId, await personLocale(), input);
      return {
        revalidate: [
          accountRoutes.care.assistant(subscriptionId),
          accountRoutes.care.contract(subscriptionId),
        ],
        success: 'assistant.ask.answered',
      };
    },
    { next: accountRoutes.care.assistant(subscriptionId, { caso: caseId }) },
  );
}

/** «Enviar a la florería»: un messaggio nel filo con la foto e il riassunto. */
export async function sendMyAssistantCaseAction(
  subscriptionId: string,
  caseId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      const sent = await sendMyAssistantCaseToShop(
        ctx,
        subscriptionId,
        caseId,
        await personLocale(),
      );
      return {
        revalidate: [accountRoutes.care.contract(subscriptionId), accountRoutes.care.home],
        success: sent.duplicate ? 'assistant.share.already' : 'assistant.share.sent',
      };
    },
    { next: accountRoutes.care.assistant(subscriptionId, { caso: caseId }) },
  );
}

/** «Pedir más consultas»: un messaggio alla fioreria, una volta al giorno. */
export async function askMoreAssistantCreditsAction(
  subscriptionId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      const sent = await askMyShopForAssistantCredits(ctx, subscriptionId, await personLocale());
      return {
        revalidate: [accountRoutes.care.contract(subscriptionId), accountRoutes.care.home],
        success: sent.duplicate ? 'assistant.more.already' : 'assistant.more.sent',
      };
    },
    { next: accountRoutes.care.contract(subscriptionId) },
  );
}
