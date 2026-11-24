/**
 * Offerta di Floral Care della fioreria (ADR-075, Ajustes → Floral Care): tariffa per uscita, care
 * per pianta secondo la misura, frequenze offerte, raggio e sovrapprezzo per distanza, regole e
 * termini; i servizi (la nostra lista più quelli del fiorista) e le fasce di uscita con capienza.
 * La legge tutta la squadra (`subscriptions:read`); la cambia chi gestisce (`subscriptions:write`).
 *
 * Abbassare la capienza di una fascia, cambiarne l'orario o archiviarla tocca visite già fissate:
 * le visite si spostano (o diventano "Por reprogramar") e senza "Sí, avisé al cliente" il server
 * non salva.
 */
import { getDb, isUniqueViolation, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_LIMITS,
  CARE_SERVICE_PRESETS,
  careNoticeSchema,
  careServiceSchema,
  careSettingsSchema,
  careSlotSchema,
  deliveryFeeTierSchema,
  findCareServicePreset,
  formatTimeOfDay,
  isUuid,
  todayInTimeZone,
  toFieldErrors,
  type CareFrequency,
  type CareServicePresetKey,
  type CareServicePricing,
  type CareServiceUnit,
  type DeadPlantPolicy,
  type MissedVisitPolicy,
  type PlantSize,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { memberScope } from '../scope';
import { requireEntitlement } from './billing';
import { lockCareSlots } from './care-booking';
import {
  applySlotChangeTx,
  loadSlotVisits,
  planSlotChange,
  type RebookResult,
} from './care-generation';

export type { RebookResult } from './care-generation';
import {
  careFeesOf,
  dbDate,
  loadCareSettings,
  loadShopPlace,
  requireCareSettings,
} from './care-internals';

export interface CareServiceDto {
  readonly id: string;
  /** Della nostra lista, o null se l'ha scritto il fiorista. */
  readonly presetKey: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly pricing: CareServicePricing;
  readonly unit: CareServiceUnit;
  readonly priceMinor: number;
  readonly active: boolean;
}

export interface CareSlotDto {
  readonly id: string;
  /** 0 = domenica … 6 = sabato. */
  readonly weekday: number;
  /** "HH:MM" nel fuso della fioreria. */
  readonly start: string;
  readonly end: string;
  readonly capacity: number;
  readonly active: boolean;
  /** Contratti (bozze comprese) che la usano. */
  readonly contracts: number;
  /** Visite programmate da oggi in poi: un cambio le tocca. */
  readonly upcomingVisits: number;
}

export interface CareTravelTierDto {
  readonly id: string;
  readonly maxKm: number;
  readonly feeMinor: number;
}

export interface CareServiceSuggestionDto {
  readonly key: CareServicePresetKey;
  readonly name: string;
  readonly pricing: CareServicePricing;
  readonly unit: CareServiceUnit;
}

export interface CareSettingsDto {
  /** false finché la fioreria non salva l'offerta la prima volta (i valori sono i proposti). */
  readonly configured: boolean;
  readonly visitFeeMinor: number;
  readonly careFees: Readonly<Record<PlantSize, number>>;
  readonly frequencies: readonly CareFrequency[];
  readonly maxDistanceKm: number | null;
  readonly minNoticeHours: number;
  readonly missedVisitPolicy: MissedVisitPolicy;
  readonly deadPlantPolicy: DeadPlantPolicy;
  readonly termsText: string | null;
  /** Raggio di consegna della tienda principale: il punto di partenza proposto per il raggio. */
  readonly deliveryRadiusKm: number | null;
  /** La posizione della tienda per misurare le distanze c'è (coordinate valide). */
  readonly hasOrigin: boolean;
  readonly travelTiers: readonly CareTravelTierDto[];
  /** In ordine: prima gli attivi. */
  readonly services: readonly CareServiceDto[];
  /** Servizi della nostra lista non ancora aggiunti (gli extra chiedono un prezzo). */
  readonly suggestions: readonly CareServiceSuggestionDto[];
  /** In ordine di giorno e di ora; prima le attive. */
  readonly slots: readonly CareSlotDto[];
  readonly currency: string;
  readonly canWrite: boolean;
}

const LIVE_CONTRACT = ['DRAFT', 'ACTIVE', 'PAUSED'] as const;

async function readSettings(tx: TransactionClient, ctx: TenantContext): Promise<CareSettingsDto> {
  const [settings, place, tiers, services, slots] = await Promise.all([
    loadCareSettings(tx, ctx.tenantId),
    loadShopPlace(tx, ctx.tenantId),
    tx.careTravelTier.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { maxMeters: 'asc' },
      select: { id: true, maxMeters: true, feeMinor: true },
    }),
    tx.careService.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    tx.careSlot.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ status: 'asc' }, { weekday: 'asc' }, { startMinutes: 'asc' }],
    }),
  ]);
  const today = todayInTimeZone(ctx.timezone);
  const [links, upcoming] = await Promise.all([
    tx.customerSubscriptionSlot.groupBy({
      by: ['slotId'],
      where: {
        tenantId: ctx.tenantId,
        subscription: { status: { in: [...LIVE_CONTRACT] } },
      },
      _count: { _all: true },
    }),
    tx.careVisit.groupBy({
      by: ['slotId'],
      where: {
        tenantId: ctx.tenantId,
        status: 'SCHEDULED',
        scheduledDate: { gte: dbDate(today) },
      },
      _count: { _all: true },
    }),
  ]);
  const contractsBySlot = new Map(links.map((row) => [row.slotId, row._count._all]));
  const upcomingBySlot = new Map(upcoming.map((row) => [row.slotId, row._count._all]));
  const used = new Set(services.map((service) => service.presetKey).filter(Boolean));
  return {
    configured: settings !== null,
    visitFeeMinor: settings?.visitFeeMinor ?? 0,
    careFees: settings ? careFeesOf(settings) : { SMALL: 0, MEDIUM: 0, LARGE: 0 },
    frequencies: settings?.frequencies ?? ['MONTHLY_1', 'MONTHLY_2'],
    maxDistanceKm: settings ? settings.maxDistanceKm : place.deliveryRadiusKm,
    minNoticeHours: settings?.minNoticeHours ?? 24,
    missedVisitPolicy: settings?.missedVisitPolicy ?? 'COUNTS',
    deadPlantPolicy: settings?.deadPlantPolicy ?? 'QUOTE',
    termsText: settings?.termsText ?? null,
    deliveryRadiusKm: place.deliveryRadiusKm,
    hasOrigin: place.origin !== null,
    travelTiers: tiers.map((tier) => ({
      id: tier.id,
      maxKm: tier.maxMeters / 1000,
      feeMinor: tier.feeMinor,
    })),
    services: services.map((service) => ({
      id: service.id,
      presetKey: service.presetKey,
      name: service.name,
      description: service.description,
      pricing: service.pricing,
      unit: service.unit,
      priceMinor: service.priceMinor,
      active: service.status === 'ACTIVE',
    })),
    suggestions: settings
      ? CARE_SERVICE_PRESETS.filter((preset) => !used.has(preset.key)).map((preset) => ({
          key: preset.key,
          name: preset.name,
          pricing: preset.pricing,
          unit: preset.unit,
        }))
      : [],
    slots: slots.map((slot) => ({
      id: slot.id,
      weekday: slot.weekday,
      start: formatTimeOfDay(slot.startMinutes),
      end: formatTimeOfDay(slot.endMinutes),
      capacity: slot.capacity,
      active: slot.status === 'ACTIVE',
      contracts: contractsBySlot.get(slot.id) ?? 0,
      upcomingVisits: upcomingBySlot.get(slot.id) ?? 0,
    })),
    currency: ctx.currency,
    canWrite: hasPermission(ctx, 'subscriptions:write'),
  };
}

export async function getCareSettings(ctx: TenantContext): Promise<CareSettingsDto> {
  requirePermission(ctx, 'subscriptions:read');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    return readSettings(tx, ctx);
  });
}

/**
 * Salva l'offerta. La prima volta crea anche i servizi inclusi della nostra lista (riego, limpieza
 * de hojas…): gli extra restano proposte da aggiungere con il prezzo del fiorista.
 */
export async function updateCareSettings(ctx: TenantContext, rawInput: unknown): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  const parsed = careSettingsSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    // Una modifica alla volta: la prima creazione e i servizi proposti non si sovrappongono.
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${ctx.tenantId}::uuid FOR UPDATE`;
    const before = await loadCareSettings(tx, ctx.tenantId);
    const data = {
      visitFeeMinor: input.visitFee,
      careFeeSmallMinor: input.careFeeSmall,
      careFeeMediumMinor: input.careFeeMedium,
      careFeeLargeMinor: input.careFeeLarge,
      frequencies: input.frequencies,
      maxDistanceKm: input.maxDistanceKm,
      minNoticeHours: input.minNoticeHours,
      missedVisitPolicy: input.missedVisitPolicy,
      deadPlantPolicy: input.deadPlantPolicy,
      termsText: input.termsText,
    };
    if (!before) {
      await tx.careSettings.create({ data: { tenantId: ctx.tenantId, ...data } });
      await tx.careService.createMany({
        data: CARE_SERVICE_PRESETS.filter((preset) => preset.pricing === 'INCLUDED').map(
          (preset, index) => ({
            tenantId: ctx.tenantId,
            presetKey: preset.key,
            name: preset.name,
            pricing: preset.pricing,
            unit: preset.unit,
            priceMinor: 0,
            sortOrder: index,
          }),
        ),
        skipDuplicates: true,
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.careSettingsUpdated,
        entityType: 'CareSettings',
        entityId: ctx.tenantId,
        metadata: {
          created: true,
          visitFeeMinor: data.visitFeeMinor,
          frequencies: data.frequencies,
        },
      });
      return;
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, value] of Object.entries(data)) {
      const previous = before[field as keyof typeof data];
      const same = Array.isArray(value)
        ? Array.isArray(previous) && previous.join(',') === value.join(',')
        : previous === value;
      // Il testo dei termini non va nel registro: si dice solo che è cambiato.
      if (!same)
        changes[field] =
          field === 'termsText' ? { from: '…', to: '…' } : { from: previous, to: value };
    }
    if (Object.keys(changes).length === 0) return;
    await tx.careSettings.update({ where: { tenantId: ctx.tenantId }, data });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careSettingsUpdated,
      entityType: 'CareSettings',
      entityId: ctx.tenantId,
      metadata: { changes: JSON.parse(JSON.stringify(changes)) },
    });
  });
}

// -----------------------------------------------------------------------------
// Sovrapprezzo per distanza
// -----------------------------------------------------------------------------

export async function addCareTravelTier(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'subscriptions:write');
  const parsed = deliveryFeeTierSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { upToKm: maxMeters, fee: feeMinor } = parsed.data;
  try {
    return await withTenantContext(getDb(), ctx, async (tx) => {
      await requireEntitlement(ctx, 'floralCare', tx);
      await requireCareSettings(tx, ctx.tenantId);
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${ctx.tenantId}::uuid FOR UPDATE`;
      const existing = await tx.careTravelTier.findMany({
        where: { tenantId: ctx.tenantId },
        select: { maxMeters: true },
      });
      if (existing.some((tier) => tier.maxMeters === maxMeters)) {
        throw new ConflictError('care_travel_tier_exists');
      }
      if (existing.length >= CARE_LIMITS.travelTiers) {
        throw new ConflictError('care_travel_tier_limit');
      }
      const created = await tx.careTravelTier.create({
        data: { tenantId: ctx.tenantId, maxMeters, feeMinor },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.careTravelTierAdded,
        entityType: 'CareTravelTier',
        entityId: created.id,
        metadata: { maxKm: maxMeters / 1000, feeMinor },
      });
      return { id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('care_travel_tier_exists');
    throw error;
  }
}

/** I contratti copiano il proprio sovrapprezzo: togliere una fascia non li cambia. */
export async function removeCareTravelTier(ctx: TenantContext, tierId: string): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(tierId)) throw new NotFoundError('CareTravelTier');
  const removed = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const tier = await tx.careTravelTier.findFirst({
      where: { id: tierId, tenantId: ctx.tenantId },
    });
    if (!tier) return false;
    await tx.careTravelTier.deleteMany({ where: { id: tier.id, tenantId: ctx.tenantId } });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careTravelTierRemoved,
      entityType: 'CareTravelTier',
      entityId: tier.id,
      metadata: { maxKm: tier.maxMeters / 1000, feeMinor: tier.feeMinor },
    });
    return true;
  });
  if (!removed) await notFound(ctx, 'CareTravelTier', tierId);
}

// -----------------------------------------------------------------------------
// Servizi
// -----------------------------------------------------------------------------

/** Un servizio nuovo: della nostra lista (`presetKey`) con il prezzo del fiorista, o tutto suo. */
export async function createCareService(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'subscriptions:write');
  const parsed = careServiceSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const rawPreset =
    rawInput && typeof rawInput === 'object' && 'presetKey' in rawInput
      ? (rawInput as { presetKey?: unknown }).presetKey
      : undefined;
  const preset =
    rawPreset === undefined || rawPreset === '' ? null : findCareServicePreset(rawPreset);
  if (rawPreset !== undefined && rawPreset !== '' && !preset) {
    throw new ValidationError({ presetKey: 'invalid_option' });
  }
  try {
    return await withTenantContext(getDb(), ctx, async (tx) => {
      await requireEntitlement(ctx, 'floralCare', tx);
      await requireCareSettings(tx, ctx.tenantId);
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${ctx.tenantId}::uuid FOR UPDATE`;
      const [count, last] = await Promise.all([
        tx.careService.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } }),
        tx.careService.findFirst({
          where: { tenantId: ctx.tenantId },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        }),
      ]);
      if (count >= CARE_LIMITS.services) throw new ConflictError('care_service_limit');
      const created = await tx.careService.create({
        data: {
          tenantId: ctx.tenantId,
          presetKey: preset?.key ?? null,
          name: input.name,
          description: input.description,
          pricing: input.pricing,
          unit: input.unit,
          priceMinor: input.price,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.careServiceCreated,
        entityType: 'CareService',
        entityId: created.id,
        metadata: {
          presetKey: created.presetKey,
          pricing: created.pricing,
          unit: created.unit,
          priceMinor: created.priceMinor,
        },
      });
      return { id: created.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('care_service_exists');
    throw error;
  }
}

/** I contratti copiano nome e prezzo del servizio: un cambio vale per i contratti nuovi e per
 * quelli di cui il fiorista aggiorna il prezzo. */
export async function updateCareService(
  ctx: TenantContext,
  serviceId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(serviceId)) throw new NotFoundError('CareService');
  const parsed = careServiceSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const before = await tx.careService.findFirst({
      where: { id: serviceId, tenantId: ctx.tenantId },
    });
    if (!before) return false;
    const data = {
      name: input.name,
      description: input.description,
      pricing: input.pricing,
      unit: input.unit,
      priceMinor: input.price,
    };
    const changes = Object.fromEntries(
      Object.entries(data)
        .filter(([field, value]) => before[field as keyof typeof data] !== value)
        .map(([field, value]) => [
          field,
          // Nome e descrizione sono testo libero: nel registro solo il fatto che cambiano.
          field === 'name' || field === 'description'
            ? { changed: true }
            : { from: before[field as keyof typeof data], to: value },
        ]),
    );
    if (Object.keys(changes).length === 0) return true;
    await tx.careService.update({ where: { id: before.id, tenantId: ctx.tenantId }, data });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careServiceUpdated,
      entityType: 'CareService',
      entityId: before.id,
      metadata: { changes: JSON.parse(JSON.stringify(changes)) },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CareService', serviceId);
}

/** Archiviato: non si sceglie più nei contratti nuovi; quelli che l'hanno lo tengono. */
export async function setCareServiceActive(
  ctx: TenantContext,
  serviceId: string,
  active: boolean,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(serviceId)) throw new NotFoundError('CareService');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const service = await tx.careService.findFirst({
      where: { id: serviceId, tenantId: ctx.tenantId },
    });
    if (!service) return false;
    const status = active ? 'ACTIVE' : 'ARCHIVED';
    if (service.status === status) return true;
    if (active) {
      const count = await tx.careService.count({
        where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      });
      if (count >= CARE_LIMITS.services) throw new ConflictError('care_service_limit');
    }
    await tx.careService.update({
      where: { id: service.id, tenantId: ctx.tenantId },
      data: { status },
    });
    await recordAudit(tx, ctx, {
      action: active ? AUDIT_ACTIONS.careServiceUpdated : AUDIT_ACTIONS.careServiceArchived,
      entityType: 'CareService',
      entityId: service.id,
      metadata: { status: { from: service.status, to: status } },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CareService', serviceId);
}

// -----------------------------------------------------------------------------
// Fasce di uscita
// -----------------------------------------------------------------------------

export async function createCareSlot(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'subscriptions:write');
  const parsed = careSlotSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    await requireCareSettings(tx, ctx.tenantId);
    // Una fascia nuova non tocca visite: basta mettere in fila le creazioni (conteggio e doppioni).
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${ctx.tenantId}::uuid FOR UPDATE`;
    const active = await tx.careSlot.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { weekday: true, startMinutes: true, endMinutes: true },
    });
    if (
      active.some(
        (slot) =>
          slot.weekday === input.weekday &&
          slot.startMinutes === input.start &&
          slot.endMinutes === input.end,
      )
    ) {
      throw new ConflictError('care_slot_exists');
    }
    if (active.length >= CARE_LIMITS.slots) throw new ConflictError('care_slot_limit');
    const created = await tx.careSlot.create({
      data: {
        tenantId: ctx.tenantId,
        weekday: input.weekday,
        startMinutes: input.start,
        endMinutes: input.end,
        capacity: input.capacity,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careSlotCreated,
      entityType: 'CareSlot',
      entityId: created.id,
      metadata: {
        weekday: input.weekday,
        start: formatTimeOfDay(input.start),
        end: formatTimeOfDay(input.end),
        capacity: input.capacity,
      },
    });
    return { id: created.id };
  });
}

function readNotice(rawInput: unknown): boolean {
  const parsed = careNoticeSchema.safeParse(rawInput ?? {});
  return parsed.success ? parsed.data.customerNotified : false;
}

/**
 * Cambia orario e capienza (e il giorno, se nessun contratto la usa). Le visite future che non ci
 * stanno più si spostano, le altre prendono l'orario nuovo: se ne tocca anche una sola, serve "Sí,
 * avisé al cliente".
 */
export async function updateCareSlot(
  ctx: TenantContext,
  slotId: string,
  rawInput: unknown,
): Promise<RebookResult> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(slotId)) throw new NotFoundError('CareSlot');
  const parsed = careSlotSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const notified = readNotice(rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    await lockCareSlots(tx, ctx.tenantId);
    const slot = await tx.careSlot.findFirst({ where: { id: slotId, tenantId: ctx.tenantId } });
    if (!slot) return null;
    if (slot.status !== 'ACTIVE') throw new ConflictError('care_slot_in_use');
    const today = todayInTimeZone(ctx.timezone);
    const visits = await loadSlotVisits(tx, ctx.tenantId, slot.id, today);
    if (input.weekday !== slot.weekday) {
      const contracts = await tx.customerSubscriptionSlot.count({
        where: {
          tenantId: ctx.tenantId,
          slotId: slot.id,
          subscription: { status: { in: [...LIVE_CONTRACT] } },
        },
      });
      if (contracts > 0 || visits.length > 0) throw new ConflictError('care_slot_in_use');
    }
    const retime = input.start !== slot.startMinutes || input.end !== slot.endMinutes;
    const plan = planSlotChange(visits, input.capacity);
    const touched = plan.move.length + (retime ? plan.keep.length : 0);
    if (touched > 0 && !notified) {
      throw new ValidationError({ customerNotified: 'care_notice_required' });
    }
    if (!retime && input.weekday === slot.weekday && input.capacity === slot.capacity) {
      return { moved: 0, toReschedule: 0, retimed: 0 };
    }
    const duplicate = await tx.careSlot.findFirst({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        id: { not: slot.id },
        weekday: input.weekday,
        startMinutes: input.start,
        endMinutes: input.end,
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictError('care_slot_exists');
    await tx.careSlot.update({
      where: { id: slot.id, tenantId: ctx.tenantId },
      data: {
        weekday: input.weekday,
        startMinutes: input.start,
        endMinutes: input.end,
        capacity: input.capacity,
      },
    });
    const rebooked = await applySlotChangeTx(tx, memberScope(ctx), {
      slotId: slot.id,
      plan,
      today,
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careSlotUpdated,
      entityType: 'CareSlot',
      entityId: slot.id,
      metadata: {
        from: {
          weekday: slot.weekday,
          start: formatTimeOfDay(slot.startMinutes),
          end: formatTimeOfDay(slot.endMinutes),
          capacity: slot.capacity,
        },
        to: {
          weekday: input.weekday,
          start: formatTimeOfDay(input.start),
          end: formatTimeOfDay(input.end),
          capacity: input.capacity,
        },
        ...rebooked,
        customerNotified: touched > 0,
      },
    });
    return rebooked;
  });
  if (!result) return notFound(ctx, 'CareSlot', slotId);
  return result;
}

/**
 * Archivia una fascia: non si sceglie più e le sue visite future cercano un altro posto (stesso
 * giorno, poi la settimana, nello stesso mese) o diventano "Por reprogramar". Con visite toccate
 * serve "Sí, avisé al cliente". I contratti che la usano vanno poi spostati su un'altra fascia.
 */
export async function archiveCareSlot(
  ctx: TenantContext,
  slotId: string,
  rawInput: unknown,
): Promise<RebookResult> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(slotId)) throw new NotFoundError('CareSlot');
  const notified = readNotice(rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    await lockCareSlots(tx, ctx.tenantId);
    const slot = await tx.careSlot.findFirst({ where: { id: slotId, tenantId: ctx.tenantId } });
    if (!slot) return null;
    if (slot.status !== 'ACTIVE') return { moved: 0, toReschedule: 0, retimed: 0 };
    const today = todayInTimeZone(ctx.timezone);
    const plan = planSlotChange(await loadSlotVisits(tx, ctx.tenantId, slot.id, today), null);
    if (plan.move.length > 0 && !notified) {
      throw new ValidationError({ customerNotified: 'care_notice_required' });
    }
    await tx.careSlot.update({
      where: { id: slot.id, tenantId: ctx.tenantId },
      data: { status: 'ARCHIVED' },
    });
    const rebooked = await applySlotChangeTx(tx, memberScope(ctx), {
      slotId: slot.id,
      plan,
      today,
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careSlotArchived,
      entityType: 'CareSlot',
      entityId: slot.id,
      metadata: {
        weekday: slot.weekday,
        start: formatTimeOfDay(slot.startMinutes),
        end: formatTimeOfDay(slot.endMinutes),
        ...rebooked,
        customerNotified: plan.move.length > 0,
      },
    });
    return rebooked;
  });
  if (!result) return notFound(ctx, 'CareSlot', slotId);
  return result;
}

/** Torna disponibile una fascia archiviata (nessuna visita da toccare). */
export async function restoreCareSlot(ctx: TenantContext, slotId: string): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(slotId)) throw new NotFoundError('CareSlot');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    await lockCareSlots(tx, ctx.tenantId);
    const slot = await tx.careSlot.findFirst({ where: { id: slotId, tenantId: ctx.tenantId } });
    if (!slot) return false;
    if (slot.status === 'ACTIVE') return true;
    const active = await tx.careSlot.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { weekday: true, startMinutes: true, endMinutes: true },
    });
    if (active.length >= CARE_LIMITS.slots) throw new ConflictError('care_slot_limit');
    if (
      active.some(
        (other) =>
          other.weekday === slot.weekday &&
          other.startMinutes === slot.startMinutes &&
          other.endMinutes === slot.endMinutes,
      )
    ) {
      throw new ConflictError('care_slot_exists');
    }
    await tx.careSlot.update({
      where: { id: slot.id, tenantId: ctx.tenantId },
      data: { status: 'ACTIVE' },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careSlotUpdated,
      entityType: 'CareSlot',
      entityId: slot.id,
      metadata: { status: { from: 'ARCHIVED', to: 'ACTIVE' } },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CareSlot', slotId);
}
