'use server';

/**
 * Server action delle visite di Floral Care nell'Agenda (ADR-075, ADR-078): la visita dal telefono
 * (Empezar, passi, foto, Terminar, No se pudo, resoconto), spostare, cancellare, assegnare, il link
 * del resoconto e gli avvisi per chi gestisce. Il servizio di @floral/core ricontrolla permessi,
 * piano, fioreria, stato della visita, posti nella fascia e la casella "Sí, avisé al cliente".
 * Gli ID legati con .bind() arrivano dal client: non sono affidabili.
 */
import {
  addCareFollowUp,
  addCareVisitPhoto,
  assignCareVisit,
  cancelCareVisit,
  finishCareVisit,
  markAllCarePlantsOk,
  markCareVisitNotDone,
  moveCareVisit,
  removeCareVisitPhoto,
  resolveCareFollowUp,
  revokePublicLink,
  saveCareVisitNote,
  sendCareVisitReport,
  setCareVisitMaterial,
  setCareVisitPlantResult,
  setCareVisitServiceResult,
  sharePublicLink,
  startCareVisit,
  type CareReportDelivery,
  type CareVisitCloseResult,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { serverEnv } from '@/lib/env';
import { formDataToObject } from '@/lib/form-data';
import { orderMailDeps } from '@/lib/order-mail';
import type { TenantRoutes } from '@/lib/routes';
import { runTenantAction, section, type ActionOutcome } from '@/lib/tenant-action';
import { uploadedBytes } from '@/lib/uploads';

/** Una visita cambia: l'Agenda (giorno, mese, ruta, da riprogrammare) e la scheda del contratto. */
function visitSections(routes: TenantRoutes) {
  return [section(routes.agenda.day()), section(routes.subscriptions.list())];
}

/** Un passo della visita in corso: si ricarica solo la sua pagina (risposte piccole sul posto). */
function visitPage(routes: TenantRoutes, visitId: string) {
  return routes.agenda.visit(visitId);
}

/** Cosa dire dopo "Terminar" o "No se pudo", secondo il resoconto per il cliente. */
function closeOutcome(
  routes: TenantRoutes,
  result: CareVisitCloseResult,
  closedKey: string,
): ActionOutcome {
  const revalidate = visitSections(routes);
  if (result.alreadyClosed) return { revalidate, success: 'care.visitWork.alreadyClosed' };
  return reportOutcome(revalidate, result.report, closedKey);
}

function reportOutcome(
  revalidate: ActionOutcome['revalidate'],
  report: CareReportDelivery,
  doneKey: string,
): ActionOutcome {
  switch (report) {
    case 'sent':
      return { revalidate, success: 'care.visitWork.reportSent' };
    case 'failed':
      return { revalidate, warning: 'care.visitWork.reportFailed' };
    case 'no_email':
      return { revalidate, success: 'care.visitWork.reportNoEmail' };
    case 'demo':
      return { revalidate, success: 'care.visitWork.reportDemo' };
    default:
      return { revalidate, success: doneKey };
  }
}

// -----------------------------------------------------------------------------
// La visita dal telefono
// -----------------------------------------------------------------------------

export async function startCareVisitAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await startCareVisit(ctx, visitId);
    return { revalidate: visitSections(routes), success: 'care.visitWork.started' };
  });
}

export async function setCareServiceResultAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setCareVisitServiceResult(ctx, visitId, formDataToObject(formData));
    return { revalidate: visitPage(routes, visitId) };
  });
}

export async function setCarePlantResultAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setCareVisitPlantResult(ctx, visitId, formDataToObject(formData));
    return { revalidate: visitPage(routes, visitId) };
  });
}

export async function markAllCarePlantsOkAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { marked } = await markAllCarePlantsOk(ctx, visitId);
    return {
      revalidate: visitPage(routes, visitId),
      success: (t) => t('care.visitWork.allOkSaved', { count: marked }),
    };
  });
}

export async function setCareMaterialAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const input = formDataToObject(formData);
    await setCareVisitMaterial(ctx, visitId, input);
    return {
      revalidate: visitPage(routes, visitId),
      success: input.quantity === '0' ? 'care.visitWork.materialRemoved' : undefined,
    };
  });
}

export async function saveCareVisitNoteAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await saveCareVisitNote(ctx, visitId, formDataToObject(formData));
    return { revalidate: visitPage(routes, visitId), success: 'care.visitWork.noteSaved' };
  });
}

export async function addCareFollowUpAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCareFollowUp(ctx, visitId, formDataToObject(formData));
    return {
      revalidate: [visitPage(routes, visitId), routes.agenda.followUps(), routes.agenda.day()],
      success: 'care.followUps.created',
    };
  });
}

/** Una foto per richiesta (il limite di 4 MB vale per tutta la richiesta). */
export async function uploadCareVisitPhotoAction(
  slug: string,
  visitId: string,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCareVisitPhoto(ctx, visitId, await uploadedBytes(formData), {
      uploadKey: formData.get('uploadKey'),
      plantId: formData.get('plantId'),
    });
    return { revalidate: visitPage(routes, visitId) };
  });
}

export async function removeCareVisitPhotoAction(
  slug: string,
  visitId: string,
  photoId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeCareVisitPhoto(ctx, visitId, photoId);
    return { revalidate: visitPage(routes, visitId), success: 'care.visitWork.photoRemoved' };
  });
}

export async function finishCareVisitAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await finishCareVisit(ctx, visitId, formDataToObject(formData), orderMailDeps());
    return closeOutcome(routes, result, 'care.visitWork.finished');
  });
}

export async function markCareVisitNotDoneAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await markCareVisitNotDone(
      ctx,
      visitId,
      formDataToObject(formData),
      orderMailDeps(),
    );
    return closeOutcome(routes, result, 'care.visit.notDoneSaved');
  });
}

/** "Enviar reporte" / "Reintentar". */
export async function sendCareVisitReportAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const report = await sendCareVisitReport(ctx, visitId, orderMailDeps());
    return reportOutcome(visitPage(routes, visitId), report, 'care.visitWork.reportSent');
  });
}

/** Link del resoconto: crearlo o, con `renew=1`, rinnovarlo (solo chi gestisce). */
export async function shareCareVisitLinkAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const renew = formData.get('renew') === '1';
    await sharePublicLink(
      ctx,
      serverEnv().BETTER_AUTH_SECRET,
      { kind: 'CARE_VISIT', id: visitId },
      { renew },
    );
    return {
      revalidate: visitPage(routes, visitId),
      success: renew ? 'shareLink.renewed' : 'shareLink.created',
    };
  });
}

export async function revokeCareVisitLinkAction(
  slug: string,
  visitId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await revokePublicLink(ctx, { kind: 'CARE_VISIT', id: visitId });
    return { revalidate: visitPage(routes, visitId), success: 'shareLink.revoked' };
  });
}

/** "Atendido": chi gestisce chiude un avviso della squadra. */
export async function resolveCareFollowUpAction(
  slug: string,
  followUpId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await resolveCareFollowUp(ctx, followUpId, formDataToObject(formData));
    return {
      revalidate: [section(routes.agenda.day()), section(routes.subscriptions.list())],
      success: 'care.followUps.resolved',
    };
  });
}

// -----------------------------------------------------------------------------
// Chi gestisce: spostare, cancellare, assegnare (blocco 1)
// -----------------------------------------------------------------------------

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
