'use server';

/**
 * Server action della pagina del cliente di Floral Care (ADR-084). La persona arriva SOLO dalla
 * sessione (`runBuyerAction`); contratto, visita e token legati con `.bind()` vengono dal browser:
 * il servizio apre il contratto solo se la persona ha l'accesso (404 altrimenti) e accetta
 * l'invito solo con la stessa email.
 */
import {
  acceptCarePortalInvite,
  changeMyCareVisitDate,
  markMyCareThreadRead,
  postMyCareMessage,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { runBuyerAction } from '@/lib/buyer';
import { careChangeDeps, carePortalSecret } from '@/lib/care-portal';
import { getRequestMeta } from '@/lib/request-meta';
import { accountRoutes, withQuery } from '@/lib/routes';
import { requireUser } from '@/lib/session';
import { optionalUploadedBytes } from '@/lib/uploads';

export async function changeMyCareVisitDateAction(
  subscriptionId: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      // Il modulo manda giorno e fascia insieme ("AAAA-MM-GG|fascia"): il servizio li rivalida.
      const [date = '', slotId = ''] = String(formData.get('choice') ?? '').split('|');
      await changeMyCareVisitDate(
        ctx,
        subscriptionId,
        visitId,
        { date, slotId },
        careChangeDeps(),
        await getRequestMeta(),
      );
      return {
        revalidate: accountRoutes.care.contract(subscriptionId),
        redirectTo: withQuery(accountRoutes.care.contract(subscriptionId), { cambiada: visitId }),
      };
    },
    { next: accountRoutes.care.changeDate(subscriptionId, visitId) },
  );
}

export async function acceptCarePortalInviteAction(
  token: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const invitePath = accountRoutes.care.invite(token);
  return runBuyerAction(
    async ({ ctx }) => {
      // L'email per il confronto con l'invito: quella (verificata) della sessione.
      const user = await requireUser(invitePath);
      const result = await acceptCarePortalInvite({
        secret: carePortalSecret(),
        token,
        buyer: ctx,
        userEmail: user.email,
        request: await getRequestMeta(),
      });
      return {
        revalidate: accountRoutes.home,
        redirectTo: result.subscriptionId
          ? accountRoutes.care.contract(result.subscriptionId)
          : accountRoutes.care.home,
      };
    },
    { next: invitePath },
  );
}

/** Un messaggio della persona alla fioreria (testo e/o una foto, ridotta nel browser). */
export async function postMyCareMessageAction(
  subscriptionId: string,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      const photo = await optionalUploadedBytes(formData);
      await postMyCareMessage(
        ctx,
        subscriptionId,
        { body: formData.get('body'), submitKey: formData.get('submitKey') },
        photo,
      );
      return {
        revalidate: [accountRoutes.care.contract(subscriptionId), accountRoutes.care.home],
        success: 'care.messages.sent',
      };
    },
    { next: accountRoutes.care.thread(subscriptionId) },
  );
}

/** La persona ha visto il filo: i messaggi della fioreria non sono più nuovi (senza ricaricare). */
export async function markMyCareThreadReadAction(subscriptionId: string): Promise<ActionState> {
  return runBuyerAction(
    async ({ ctx }) => {
      await markMyCareThreadRead(ctx, subscriptionId);
      return {};
    },
    { next: accountRoutes.care.thread(subscriptionId) },
  );
}
