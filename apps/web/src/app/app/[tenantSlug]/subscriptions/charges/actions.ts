'use server';

/**
 * Server action dei pagamenti di Floral Care (ADR-082): "Registrar pago" su un cargo o
 * sull'estado de cuenta, "Registrar devolución", "Anular". Il servizio di @floral/core valida
 * l'importo, ricontrolla permessi e fioreria e decide su quali cargos va il pagamento: dal client
 * arriva solo quanto ha pagato il cliente. Gli ID legati con .bind() non sono affidabili.
 */
import {
  addCareChargeAdjustment,
  confirmCarePayment,
  recordCareChargePayment,
  recordCustomerCarePayment,
  refundCareCharge,
  rejectCarePayment,
  removeCareChargeAdjustment,
  reverseCarePayment,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import type { TenantRoutes } from '@/lib/routes';
import { runTenantAction, section } from '@/lib/tenant-action';

/** I soldi cambiano: cobros e contratti, la scheda del cliente (estado de cuenta) e il pannello. */
function moneySections(routes: TenantRoutes) {
  return [section(routes.subscriptions.list()), section(routes.customers.list()), routes.home];
}

export async function recordCareChargePaymentAction(
  slug: string,
  subscriptionId: string,
  chargeId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await recordCareChargePayment(ctx, subscriptionId, chargeId, formDataToObject(formData));
    return { revalidate: moneySections(routes), success: 'care.payment.recorded' };
  });
}

export async function refundCareChargeAction(
  slug: string,
  subscriptionId: string,
  chargeId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await refundCareCharge(ctx, subscriptionId, chargeId, formDataToObject(formData));
    return { revalidate: moneySections(routes), success: 'care.payment.refunded' };
  });
}

export async function recordCustomerCarePaymentAction(
  slug: string,
  customerId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await recordCustomerCarePayment(ctx, customerId, formDataToObject(formData));
    return {
      revalidate: moneySections(routes),
      success: (t) => t('care.payment.recordedSplit', { count: result.charges }),
    };
  });
}

export async function reverseCarePaymentAction(
  slug: string,
  paymentId: string,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await reverseCarePayment(ctx, paymentId);
    return { revalidate: moneySections(routes), success: 'care.payment.reversed' };
  });
}

/**
 * Blocco 3b: "Confirmar" un incasso segnato alla visita (l'importo che entra davvero, mai più di
 * quello segnato: lo controlla il servizio) e "Rechazar" con il motivo. Si ricarica anche l'Agenda,
 * dove la visita mostra lo stato dell'incasso.
 */
export async function confirmCarePaymentAction(
  slug: string,
  paymentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const result = await confirmCarePayment(ctx, paymentId, formDataToObject(formData));
    return {
      revalidate: [...moneySections(routes), section(routes.agenda.day())],
      success: (t) => t('care.collections.confirmed', { count: result.charges }),
    };
  });
}

export async function rejectCarePaymentAction(
  slug: string,
  paymentId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await rejectCarePayment(ctx, paymentId, formDataToObject(formData));
    return {
      revalidate: [...moneySections(routes), section(routes.agenda.day())],
      success: 'care.collections.rejected',
    };
  });
}

/** "Ajuste para el próximo cargo" e "Quitar" (blocco 3b), dalla card dei cargos del contratto. */
export async function addCareChargeAdjustmentAction(
  slug: string,
  subscriptionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCareChargeAdjustment(ctx, subscriptionId, formDataToObject(formData));
    return { revalidate: moneySections(routes), success: 'care.adjustments.added' };
  });
}

export async function removeCareChargeAdjustmentAction(
  slug: string,
  subscriptionId: string,
  adjustmentId: string,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeCareChargeAdjustment(ctx, subscriptionId, adjustmentId);
    return { revalidate: moneySections(routes), success: 'care.adjustments.removed' };
  });
}
