'use server';

/**
 * Server action dei contratti di Floral Care (ADR-075): il servizio di @floral/core valida l'input
 * e ricontrolla permessi, piano e fioreria; il prezzo lo calcola solo il server. Gli ID legati con
 * .bind() arrivano dal client: non sono affidabili (il servizio cerca tutto dentro la fioreria).
 */
import {
  addCarePlant,
  changeCareSchedule,
  confirmCareContract,
  createCareContract,
  discardCareContract,
  endCareContract,
  removeCarePlant,
  repriceCareContract,
  updateCareContractDetails,
  updateCareContractDraft,
  updateCarePlant,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import type { TenantRoutes } from '@/lib/routes';
import { runTenantAction, section, type Translate } from '@/lib/tenant-action';

const CONTRACT_LISTS = ['slotIds', 'serviceIds'] as const;

/** Il contratto cambia: elenco e schede, l'Agenda (visite) e i clienti (scheda con i contratti). */
function careSections(routes: TenantRoutes) {
  return [
    section(routes.subscriptions.list()),
    section(routes.agenda.day()),
    section(routes.customers.list()),
  ];
}

function generatedMessage(
  base: string,
  result: { readonly scheduled: number; readonly toReschedule: number },
) {
  return (t: Translate) => {
    const parts = [t(base, { count: result.scheduled })];
    if (result.toReschedule > 0) {
      parts.push(t('care.slots.toReschedule', { count: result.toReschedule }));
    }
    return parts.join(' ');
  };
}

export async function createCareContractAction(
  slug: string,
  customerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { id } = await createCareContract(
      ctx,
      customerId,
      formDataToObject(formData, CONTRACT_LISTS),
    );
    // Dopo il redirect il toast non c'è più: la scheda lo dice con `?created=1`.
    return {
      revalidate: careSections(routes),
      redirectTo: routes.subscriptions.detail(id, { created: 1 }),
    };
  });
}

export async function updateCareContractDraftAction(
  slug: string,
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateCareContractDraft(ctx, subscriptionId, formDataToObject(formData, CONTRACT_LISTS));
    return {
      revalidate: careSections(routes),
      redirectTo: routes.subscriptions.detail(subscriptionId),
    };
  });
}

export async function updateCareContractDetailsAction(
  slug: string,
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateCareContractDetails(
      ctx,
      subscriptionId,
      formDataToObject(formData, ['serviceIds']),
    );
    return { revalidate: careSections(routes), success: 'care.contracts.saved' };
  });
}

export async function discardCareContractAction(
  slug: string,
  subscriptionId: string,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await discardCareContract(ctx, subscriptionId);
    return {
      revalidate: careSections(routes),
      redirectTo: routes.subscriptions.list({ view: 'closed' }),
    };
  });
}

export async function confirmCareContractAction(
  slug: string,
  subscriptionId: string,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await confirmCareContract(ctx, subscriptionId);
    return {
      revalidate: careSections(routes),
      success: generatedMessage('care.contracts.confirmed', result),
    };
  });
}

export async function repriceCareContractAction(
  slug: string,
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { changed } = await repriceCareContract(ctx, subscriptionId, formDataToObject(formData));
    return {
      revalidate: careSections(routes),
      success: changed ? 'care.contracts.repriced' : 'care.contracts.priceSame',
    };
  });
}

export async function changeCareScheduleAction(
  slug: string,
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await changeCareSchedule(
      ctx,
      subscriptionId,
      formDataToObject(formData, ['slotIds']),
    );
    return {
      revalidate: careSections(routes),
      success: generatedMessage('care.contracts.scheduleChanged', result),
    };
  });
}

export async function endCareContractAction(
  slug: string,
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await endCareContract(ctx, subscriptionId, formDataToObject(formData));
    return {
      revalidate: careSections(routes),
      success: (t) =>
        t(result.ended ? 'care.contracts.endedNow' : 'care.contracts.endScheduled', {
          count: result.cancelled,
        }),
    };
  });
}

export async function addCarePlantAction(
  slug: string,
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCarePlant(ctx, subscriptionId, formDataToObject(formData));
    return {
      revalidate: routes.subscriptions.detail(subscriptionId),
      success: 'care.plants.added',
    };
  });
}

/** `subscriptionId` serve solo a ricaricare la pagina: la pianta si cerca dentro la fioreria. */
export async function updateCarePlantAction(
  slug: string,
  subscriptionId: string,
  plantId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateCarePlant(ctx, plantId, formDataToObject(formData));
    return {
      revalidate: routes.subscriptions.detail(subscriptionId),
      success: 'care.plants.updated',
    };
  });
}

export async function removeCarePlantAction(
  slug: string,
  subscriptionId: string,
  plantId: string,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeCarePlant(ctx, plantId);
    return {
      revalidate: routes.subscriptions.detail(subscriptionId),
      success: 'care.plants.removed',
    };
  });
}
