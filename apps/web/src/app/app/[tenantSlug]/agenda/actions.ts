'use server';

/**
 * Server action delle visite di Floral Care nell'Agenda (ADR-075): "Hecha", "No se pudo",
 * spostare, cancellare, assegnare. Il servizio di @floral/core ricontrolla permessi, piano,
 * fioreria, posti nella fascia e la casella "Sí, avisé al cliente". Gli ID legati con .bind()
 * arrivano dal client: non sono affidabili.
 */
import {
  assignCareVisit,
  cancelCareVisit,
  completeCareVisit,
  markCareVisitNotDone,
  moveCareVisit,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import type { TenantRoutes } from '@/lib/routes';
import { runTenantAction, section } from '@/lib/tenant-action';

/** Una visita cambia: l'Agenda (giorno, mese, da riprogrammare) e la scheda del contratto. */
function visitSections(routes: TenantRoutes) {
  return [section(routes.agenda.day()), section(routes.subscriptions.list())];
}

export async function completeCareVisitAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await completeCareVisit(ctx, visitId, formDataToObject(formData));
    return { revalidate: visitSections(routes), success: 'care.visit.doneSaved' };
  });
}

export async function markCareVisitNotDoneAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await markCareVisitNotDone(ctx, visitId, formDataToObject(formData));
    return { revalidate: visitSections(routes), success: 'care.visit.notDoneSaved' };
  });
}

/** Il modulo manda una scelta "AAAA-MM-GG_idFascia": qui si separa, il servizio ricontrolla tutto. */
export async function moveCareVisitAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const input = formDataToObject(formData);
    const option = typeof input.option === 'string' ? input.option : '';
    const [date = '', slotId = ''] = option.split('_');
    await moveCareVisit(ctx, visitId, { ...input, date, slotId });
    return { revalidate: visitSections(routes), success: 'care.visit.moved' };
  });
}

export async function cancelCareVisitAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await cancelCareVisit(ctx, visitId, formDataToObject(formData));
    return { revalidate: visitSections(routes), success: 'care.visit.cancelled' };
  });
}

export async function assignCareVisitAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await assignCareVisit(ctx, visitId, formData.get('assignee'));
    return { revalidate: visitSections(routes), success: 'care.visit.assigned' };
  });
}
