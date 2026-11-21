'use server';

/**
 * Server action del CRM: contesto tenant → validazione → servizio di @floral/core.
 * Gli ID legati con .bind() arrivano dal client: i servizi li ricontrollano nel tenant.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ValidationError,
  addCustomerAddress,
  addCustomerOccasion,
  archiveCustomerAddress,
  createCustomer,
  removeCustomerOccasion,
  setCustomerArchived,
  updateCustomer,
  updateCustomerAddress,
} from '@floral/core';
import { customerFormSchema, toFieldErrors } from '@floral/domain';
import { actionError, type ActionState } from '@/lib/actions';
import { formDataToObject } from '@/lib/form-data';
import { getTenantContext } from '@/lib/tenant';

function parseCustomerForm(country: Parameters<typeof customerFormSchema>[0], formData: FormData) {
  const parsed = customerFormSchema(country).safeParse(formDataToObject(formData));
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

export async function createCustomerAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  let customerId: string;
  try {
    customerId = (await createCustomer(ctx, parseCustomerForm(ctx.country, formData))).id;
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/customers`);
  redirect(`/app/${ctx.tenantSlug}/customers/${customerId}?created=1`);
}

export async function updateCustomerAction(
  slug: string,
  customerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await updateCustomer(ctx, customerId, parseCustomerForm(ctx.country, formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/customers`, 'layout');
  const t = await getTranslations('common');
  return { status: 'success', message: t('changesSaved') };
}

export async function setCustomerArchivedAction(
  slug: string,
  customerId: string,
  archived: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await setCustomerArchived(ctx, customerId, archived);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/customers`, 'layout');
  const t = await getTranslations('customers.form');
  return { status: 'success', message: archived ? t('archived') : t('restored') };
}

export async function addAddressAction(
  slug: string,
  customerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await addCustomerAddress(ctx, customerId, formDataToObject(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/customers/${customerId}`);
  const t = await getTranslations('customers.addresses');
  return { status: 'success', message: t('added') };
}

export async function updateAddressAction(
  slug: string,
  customerId: string,
  addressId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await updateCustomerAddress(ctx, customerId, addressId, formDataToObject(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/customers/${customerId}`);
  const t = await getTranslations('customers.addresses');
  return { status: 'success', message: t('updated') };
}

export async function archiveAddressAction(
  slug: string,
  customerId: string,
  addressId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await archiveCustomerAddress(ctx, customerId, addressId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/customers/${customerId}`);
  const t = await getTranslations('customers.addresses');
  return { status: 'success', message: t('removed') };
}

export async function addOccasionAction(
  slug: string,
  customerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await addCustomerOccasion(ctx, customerId, formDataToObject(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/customers/${customerId}`);
  revalidatePath(`/app/${ctx.tenantSlug}`);
  const t = await getTranslations('customers.occasions');
  return { status: 'success', message: t('added') };
}

export async function removeOccasionAction(
  slug: string,
  customerId: string,
  occasionId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await removeCustomerOccasion(ctx, customerId, occasionId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/customers/${customerId}`);
  revalidatePath(`/app/${ctx.tenantSlug}`);
  const t = await getTranslations('customers.occasions');
  return { status: 'success', message: t('removed') };
}
