/**
 * "Ajuste para el próximo cargo" (ADR-082, blocco 3b): chi gestisce i soldi corregge un errore o fa
 * uno sconto su un contratto. L'ajuste entra una volta, come riga "Ajuste", nel primo cargo che
 * nasce; prima si può togliere ("Quitar", resta nello storico). Solo con il contratto confermato e
 * attivo o in pausa: avrà ancora un cargo.
 *
 * Ordine dei blocchi: il contratto, come l'emissione dei cargos, così un ajuste non entra a metà in
 * un cargo e non si toglie dopo esserci entrato. Nel registro l'importo, mai il motivo.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_CHARGE_LIMITS,
  careAdjustmentSchema,
  formatSubscriptionNumber,
  isUuid,
  toFieldErrors,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { lockSubscription } from './care-internals';

export async function addCareChargeAdjustment(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<{ readonly adjustmentId: string }> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = careAdjustmentSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return null;
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      select: { id: true, number: true, status: true, confirmedAt: true, currency: true },
    });
    if (!contract) return null;
    if (!contract.confirmedAt || (contract.status !== 'ACTIVE' && contract.status !== 'PAUSED')) {
      throw new ConflictError('care_contract_not_editable');
    }
    const pending = await tx.careChargeAdjustment.count({
      where: { tenantId: ctx.tenantId, subscriptionId, removedAt: null, lines: { none: {} } },
    });
    if (pending >= CARE_CHARGE_LIMITS.pendingAdjustments) {
      throw new ValidationError({ amount: 'care_too_many_adjustments' });
    }
    const adjustment = await tx.careChargeAdjustment.create({
      data: {
        tenantId: ctx.tenantId,
        subscriptionId,
        amountMinor: input.amountMinor,
        currency: contract.currency,
        reason: input.reason,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careAdjustmentAdded,
      entityType: 'CareChargeAdjustment',
      entityId: adjustment.id,
      metadata: {
        number: formatSubscriptionNumber(contract.number),
        amountMinor: input.amountMinor,
      },
    });
    return { adjustmentId: adjustment.id };
  });
  if (!result) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return result;
}

/** "Quitar": solo prima che l'ajuste entri in un cargo. Togliere due volte non cambia niente. */
export async function removeCareChargeAdjustment(
  ctx: TenantContext,
  subscriptionId: string,
  adjustmentId: string,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(subscriptionId) || !isUuid(adjustmentId)) {
    throw new NotFoundError('CareChargeAdjustment');
  }
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return false;
    const adjustment = await tx.careChargeAdjustment.findFirst({
      where: { tenantId: ctx.tenantId, subscriptionId, id: adjustmentId },
      select: {
        id: true,
        amountMinor: true,
        removedAt: true,
        lines: { select: { id: true }, take: 1 },
        subscription: { select: { number: true } },
      },
    });
    if (!adjustment) return false;
    if (adjustment.lines.length > 0) throw new ConflictError('care_adjustment_in_charge');
    if (adjustment.removedAt) return true;
    await tx.careChargeAdjustment.update({
      where: { id: adjustment.id, tenantId: ctx.tenantId },
      data: { removedAt: new Date(), removedById: ctx.userId },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careAdjustmentRemoved,
      entityType: 'CareChargeAdjustment',
      entityId: adjustment.id,
      metadata: {
        number: formatSubscriptionNumber(adjustment.subscription.number),
        amountMinor: adjustment.amountMinor,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CareChargeAdjustment', adjustmentId);
}
