'use server';

/**
 * Server action dell'offerta di Floral Care (ADR-074): il servizio di @floral/core valida l'input
 * e ricontrolla permessi, piano e fioreria. Gli ID legati con .bind() arrivano dal client: non
 * sono affidabili (li ricontrolla il servizio).
 */
import {
  addCareTravelTier,
  archiveCareSlot,
  createCareService,
  createCareSlot,
  removeCareTravelTier,
  restoreCareSlot,
  setCareServiceActive,
  updateCareService,
  updateCareSettings,
  updateCareSlot,
  type RebookResult,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import { runTenantAction, section, type Translate } from '@/lib/tenant-action';

/** Cosa è successo alle visite di una fascia cambiata o archiviata. */
function rebookMessage(result: RebookResult, base: string) {
  return (t: Translate) => {
    const parts = [t(base)];
    if (result.moved > 0) parts.push(t('care.slots.moved', { count: result.moved }));
    if (result.toReschedule > 0) {
      parts.push(t('care.slots.toReschedule', { count: result.toReschedule }));
    }
    if (result.retimed > 0) parts.push(t('care.slots.retimed', { count: result.retimed }));
    return parts.join(' ');
  };
}

export async function updateCareSettingsAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateCareSettings(ctx, formDataToObject(formData, ['frequencies']));
    return { revalidate: routes.settings.care, success: 'care.offer.saved' };
  });
}

export async function addCareTravelTierAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCareTravelTier(ctx, formDataToObject(formData));
    return { revalidate: routes.settings.care, success: 'care.tiers.added' };
  });
}

export async function removeCareTravelTierAction(
  slug: string,
  tierId: string,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeCareTravelTier(ctx, tierId);
    return { revalidate: routes.settings.care, success: 'care.tiers.removed' };
  });
}

export async function createCareServiceAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await createCareService(ctx, formDataToObject(formData));
    return { revalidate: routes.settings.care, success: 'care.services.created' };
  });
}

export async function updateCareServiceAction(
  slug: string,
  serviceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateCareService(ctx, serviceId, formDataToObject(formData));
    return { revalidate: routes.settings.care, success: 'care.services.updated' };
  });
}

export async function setCareServiceActiveAction(
  slug: string,
  serviceId: string,
  active: boolean,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setCareServiceActive(ctx, serviceId, active === true);
    return {
      revalidate: routes.settings.care,
      success: active === true ? 'care.services.restored' : 'care.services.archived',
    };
  });
}

export async function createCareSlotAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await createCareSlot(ctx, formDataToObject(formData));
    return { revalidate: routes.settings.care, success: 'care.slots.created' };
  });
}

export async function updateCareSlotAction(
  slug: string,
  slotId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await updateCareSlot(ctx, slotId, formDataToObject(formData));
    return {
      // Le visite spostate compaiono nell'Agenda e nei contratti.
      revalidate: [
        routes.settings.care,
        section(routes.agenda.day()),
        section(routes.subscriptions.list()),
      ],
      success: rebookMessage(result, 'care.slots.updated'),
    };
  });
}

export async function archiveCareSlotAction(
  slug: string,
  slotId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await archiveCareSlot(ctx, slotId, formDataToObject(formData));
    return {
      revalidate: [
        routes.settings.care,
        section(routes.agenda.day()),
        section(routes.subscriptions.list()),
      ],
      success: rebookMessage(result, 'care.slots.archived'),
    };
  });
}

export async function restoreCareSlotAction(slug: string, slotId: string): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await restoreCareSlot(ctx, slotId);
    return { revalidate: routes.settings.care, success: 'care.slots.restored' };
  });
}
