'use server';

/**
 * Server action delle impostazioni e del team: il servizio di @floral/core valida l'input e
 * ricontrolla permessi e fioreria. Contesto, errori, pagine da ricaricare e messaggi:
 * `runTenantAction`. Gli ID legati con .bind() arrivano dal client: non sono affidabili.
 */
import {
  addDeliveryWindow,
  changeMemberRole,
  getMailer,
  inviteMember,
  removeDeliveryWindow,
  revokeInvitation,
  setMemberActive,
  setOnlineStorePublished,
  updateBuilderSettings,
  updateDeliverySettings,
  updateOnlineStore,
  updatePrimaryLocation,
  updateTenantLegal,
  updateTenantProfile,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { serverEnv } from '@/lib/env';
import { formDataToObject } from '@/lib/form-data';
import { runTenantAction, section } from '@/lib/tenant-action';

export async function updateProfileAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateTenantProfile(ctx, formDataToObject(formData));
    // Il nome della fioreria compare in tutte le pagine (menu, intestazioni).
    return { revalidate: section(routes.home), success: 'settings.saved' };
  });
}

export async function updateBuilderSettingsAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateBuilderSettings(ctx, formDataToObject(formData));
    return { revalidate: section(routes.builder.list()), success: 'builder.settings.saved' };
  });
}

export async function updateLegalAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateTenantLegal(ctx, formDataToObject(formData));
    return { revalidate: routes.settings.general, success: 'settings.saved' };
  });
}

export async function updateLocationAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updatePrimaryLocation(ctx, formDataToObject(formData));
    return { revalidate: routes.settings.general, success: 'settings.saved' };
  });
}

/** L'invito resta anche se l'email non parte: lo si dice come errore, con la pagina aggiornata. */
export async function inviteMemberAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const data = formDataToObject(formData);
    const { emailSent } = await inviteMember(ctx, data, {
      mailer: getMailer(),
      appUrl: serverEnv().APP_URL,
    });
    const email = String(data.email ?? '').toLowerCase();
    return emailSent
      ? { revalidate: routes.settings.team, success: (t) => t('team.invited', { email }) }
      : { revalidate: routes.settings.team, warning: 'team.invitedNoEmail' };
  });
}

export async function revokeInvitationAction(
  slug: string,
  invitationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await revokeInvitation(ctx, invitationId);
    return { revalidate: routes.settings.team, success: 'team.revoked' };
  });
}

export async function changeRoleAction(
  slug: string,
  membershipId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await changeMemberRole(ctx, membershipId, { role: formData.get('role') });
    return { revalidate: routes.settings.team, success: 'team.roleChanged' };
  });
}

export async function setMemberActiveAction(
  slug: string,
  membershipId: string,
  active: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setMemberActive(ctx, membershipId, active);
    return {
      revalidate: routes.settings.team,
      success: active ? 'team.reactivated' : 'team.deactivated',
    };
  });
}

// -----------------------------------------------------------------------------
// Consegne (ADR-055): le leggono i form degli ordini, che si ricaricano.
// -----------------------------------------------------------------------------

export async function updateDeliverySettingsAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateDeliverySettings(ctx, formDataToObject(formData, ['closedWeekdays']));
    return {
      revalidate: [routes.settings.general, section(routes.orders.list())],
      success: 'settings.delivery.saved',
    };
  });
}

export async function addDeliveryWindowAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addDeliveryWindow(ctx, formDataToObject(formData));
    return {
      revalidate: [routes.settings.general, section(routes.orders.list())],
      success: 'settings.delivery.windowAdded',
    };
  });
}

export async function removeDeliveryWindowAction(
  slug: string,
  windowId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeDeliveryWindow(ctx, windowId);
    return {
      revalidate: [routes.settings.general, section(routes.orders.list())],
      success: 'settings.delivery.windowRemoved',
    };
  });
}

/** "Mi tienda en línea" (ADR-065): descrizione e forme di pagamento. */
export async function updateOnlineStoreAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateOnlineStore(ctx, formDataToObject(formData, ['paymentMethods']));
    return { revalidate: routes.settings.store, success: 'store.saved' };
  });
}

/** Pubblica (`true`) o ritira la tienda; il servizio ricontrolla permessi e requisiti. */
export async function setOnlineStorePublishedAction(
  slug: string,
  publish: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setOnlineStorePublished(ctx, publish === true);
    return {
      revalidate: routes.settings.store,
      success: publish ? 'store.publishedToast' : 'store.unpublishedToast',
    };
  });
}
