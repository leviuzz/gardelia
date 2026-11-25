'use server';

/**
 * Server action del riquadro "Acceso del cliente" (ADR-084): invitare, reinviare e revocare un
 * invito, togliere l'accesso a una persona. Il servizio di @floral/core ricontrolla permessi,
 * contratto e cliente; gli ID legati con .bind() arrivano dal client e non sono affidabili.
 */
import {
  inviteCarePortal,
  resendCarePortalInvite,
  revokeCarePortalAccess,
  revokeCarePortalInvite,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { carePortalDeps } from '@/lib/care-portal';
import { formDataToObject } from '@/lib/form-data';
import { runTenantAction } from '@/lib/tenant-action';

export async function inviteCarePortalAction(
  slug: string,
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await inviteCarePortal(
      ctx,
      subscriptionId,
      formDataToObject(formData),
      carePortalDeps(),
    );
    return {
      revalidate: routes.subscriptions.detail(subscriptionId),
      success: result.emailSent ? 'care.portal.invitedEmail' : 'care.portal.invitedLink',
    };
  });
}

export async function resendCarePortalInviteAction(
  slug: string,
  subscriptionId: string,
  inviteId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await resendCarePortalInvite(ctx, inviteId, carePortalDeps());
    return {
      revalidate: routes.subscriptions.detail(subscriptionId),
      success: result.emailSent ? 'care.portal.resentEmail' : 'care.portal.resentLink',
    };
  });
}

export async function revokeCarePortalInviteAction(
  slug: string,
  subscriptionId: string,
  inviteId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await revokeCarePortalInvite(ctx, inviteId);
    return {
      revalidate: routes.subscriptions.detail(subscriptionId),
      success: 'care.portal.inviteRevoked',
    };
  });
}

export async function revokeCarePortalAccessAction(
  slug: string,
  subscriptionId: string,
  accessId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await revokeCarePortalAccess(ctx, accessId);
    return {
      revalidate: routes.subscriptions.detail(subscriptionId),
      success: 'care.portal.accessRemoved',
    };
  });
}
