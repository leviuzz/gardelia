'use server';

/**
 * Server action di "Mi cuenta" (blocco C1). L'utente arriva SOLO dalla sessione
 * (`runBuyerAction`); l'ID di un indirizzo legato con `.bind()` viene dal browser e il servizio lo
 * cerca solo fra quelli della persona (RLS per utente).
 */
import {
  addBuyerAddress,
  archiveBuyerAddress,
  cancelMarketplaceOrder,
  updateBuyerAddress,
  updateBuyerProfile,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { runBuyerAction } from '@/lib/buyer';
import { formDataToObject } from '@/lib/form-data';
import { orderMailDeps } from '@/lib/order-mail';
import { getRequestMeta } from '@/lib/request-meta';
import { accountRoutes } from '@/lib/routes';

export async function updateBuyerProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(async ({ ctx }) => {
    await updateBuyerProfile(ctx, formDataToObject(formData));
    return { revalidate: accountRoutes.home, success: 'common.changesSaved' };
  });
}

export async function addBuyerAddressAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(async ({ ctx }) => {
    await addBuyerAddress(ctx, formDataToObject(formData));
    return { revalidate: accountRoutes.home, success: 'customers.addresses.added' };
  });
}

export async function updateBuyerAddressAction(
  addressId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(async ({ ctx }) => {
    await updateBuyerAddress(ctx, addressId, formDataToObject(formData));
    return { revalidate: accountRoutes.home, success: 'customers.addresses.updated' };
  });
}

export async function archiveBuyerAddressAction(
  addressId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(async ({ ctx }) => {
    await archiveBuyerAddress(ctx, addressId);
    return { revalidate: accountRoutes.home, success: 'customers.addresses.removed' };
  });
}

/**
 * "Cancelar pedido" in "Mis pedidos" e nella pagina dell'ordine (M3): solo un ordine online ancora
 * da accettare. L'ID arriva dal browser: il servizio lo cerca solo fra gli ordini della persona e
 * ricontrolla lo stato.
 */
export async function cancelBuyerOrderAction(
  orderId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runBuyerAction(async ({ ctx }) => {
    await cancelMarketplaceOrder(ctx, orderId, orderMailDeps(), {
      request: await getRequestMeta(),
    });
    return {
      revalidate: [accountRoutes.home, accountRoutes.orders.detail(orderId)],
      success: 'account.orders.cancelled',
    };
  });
}
