/**
 * Impostazioni di consegna (ADR-055, blocco A2): fasce orarie proposte negli ordini, giorni di
 * chiusura, costo di consegna predefinito e costo per distanza a fasce di km (ADR-069). Le legge
 * chi compila un ordine; le cambia chi gestisce la fioreria.
 */
import { getDb, isUniqueViolation, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  DELIVERY_LIMITS,
  deliverySettingsSchema,
  deliveryWindowSchema,
  deliveryFeeTierSchema,
  formatTimeOfDay,
  freshCoordinates,
  isUuid,
  sortFeeTiers,
  isWeekday,
  toFieldErrors,
  type Coordinates,
  type DeliveryFeeTier,
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
  /** Costo per distanza (ADR-069), dalla fascia più vicina. */
  readonly feeTiers: readonly DeliveryFeeTierDto[];
  /**
   * Posizione della tienda (coordinate di Google ancora valide) da cui si misura la distanza, o
   * null: senza, il costo per distanza non si può calcolare e vale quello abituale.
   */
  readonly origin: Coordinates | null;
  /** Chi guarda può cambiarle. */
  readonly canWrite: boolean;
}

export interface DeliveryFeeTierDto {
  readonly id: string;
  /** Fin dove arriva, in km (può avere un decimale). */
  readonly maxKm: number;
  readonly feeMinor: number;
}

/** Come si prezza la consegna di questa fioreria: fasce, costo abituale e posizione della tienda. */
export interface DeliveryPricing {
  readonly tiers: readonly DeliveryFeeTier[];
  readonly defaultFeeMinor: number;
  readonly origin: Coordinates | null;
}

/**
 * Fasce, costo abituale e posizione della tienda principale, dentro una transazione già aperta nel
 * contesto della fioreria (la usano anche gli ordini online, senza un membro).
 */
export async function loadDeliveryPricing(
  tx: TransactionClient,
  tenantId: string,
): Promise<DeliveryPricing> {
  const [tenant, tiers, location] = await Promise.all([
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { defaultDeliveryFeeMinor: true },
    }),
    tx.deliveryFeeTier.findMany({
      where: { tenantId },
      select: { maxMeters: true, feeMinor: true },
    }),
    tx.location.findFirst({
      where: { tenantId, isPrimary: true },
      select: { latitude: true, longitude: true, coordinatesAt: true },
    }),
  ]);
  return {
    tiers: sortFeeTiers(tiers),
    defaultFeeMinor: tenant.defaultDeliveryFeeMinor,
    origin: location ? freshCoordinates(location, new Date()) : null,
  };
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
    const [tiers, pricing] = await Promise.all([
      tx.deliveryFeeTier.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { maxMeters: 'asc' },
        select: { id: true, maxMeters: true, feeMinor: true },
      }),
      loadDeliveryPricing(tx, ctx.tenantId),
    ]);
    return {
      windows: windows.map((window) => ({
        id: window.id,
        start: formatTimeOfDay(window.startMinutes),
        end: formatTimeOfDay(window.endMinutes),
      })),
      closedWeekdays: tenant.deliveryClosedWeekdays.filter(isWeekday),
      defaultFeeMinor: tenant.defaultDeliveryFeeMinor,
      feeTiers: tiers.map((tier) => ({
        id: tier.id,
        maxKm: tier.maxMeters / 1000,
        feeMinor: tier.feeMinor,
      })),
      origin: pricing.origin,
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

// -----------------------------------------------------------------------------
// Costo per distanza (ADR-069)
// -----------------------------------------------------------------------------

/** "Hasta X km: $Y". Una fascia per distanza; al massimo `DELIVERY_LIMITS.feeTiers`. */
export async function addDeliveryFeeTier(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = deliveryFeeTierSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { upToKm: maxMeters, fee: feeMinor } = parsed.data;
  try {
    return await withTenantContext(getDb(), ctx, async (tx) => {
      // Una modifica alla volta per fioreria: il conteggio e l'inserimento non si sovrappongono.
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${ctx.tenantId}::uuid FOR UPDATE`;
      const existing = await tx.deliveryFeeTier.findMany({
        where: { tenantId: ctx.tenantId },
        select: { maxMeters: true },
      });
      if (existing.some((tier) => tier.maxMeters === maxMeters)) {
        throw new ConflictError('delivery_fee_tier_exists');
      }
      if (existing.length >= DELIVERY_LIMITS.feeTiers) {
        throw new ConflictError('delivery_fee_tier_limit');
      }
      const created = await tx.deliveryFeeTier.create({
        data: { tenantId: ctx.tenantId, maxMeters, feeMinor },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.deliveryFeeTierAdded,
        entityType: 'DeliveryFeeTier',
        entityId: created.id,
        metadata: { maxKm: maxMeters / 1000, feeMinor },
      });
      return { id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('delivery_fee_tier_exists');
    throw error;
  }
}

/** Gli ordini copiano il proprio costo: togliere una fascia non cambia gli ordini già fatti. */
export async function removeDeliveryFeeTier(ctx: TenantContext, tierId: string): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  if (!isUuid(tierId)) throw new NotFoundError('DeliveryFeeTier');
  const removed = await withTenantContext(getDb(), ctx, async (tx) => {
    const tier = await tx.deliveryFeeTier.findFirst({
      where: { id: tierId, tenantId: ctx.tenantId },
    });
    if (!tier) return false;
    await tx.deliveryFeeTier.deleteMany({ where: { id: tier.id, tenantId: ctx.tenantId } });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.deliveryFeeTierRemoved,
      entityType: 'DeliveryFeeTier',
      entityId: tier.id,
      metadata: { maxKm: tier.maxMeters / 1000, feeMinor: tier.feeMinor },
    });
    return true;
  });
  if (!removed) await notFound(ctx, 'DeliveryFeeTier', tierId);
}
