/**
 * Impostazioni di consegna (ADR-055, blocco A2): fasce orarie proposte negli ordini, giorni di
 * chiusura e costo di consegna predefinito. Le legge chi compila un ordine; le cambia chi gestisce
 * la fioreria. Il costo per distanza arriva con le coordinate degli indirizzi (O-14).
 */
import { getDb, isUniqueViolation, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  DELIVERY_LIMITS,
  deliverySettingsSchema,
  deliveryWindowSchema,
  formatTimeOfDay,
  isUuid,
  isWeekday,
  toFieldErrors,
  type Weekday,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

export interface DeliveryWindowDto {
  readonly id: string;
  /** "HH:MM" nel fuso della fioreria. */
  readonly start: string;
  readonly end: string;
}

export interface DeliverySettingsDto {
  /** In ordine di inizio. */
  readonly windows: readonly DeliveryWindowDto[];
  /** 0 = domenica … 6 = sabato. */
  readonly closedWeekdays: readonly Weekday[];
  readonly defaultFeeMinor: number;
  /** Chi guarda può cambiarle. */
  readonly canWrite: boolean;
}

export async function getDeliverySettings(ctx: TenantContext): Promise<DeliverySettingsDto> {
  requirePermission(ctx, 'tenant:read');
  return withTenantContext(getDb(), ctx, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { deliveryClosedWeekdays: true, defaultDeliveryFeeMinor: true },
    });
    const windows = await tx.deliveryWindow.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ startMinutes: 'asc' }, { endMinutes: 'asc' }],
    });
    return {
      windows: windows.map((window) => ({
        id: window.id,
        start: formatTimeOfDay(window.startMinutes),
        end: formatTimeOfDay(window.endMinutes),
      })),
      closedWeekdays: tenant.deliveryClosedWeekdays.filter(isWeekday),
      defaultFeeMinor: tenant.defaultDeliveryFeeMinor,
      canWrite: hasPermission(ctx, 'tenant:settings:update'),
    };
  });
}

export async function updateDeliverySettings(ctx: TenantContext, rawInput: unknown): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = deliverySettingsSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await withTenantContext(getDb(), ctx, async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { deliveryClosedWeekdays: true, defaultDeliveryFeeMinor: true },
    });
    const sameDays =
      before.deliveryClosedWeekdays.length === input.closedWeekdays.length &&
      before.deliveryClosedWeekdays.every((day, index) => day === input.closedWeekdays[index]);
    if (sameDays && before.defaultDeliveryFeeMinor === input.defaultFee) return;
    await tx.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        deliveryClosedWeekdays: input.closedWeekdays,
        defaultDeliveryFeeMinor: input.defaultFee,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.deliverySettingsUpdated,
      entityType: 'Tenant',
      entityId: ctx.tenantId,
      metadata: {
        changes: {
          ...(sameDays
            ? {}
            : {
                closedWeekdays: { from: before.deliveryClosedWeekdays, to: input.closedWeekdays },
              }),
          ...(before.defaultDeliveryFeeMinor === input.defaultFee
            ? {}
            : {
                defaultDeliveryFeeMinor: {
                  from: before.defaultDeliveryFeeMinor,
                  to: input.defaultFee,
                },
              }),
        },
      },
    });
  });
}

export async function addDeliveryWindow(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = deliveryWindowSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { start, end } = parsed.data;
  try {
    return await withTenantContext(getDb(), ctx, async (tx) => {
      // Una fascia alla volta per fioreria: il conteggio e l'inserimento non si sovrappongono.
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${ctx.tenantId}::uuid FOR UPDATE`;
      const existing = await tx.deliveryWindow.findMany({
        where: { tenantId: ctx.tenantId },
        select: { startMinutes: true, endMinutes: true },
      });
      if (existing.some((window) => window.startMinutes === start && window.endMinutes === end)) {
        throw new ConflictError('delivery_window_exists');
      }
      if (existing.length >= DELIVERY_LIMITS.windows) {
        throw new ConflictError('delivery_window_limit');
      }
      const created = await tx.deliveryWindow.create({
        data: { tenantId: ctx.tenantId, startMinutes: start, endMinutes: end },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.deliveryWindowAdded,
        entityType: 'DeliveryWindow',
        entityId: created.id,
        metadata: { start: formatTimeOfDay(start), end: formatTimeOfDay(end) },
      });
      return { id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('delivery_window_exists');
    throw error;
  }
}

/** Gli ordini copiano i propri minuti: togliere una fascia non cambia gli ordini già fatti. */
export async function removeDeliveryWindow(ctx: TenantContext, windowId: string): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  if (!isUuid(windowId)) throw new NotFoundError('DeliveryWindow');
  const removed = await withTenantContext(getDb(), ctx, async (tx) => {
    const window = await tx.deliveryWindow.findFirst({
      where: { id: windowId, tenantId: ctx.tenantId },
    });
    if (!window) return false;
    await tx.deliveryWindow.deleteMany({ where: { id: window.id, tenantId: ctx.tenantId } });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.deliveryWindowRemoved,
      entityType: 'DeliveryWindow',
      entityId: window.id,
      metadata: {
        start: formatTimeOfDay(window.startMinutes),
        end: formatTimeOfDay(window.endMinutes),
      },
    });
    return true;
  });
  if (!removed) await notFound(ctx, 'DeliveryWindow', windowId);
}
