'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import {
  changeMemberRole,
  getMailer,
  inviteMember,
  revokeInvitation,
  setMemberActive,
  updatePrimaryLocation,
  updateTenantLegal,
  updateTenantProfile,
} from '@floral/core';
import { actionError, type ActionState } from '@/lib/actions';
import { serverEnv } from '@/lib/env';
import { formDataToObject } from '@/lib/form-data';
import { getTenantContext } from '@/lib/tenant';

async function saved(): Promise<ActionState> {
  const t = await getTranslations('settings');
  return { status: 'success', message: t('saved') };
}

export async function updateProfileAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await updateTenantProfile(ctx, formDataToObject(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}`, 'layout');
  return saved();
}

export async function updateLegalAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await updateTenantLegal(ctx, formDataToObject(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/settings`);
  return saved();
}

export async function updateLocationAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await updatePrimaryLocation(ctx, formDataToObject(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/settings`);
  return saved();
}

export async function inviteMemberAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  const t = await getTranslations('team');
  try {
    const data = formDataToObject(formData);
    const result = await inviteMember(ctx, data, {
      mailer: getMailer(),
      appUrl: serverEnv().APP_URL,
    });
    revalidatePath(`/app/${ctx.tenantSlug}/settings/team`);
    return result.emailSent
      ? {
          status: 'success',
          message: t('invited', { email: String(data.email ?? '').toLowerCase() }),
        }
      : { status: 'error', message: t('invitedNoEmail') };
  } catch (error) {
    return actionError(error);
  }
}

export async function revokeInvitationAction(
  slug: string,
  invitationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await revokeInvitation(ctx, invitationId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/settings/team`);
  const t = await getTranslations('team');
  return { status: 'success', message: t('revoked') };
}

export async function changeRoleAction(
  slug: string,
  membershipId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await changeMemberRole(ctx, membershipId, { role: formData.get('role') });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/settings/team`);
  const t = await getTranslations('team');
  return { status: 'success', message: t('roleChanged') };
}

export async function setMemberActiveAction(
  slug: string,
  membershipId: string,
  active: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await setMemberActive(ctx, membershipId, active);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/settings/team`);
  const t = await getTranslations('team');
  return { status: 'success', message: active ? t('reactivated') : t('deactivated') };
}
