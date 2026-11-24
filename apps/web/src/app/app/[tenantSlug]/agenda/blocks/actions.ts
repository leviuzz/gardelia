'use server';

/**
 * Server action dei giorni bloccati (ADR-083): salvare un blocco dall'anteprima, toglierlo,
 * mandare l'avviso a un contratto toccato, cambiare la persona di più visite. Il servizio di
 * @floral/core ricontrolla tutto (date, fascia, impronta del piano, "Sí, avisé al cliente");
 * gli ID legati con .bind() arrivano dal client e non sono affidabili.
 */
import {
  createCareBlock,
  reassignCareVisits,
  removeCareBlock,
  sendCareBlockNotice,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import { orderMailDeps } from '@/lib/order-mail';
import type { TenantRoutes } from '@/lib/routes';
import { runTenantAction, section } from '@/lib/tenant-action';

/** Un blocco sposta visite: Agenda (con i blocchi) e contratti. */
function agendaSections(routes: TenantRoutes) {
  return [section(routes.agenda.day()), section(routes.subscriptions.list())];
}

export async function createCareBlockAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await createCareBlock(ctx, formDataToObject(formData), orderMailDeps());
    return {
      revalidate: agendaSections(routes),
      redirectTo: routes.agenda.block(result.blockId, { created: 1 }),
    };
  });
}

export async function removeCareBlockAction(
  slug: string,
  blockId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeCareBlock(ctx, blockId);
    return { revalidate: agendaSections(routes), success: 'care.blocks.removed' };
  });
}

export async function sendCareBlockNoticeAction(
  slug: string,
  blockId: string,
  subscriptionId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const outcome = await sendCareBlockNotice(ctx, blockId, subscriptionId, orderMailDeps());
    return outcome === 'sent'
      ? { revalidate: routes.agenda.block(blockId), success: 'care.blocks.noticeSent' }
      : { revalidate: routes.agenda.block(blockId), warning: 'care.blocks.noticeFailed' };
  });
}

export async function reassignCareVisitsAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { count } = await reassignCareVisits(ctx, formDataToObject(formData));
    return {
      revalidate: agendaSections(routes),
      success: (t) => t('care.blocks.reassigned', { count }),
    };
  });
}
