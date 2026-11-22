'use server';

/**
 * Server action del CRM: validazione con gli schemi del dominio, poi il servizio di
 * @floral/core. Contesto, errori, pagine da ricaricare e messaggi: `runTenantAction`.
 * Gli ID legati con .bind() arrivano dal client: i servizi li ricontrollano nel tenant.
 */
import {
  addCustomerAddress,
  addCustomerOccasion,
  archiveCustomerAddress,
  createCustomer,
  removeCustomerOccasion,
  setCustomerArchived,
  updateCustomer,
  updateCustomerAddress,
} from '@floral/core';
import { customerFormSchema } from '@floral/domain';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject, parseForm } from '@/lib/form-data';
import { runTenantAction, section } from '@/lib/tenant-action';

export async function createCustomerAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { id } = await createCustomer(ctx, parseForm(customerFormSchema(ctx.country), formData));
    return {
      revalidate: routes.customers.list(),
      redirectTo: routes.customers.detail(id, { created: true }),
    };
  });
}

export async function updateCustomerAction(
  slug: string,
  customerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateCustomer(ctx, customerId, parseForm(customerFormSchema(ctx.country), formData));
    return { revalidate: section(routes.customers.list()), success: 'common.changesSaved' };
  });
}

export async function setCustomerArchivedAction(
  slug: string,
  customerId: string,
  archived: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setCustomerArchived(ctx, customerId, archived);
    return {
      revalidate: section(routes.customers.list()),
      success: archived ? 'customers.form.archived' : 'customers.form.restored',
    };
  });
}

export async function addAddressAction(
  slug: string,
  customerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCustomerAddress(ctx, customerId, formDataToObject(formData));
    return {
      revalidate: routes.customers.detail(customerId),
      success: 'customers.addresses.added',
    };
  });
}

export async function updateAddressAction(
  slug: string,
  customerId: string,
  addressId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateCustomerAddress(ctx, customerId, addressId, formDataToObject(formData));
    return {
      revalidate: routes.customers.detail(customerId),
      success: 'customers.addresses.updated',
    };
  });
}

export async function archiveAddressAction(
  slug: string,
  customerId: string,
  addressId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await archiveCustomerAddress(ctx, customerId, addressId);
    return {
      revalidate: routes.customers.detail(customerId),
      success: 'customers.addresses.removed',
    };
  });
}

/** Le ricorrenze compaiono anche nella dashboard ("Próximas fechas"). */
export async function addOccasionAction(
  slug: string,
  customerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCustomerOccasion(ctx, customerId, formDataToObject(formData));
    return {
      revalidate: [routes.customers.detail(customerId), routes.home],
      success: 'customers.occasions.added',
    };
  });
}

export async function removeOccasionAction(
  slug: string,
  customerId: string,
  occasionId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeCustomerOccasion(ctx, customerId, occasionId);
    return {
      revalidate: [routes.customers.detail(customerId), routes.home],
      success: 'customers.occasions.removed',
    };
  });
}
