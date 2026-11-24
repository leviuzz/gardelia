/**
 * Contratti di Floral Care (ADR-075, blocco 1). Si parte da una bozza (sede, frequenza e fasce,
 * primo giorno, servizi, dati pratici) a cui si aggiungono le piante della diagnosi, anche a
 * gruppi. Il prezzo lo calcola il server alla conferma e si copia nel contratto: poi le visite si
 * creano da sole per 60 giorni.
 *
 * Dopo la conferma si possono cambiare calendario, prezzo e fine. Ogni cambio che tocca visite già
 * fissate chiede "Sí, avisé al cliente" (decisione del founder del 24/11/2026). Niente si cancella:
 * una bozza scartata resta CANCELLED, un contratto finito resta ENDED.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_LIMITS,
  CARE_PAGE_SIZE,
  addDays,
  careContractDetailsSchema,
  careContractListFiltersSchema,
  careContractSchema,
  careEndSchema,
  careNoticeSchema,
  carePlantSchema,
  careScheduleChangeSchema,
  careScheduleProblem,
  careTravelForDistance,
  compareDates,
  estimateCareMonth,
  formatSubscriptionNumber,
  formatTimeOfDay,
  isUuid,
  speciesOption,
  toFieldErrors,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
  type CareContractView,
  type CareFrequency,
  type CareServicePricing,
  type CareServiceUnit,
  type CareTravelQuote,
  type CareExtraFee,
  type CareExtraKind,
  type CareVisitCancelReason,
  type CareVisitPrice,
  type CareVisitStatus,
  type CustomerSubscriptionStatus,
  type PlantLight,
  type PlantSize,
} from '@floral/domain';
import type { CareSettings } from '@floral/db';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { memberScope } from '../scope';
import { requireEntitlement } from './billing';
import { lockCareSlots } from './care-booking';
import {
  cancelOpenVisitsTx,
  extendCareVisitsTx,
  type CareGenerationResult,
} from './care-generation';
import {
  addressLineOf,
  dbDate,
  earlierDate,
  isoOf,
  laterDate,
  loadCareSettings,
  loadCareTravelTiers,
  lockSubscription,
  measureSiteDistance,
  openVisitsFrom,
  priceContractNow,
  requireCareSettings,
  requiredParts,
} from './care-internals';
import { dateToParts, nextTenantCounter } from './quote-internals';

export type { CareGenerationResult } from './care-generation';

// -----------------------------------------------------------------------------
// DTO
// -----------------------------------------------------------------------------

export interface CarePlantDto {
  readonly id: string;
  readonly name: string;
  readonly speciesId: string | null;
  /** Nome della specie nella lingua di chi guarda. */
  readonly speciesName: string | null;
  readonly quantity: number;
  readonly size: PlantSize;
  readonly location: string | null;
  readonly light: PlantLight | null;
  readonly watering: string | null;
  readonly instructions: string | null;
  /** Pianta del cambio di stagione: fuori dal prezzo, si archivia al ritiro (ADR-078). */
  readonly seasonal: boolean;
}

export interface CareContractSlotDto {
  readonly id: string;
  readonly weekday: number;
  readonly start: string;
  readonly end: string;
  readonly active: boolean;
}

export interface CareContractServiceDto {
  readonly serviceId: string;
  readonly name: string;
  readonly pricing: CareServicePricing;
  readonly unit: CareServiceUnit;
  readonly priceMinor: number;
}

export interface CareVisitSummaryDto {
  readonly id: string;
  readonly status: CareVisitStatus;
  /** Giorno programmato; null per "Por reprogramar". */
  readonly date: string | null;
  readonly originalDate: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly isExtra: boolean;
  /** Visita extra (ADR-078): perché e quale costo. */
  readonly extraKind: CareExtraKind | null;
  readonly extraFee: CareExtraFee | null;
  readonly assigneeName: string | null;
  readonly cancelReason: CareVisitCancelReason | null;
}

/** Il prezzo salvato alla conferma (o all'ultimo aggiornamento). */
export interface CareSavedPriceDto {
  readonly visitFeeMinor: number;
  readonly travelSurchargeMinor: number;
  readonly perVisitMinor: number;
  readonly oneTimeMinor: number;
  readonly monthly: { readonly minMinor: number; readonly maxMinor: number };
}

/** Il prezzo con l'offerta, le piante e i servizi di oggi. */
export interface CareCurrentPriceDto extends CareVisitPrice {
  readonly monthly: { readonly minMinor: number; readonly maxMinor: number };
}

export interface CareContractDetailDto {
  readonly id: string;
  readonly numberLabel: string;
  readonly status: CustomerSubscriptionStatus;
  readonly customer: { readonly id: string; readonly name: string; readonly archived: boolean };
  readonly address: {
    readonly id: string;
    readonly label: string | null;
    readonly line: string;
    readonly city: string;
  } | null;
  readonly frequency: CareFrequency | null;
  readonly seats: number;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly slots: readonly CareContractSlotDto[];
  readonly services: readonly CareContractServiceDto[];
  readonly plants: readonly CarePlantDto[];
  readonly plantCount: number;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly accessNotes: string | null;
  readonly notes: string | null;
  readonly saved: CareSavedPriceDto | null;
  /** Null se l'offerta non c'è o il prezzo non si può calcolare. */
  readonly current: CareCurrentPriceDto | null;
  /** Il prezzo salvato non corrisponde più a piante, servizi e tariffe di oggi. */
  readonly priceOutdated: boolean;
  readonly travel: CareTravelQuote | null;
  readonly outOfRange: boolean;
  /** Prossime visite (da oggi), comprese quelle "Por reprogramar". */
  readonly upcoming: readonly CareVisitSummaryDto[];
  readonly upcomingCount: number;
  readonly toReschedule: number;
  /** Ultime visite chiuse o cancellate. */
  readonly recent: readonly CareVisitSummaryDto[];
  readonly scheduleVersion: number;
  readonly priceVersion: number;
  readonly confirmedAt: Date | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;
  readonly currency: string;
  /** Cosa va sistemato prima di confermare o cambiare: fasce archiviate, frequenza non offerta. */
  readonly issues: {
    readonly archivedSlots: boolean;
    readonly frequencyUnavailable: boolean;
    readonly addressArchived: boolean;
  };
  readonly canWrite: boolean;
  readonly canVisit: boolean;
}

export interface CareContractListItemDto {
  readonly id: string;
  readonly numberLabel: string;
  readonly status: CustomerSubscriptionStatus;
  readonly customerId: string;
  readonly customerName: string;
  readonly addressLine: string | null;
  readonly frequency: CareFrequency | null;
  /** Prezzo salvato di una visita; null per le bozze. */
  readonly perVisitMinor: number | null;
  readonly currency: string;
  readonly nextVisit: string | null;
  readonly toReschedule: number;
  readonly plantCount: number;
}

export interface CareContractListResult {
  readonly items: readonly CareContractListItemDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly view: CareContractView;
  readonly counts: Readonly<Record<CareContractView, number>>;
  readonly canWrite: boolean;
}

export interface CareContractFormDto {
  readonly configured: boolean;
  readonly customer: { readonly id: string; readonly name: string };
  readonly addresses: readonly {
    readonly id: string;
    readonly label: string | null;
    readonly line: string;
    readonly city: string;
  }[];
  readonly frequencies: readonly CareFrequency[];
  readonly slots: readonly {
    readonly id: string;
    readonly weekday: number;
    readonly start: string;
    readonly end: string;
    readonly capacity: number;
  }[];
  readonly services: readonly CareContractServiceDto[];
  /** "AAAA-MM-GG": primo giorno possibile, ultimo, proposto. */
  readonly startMin: string;
  readonly startMax: string;
  readonly startDefault: string;
  readonly maxDistanceKm: number | null;
  readonly currency: string;
}

const STATUSES_BY_VIEW: Readonly<Record<CareContractView, readonly CustomerSubscriptionStatus[]>> =
  {
    active: ['ACTIVE', 'PAUSED'],
    draft: ['DRAFT'],
    closed: ['ENDED', 'CANCELLED'],
  };

const EDITABLE: readonly CustomerSubscriptionStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED'];

// -----------------------------------------------------------------------------
// Controlli comuni
// -----------------------------------------------------------------------------

function startBounds(today: CalendarDate) {
  return { min: today, max: addDays(today, CARE_LIMITS.startDaysMax) };
}

function assertStartInRange(date: CalendarDate, today: CalendarDate): void {
  const bounds = startBounds(today);
  if (compareDates(date, bounds.min) < 0 || compareDates(date, bounds.max) > 0) {
    throw new ValidationError({ startDate: 'care_start_out_of_range' });
  }
}

/** Frequenza offerta, fasce attive e giuste per la frequenza. */
async function resolveSlots(
  tx: TransactionClient,
  tenantId: string,
  settings: CareSettings,
  input: { readonly frequency: CareFrequency; readonly slotIds: readonly string[] },
): Promise<{ id: string; weekday: number }[]> {
  if (!settings.frequencies.includes(input.frequency)) {
    throw new ValidationError({ frequency: 'care_frequency_unavailable' });
  }
  const ids = [...new Set(input.slotIds)];
  const slots = await tx.careSlot.findMany({
    where: { tenantId, id: { in: ids }, status: 'ACTIVE' },
    select: { id: true, weekday: true },
  });
  if (slots.length !== ids.length) throw new ValidationError({ slotIds: 'invalid_option' });
  const problem = careScheduleProblem(input.frequency, slots);
  if (problem) throw new ValidationError({ slotIds: problem });
  return slots;
}

/** Servizi attivi (o già nel contratto, anche se poi archiviati). */
async function resolveServices(
  tx: TransactionClient,
  tenantId: string,
  serviceIds: readonly string[],
  linked: ReadonlySet<string>,
) {
  const ids = [...new Set(serviceIds)];
  const services = await tx.careService.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, name: true, pricing: true, unit: true, priceMinor: true, status: true },
  });
  if (
    services.length !== ids.length ||
    services.some((service) => service.status !== 'ACTIVE' && !linked.has(service.id))
  ) {
    throw new ValidationError({ serviceIds: 'invalid_option' });
  }
  return services;
}

/** Sede del cliente, attiva; distanza misurata (o salvata) e controllo del raggio. */
async function resolveSite(
  tx: TransactionClient,
  tenantId: string,
  settings: CareSettings,
  input: {
    readonly customerId: string;
    readonly customerAddressId: string;
    readonly outOfRangeConfirmed: boolean;
    readonly savedMeters: number | null;
  },
): Promise<{ distanceMeters: number | null; outOfRange: boolean }> {
  const address = await tx.customerAddress.findFirst({
    where: {
      tenantId,
      id: input.customerAddressId,
      customerId: input.customerId,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  if (!address) throw new ValidationError({ customerAddressId: 'invalid_option' });
  const distanceKm = await measureSiteDistance(tx, tenantId, {
    customerAddressId: address.id,
    savedMeters: input.savedMeters,
  });
  const travel = careTravelForDistance({
    tiers: await loadCareTravelTiers(tx, tenantId),
    maxDistanceKm: settings.maxDistanceKm,
    distanceKm,
  });
  if (travel.kind === 'out_of_range' && !input.outOfRangeConfirmed) {
    throw new ValidationError({ outOfRangeConfirmed: 'care_out_of_range' });
  }
  return {
    distanceMeters: distanceKm === null ? null : Math.round(distanceKm * 1000),
    outOfRange: travel.kind === 'out_of_range',
  };
}

async function replaceSlotLinks(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
  slotIds: readonly string[],
): Promise<void> {
  await tx.customerSubscriptionSlot.deleteMany({ where: { tenantId, subscriptionId } });
  await tx.customerSubscriptionSlot.createMany({
    data: slotIds.map((slotId) => ({ tenantId, subscriptionId, slotId })),
  });
}

/** Servizi del contratto: tolti quelli non più scelti, aggiunti i nuovi con nome e prezzo di oggi. */
async function replaceServiceLinks(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
  services: readonly {
    readonly id: string;
    readonly name: string;
    readonly pricing: CareServicePricing;
    readonly unit: CareServiceUnit;
    readonly priceMinor: number;
  }[],
): Promise<void> {
  const ids = services.map((service) => service.id);
  await tx.customerSubscriptionService.deleteMany({
    where: { tenantId, subscriptionId, serviceId: { notIn: ids } },
  });
  const existing = await tx.customerSubscriptionService.findMany({
    where: { tenantId, subscriptionId },
    select: { serviceId: true },
  });
  const kept = new Set(existing.map((link) => link.serviceId));
  const added = services.filter((service) => !kept.has(service.id));
  if (added.length === 0) return;
  await tx.customerSubscriptionService.createMany({
    data: added.map((service) => ({
      tenantId,
      subscriptionId,
      serviceId: service.id,
      name: service.name,
      pricing: service.pricing,
      unit: service.unit,
      priceMinor: service.priceMinor,
    })),
  });
}

/** Alla conferma e all'aggiornamento del prezzo: nome e prezzo dei servizi copiati da oggi. */
async function refreshServiceSnapshots(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
): Promise<void> {
  const links = await tx.customerSubscriptionService.findMany({
    where: { tenantId, subscriptionId },
    select: {
      id: true,
      service: { select: { name: true, pricing: true, unit: true, priceMinor: true } },
    },
  });
  for (const link of links) {
    await tx.customerSubscriptionService.update({
      where: { id: link.id, tenantId },
      data: {
        name: link.service.name,
        pricing: link.service.pricing,
        unit: link.service.unit,
        priceMinor: link.service.priceMinor,
      },
    });
  }
}

function readNotice(rawInput: unknown): boolean {
  const parsed = careNoticeSchema.safeParse(rawInput ?? {});
  return parsed.success ? parsed.data.customerNotified : false;
}

function requireNotice(touched: number, notified: boolean): void {
  if (touched > 0 && !notified) {
    throw new ValidationError({ customerNotified: 'care_notice_required' });
  }
}

async function loadSubscription(tx: TransactionClient, ctx: TenantContext, id: string) {
  return tx.customerSubscription.findFirst({
    where: { tenantId: ctx.tenantId, id, kind: 'CARE' },
    include: { slots: { include: { slot: true } } },
  });
}

// -----------------------------------------------------------------------------
// Bozza
// -----------------------------------------------------------------------------

/** Cosa serve al modulo del contratto: sedi del cliente, frequenze, fasce e servizi offerti. */
export async function getCareContractForm(
  ctx: TenantContext,
  customerId: string,
): Promise<CareContractFormDto> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const customer = await tx.customer.findFirst({
      where: { tenantId: ctx.tenantId, id: customerId },
      select: { id: true, displayName: true },
    });
    if (!customer) return null;
    const [settings, addresses, slots, services] = await Promise.all([
      loadCareSettings(tx, ctx.tenantId),
      tx.customerAddress.findMany({
        where: { tenantId: ctx.tenantId, customerId: customer.id, status: 'ACTIVE' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, label: true, addressLine1: true, neighborhood: true, city: true },
      }),
      tx.careSlot.findMany({
        where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
        orderBy: [{ weekday: 'asc' }, { startMinutes: 'asc' }],
      }),
      tx.careService.findMany({
        where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    return { customer, settings, addresses, slots, services };
  });
  if (!found) return notFound(ctx, 'Customer', customerId);
  const bounds = startBounds(today);
  return {
    configured: found.settings !== null,
    customer: { id: found.customer.id, name: found.customer.displayName },
    addresses: found.addresses.map((address) => ({
      id: address.id,
      label: address.label,
      line: addressLineOf(address),
      city: address.city,
    })),
    frequencies: found.settings?.frequencies ?? [],
    slots: found.slots.map((slot) => ({
      id: slot.id,
      weekday: slot.weekday,
      start: formatTimeOfDay(slot.startMinutes),
      end: formatTimeOfDay(slot.endMinutes),
      capacity: slot.capacity,
    })),
    services: found.services.map((service) => ({
      serviceId: service.id,
      name: service.name,
      pricing: service.pricing,
      unit: service.unit,
      priceMinor: service.priceMinor,
    })),
    startMin: toIsoDate(bounds.min),
    startMax: toIsoDate(bounds.max),
    startDefault: toIsoDate(addDays(today, 1)),
    maxDistanceKm: found.settings?.maxDistanceKm ?? null,
    currency: ctx.currency,
  };
}

/** Nuova bozza dalla scheda del cliente. Il prezzo arriva alla conferma, dopo le piante. */
export async function createCareContract(
  ctx: TenantContext,
  customerId: string,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const parsed = careContractSchema(ctx.country).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  assertStartInRange(input.startDate, today);
  const created = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const customer = await tx.customer.findFirst({
      where: { tenantId: ctx.tenantId, id: customerId },
      select: { id: true, status: true },
    });
    if (!customer) return null;
    if (customer.status !== 'ACTIVE') throw new ConflictError('care_customer_archived');
    const settings = await requireCareSettings(tx, ctx.tenantId);
    const site = await resolveSite(tx, ctx.tenantId, settings, {
      customerId: customer.id,
      customerAddressId: input.customerAddressId,
      outOfRangeConfirmed: input.outOfRangeConfirmed,
      savedMeters: null,
    });
    const slots = await resolveSlots(tx, ctx.tenantId, settings, input);
    const services = await resolveServices(tx, ctx.tenantId, input.serviceIds, new Set());
    const number = await nextTenantCounter(tx, ctx.tenantId, 'subscription');
    const subscription = await tx.customerSubscription.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        customerId: customer.id,
        kind: 'CARE',
        status: 'DRAFT',
        customerAddressId: input.customerAddressId,
        frequency: input.frequency,
        seats: input.seats,
        startDate: dbDate(input.startDate),
        currency: ctx.currency,
        distanceMeters: site.distanceMeters,
        outOfRange: site.outOfRange,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        accessNotes: input.accessNotes,
        notes: input.notes,
        createdById: ctx.userId,
      },
    });
    await replaceSlotLinks(
      tx,
      ctx.tenantId,
      subscription.id,
      slots.map((slot) => slot.id),
    );
    await replaceServiceLinks(tx, ctx.tenantId, subscription.id, services);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.subscriptionCreated,
      entityType: 'CustomerSubscription',
      entityId: subscription.id,
      metadata: {
        number: formatSubscriptionNumber(number),
        kind: 'CARE',
        frequency: input.frequency,
        slots: slots.length,
        services: services.length,
      },
    });
    return subscription.id;
  });
  if (!created) return notFound(ctx, 'Customer', customerId);
  return { id: created };
}

/** Cambia tutto della bozza (stesso modulo della creazione). */
export async function updateCareContractDraft(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = careContractSchema(ctx.country).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  assertStartInRange(input.startDate, today);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return false;
    const subscription = await loadSubscription(tx, ctx, subscriptionId);
    if (!subscription) return false;
    if (subscription.status !== 'DRAFT') throw new ConflictError('care_contract_not_editable');
    const settings = await requireCareSettings(tx, ctx.tenantId);
    const sameSite = subscription.customerAddressId === input.customerAddressId;
    const site = await resolveSite(tx, ctx.tenantId, settings, {
      customerId: subscription.customerId,
      customerAddressId: input.customerAddressId,
      outOfRangeConfirmed: input.outOfRangeConfirmed,
      savedMeters: sameSite ? subscription.distanceMeters : null,
    });
    const slots = await resolveSlots(tx, ctx.tenantId, settings, input);
    const linked = await tx.customerSubscriptionService.findMany({
      where: { tenantId: ctx.tenantId, subscriptionId },
      select: { serviceId: true },
    });
    const services = await resolveServices(
      tx,
      ctx.tenantId,
      input.serviceIds,
      new Set(linked.map((link) => link.serviceId)),
    );
    await tx.customerSubscription.update({
      where: { id: subscription.id, tenantId: ctx.tenantId },
      data: {
        customerAddressId: input.customerAddressId,
        frequency: input.frequency,
        seats: input.seats,
        startDate: dbDate(input.startDate),
        distanceMeters: site.distanceMeters,
        outOfRange: site.outOfRange,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        accessNotes: input.accessNotes,
        notes: input.notes,
      },
    });
    await replaceSlotLinks(
      tx,
      ctx.tenantId,
      subscription.id,
      slots.map((slot) => slot.id),
    );
    await replaceServiceLinks(tx, ctx.tenantId, subscription.id, services);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.subscriptionUpdated,
      entityType: 'CustomerSubscription',
      entityId: subscription.id,
      metadata: {
        number: formatSubscriptionNumber(subscription.number),
        draft: true,
        frequency: input.frequency,
        slots: slots.length,
        services: services.length,
        siteChanged: !sameSite,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CustomerSubscription', subscriptionId);
}

/**
 * Servizi e dati pratici della sede di un contratto confermato. Nessuna visita cambia; se i servizi
 * cambiano il prezzo, la scheda lo segnala e il fiorista lo aggiorna (`repriceCareContract`).
 */
export async function updateCareContractDetails(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = careContractDetailsSchema(ctx.country).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return false;
    const subscription = await loadSubscription(tx, ctx, subscriptionId);
    if (!subscription) return false;
    if (!EDITABLE.includes(subscription.status)) {
      throw new ConflictError('care_contract_not_editable');
    }
    const linked = await tx.customerSubscriptionService.findMany({
      where: { tenantId: ctx.tenantId, subscriptionId },
      select: { serviceId: true },
    });
    const linkedIds = new Set(linked.map((link) => link.serviceId));
    const services = await resolveServices(tx, ctx.tenantId, input.serviceIds, linkedIds);
    await tx.customerSubscription.update({
      where: { id: subscription.id, tenantId: ctx.tenantId },
      data: {
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        accessNotes: input.accessNotes,
        notes: input.notes,
      },
    });
    await replaceServiceLinks(tx, ctx.tenantId, subscription.id, services);
    const nextIds = new Set(services.map((service) => service.id));
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.subscriptionUpdated,
      entityType: 'CustomerSubscription',
      entityId: subscription.id,
      metadata: {
        number: formatSubscriptionNumber(subscription.number),
        servicesAdded: [...nextIds].filter((id) => !linkedIds.has(id)).length,
        servicesRemoved: [...linkedIds].filter((id) => !nextIds.has(id)).length,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CustomerSubscription', subscriptionId);
}

/** Una bozza che non andrà avanti: resta nell'elenco dei chiusi come "Descartado". */
export async function discardCareContract(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return false;
    const subscription = await loadSubscription(tx, ctx, subscriptionId);
    if (!subscription) return false;
    if (subscription.status !== 'DRAFT') throw new ConflictError('care_contract_not_editable');
    await tx.customerSubscription.update({
      where: { id: subscription.id, tenantId: ctx.tenantId },
      data: { status: 'CANCELLED' },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.subscriptionDiscarded,
      entityType: 'CustomerSubscription',
      entityId: subscription.id,
      metadata: { number: formatSubscriptionNumber(subscription.number) },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CustomerSubscription', subscriptionId);
}

// -----------------------------------------------------------------------------
// Piante
// -----------------------------------------------------------------------------

async function checkSpecies(tx: TransactionClient, speciesId: string | null): Promise<void> {
  if (speciesId === null) return;
  const species = await tx.canonicalFlower.findUnique({
    where: { id: speciesId },
    select: { id: true },
  });
  if (!species) throw new ValidationError({ canonicalFlowerId: 'invalid_option' });
}

/** Una riga di piante (anche un gruppo: "12 potos en jardinera"), in bozza o a contratto attivo. */
export async function addCarePlant(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<{ id: string }> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = carePlantSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const created = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return null;
    const subscription = await loadSubscription(tx, ctx, subscriptionId);
    if (!subscription) return null;
    if (!EDITABLE.includes(subscription.status)) {
      throw new ConflictError('care_contract_not_editable');
    }
    await checkSpecies(tx, input.canonicalFlowerId);
    const [count, last] = await Promise.all([
      tx.carePlant.count({
        where: { tenantId: ctx.tenantId, subscriptionId, status: 'ACTIVE' },
      }),
      tx.carePlant.findFirst({
        where: { tenantId: ctx.tenantId, subscriptionId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      }),
    ]);
    if (count >= CARE_LIMITS.plants) throw new ConflictError('care_plant_limit');
    const plant = await tx.carePlant.create({
      data: {
        tenantId: ctx.tenantId,
        subscriptionId,
        name: input.name,
        canonicalFlowerId: input.canonicalFlowerId,
        quantity: input.quantity,
        size: input.size,
        location: input.location,
        light: input.light,
        watering: input.watering,
        instructions: input.instructions,
        seasonal: input.seasonal,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePlantAdded,
      entityType: 'CarePlant',
      entityId: plant.id,
      metadata: {
        number: formatSubscriptionNumber(subscription.number),
        quantity: plant.quantity,
        size: plant.size,
      },
    });
    return plant.id;
  });
  if (!created) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return { id: created };
}

async function lockPlant(tx: TransactionClient, ctx: TenantContext, plantId: string) {
  const plant = await tx.carePlant.findFirst({
    where: { tenantId: ctx.tenantId, id: plantId, status: 'ACTIVE' },
    select: { id: true, subscriptionId: true },
  });
  if (!plant) return null;
  await lockSubscription(tx, ctx.tenantId, plant.subscriptionId);
  const subscription = await loadSubscription(tx, ctx, plant.subscriptionId);
  if (!subscription) return null;
  if (!EDITABLE.includes(subscription.status)) {
    throw new ConflictError('care_contract_not_editable');
  }
  const current = await tx.carePlant.findFirst({
    where: { tenantId: ctx.tenantId, id: plantId, status: 'ACTIVE' },
  });
  return current ? { plant: current, subscription } : null;
}

export async function updateCarePlant(
  ctx: TenantContext,
  plantId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(plantId)) throw new NotFoundError('CarePlant');
  const parsed = carePlantSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const locked = await lockPlant(tx, ctx, plantId);
    if (!locked) return false;
    await checkSpecies(tx, input.canonicalFlowerId);
    const { plant, subscription } = locked;
    await tx.carePlant.update({
      where: { id: plant.id, tenantId: ctx.tenantId },
      data: {
        name: input.name,
        canonicalFlowerId: input.canonicalFlowerId,
        quantity: input.quantity,
        size: input.size,
        location: input.location,
        light: input.light,
        watering: input.watering,
        instructions: input.instructions,
        seasonal: input.seasonal,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePlantUpdated,
      entityType: 'CarePlant',
      entityId: plant.id,
      metadata: {
        number: formatSubscriptionNumber(subscription.number),
        quantity: { from: plant.quantity, to: input.quantity },
        size: { from: plant.size, to: input.size },
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CarePlant', plantId);
}

/** La riga esce dal contratto (resta archiviata): conta per il prezzo da quando si aggiorna. */
export async function removeCarePlant(ctx: TenantContext, plantId: string): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(plantId)) throw new NotFoundError('CarePlant');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const locked = await lockPlant(tx, ctx, plantId);
    if (!locked) return false;
    await tx.carePlant.update({
      where: { id: locked.plant.id, tenantId: ctx.tenantId },
      data: { status: 'ARCHIVED' },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePlantRemoved,
      entityType: 'CarePlant',
      entityId: locked.plant.id,
      metadata: {
        number: formatSubscriptionNumber(locked.subscription.number),
        quantity: locked.plant.quantity,
        size: locked.plant.size,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CarePlant', plantId);
}

// -----------------------------------------------------------------------------
// Conferma, prezzo, calendario, fine
// -----------------------------------------------------------------------------

/**
 * Conferma la bozza: il server calcola il prezzo con l'offerta di oggi e lo copia nel contratto,
 * poi crea le visite dei prossimi 60 giorni nelle fasce scelte.
 */
export async function confirmCareContract(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<CareGenerationResult> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return null;
    const subscription = await loadSubscription(tx, ctx, subscriptionId);
    if (!subscription) return null;
    if (subscription.status !== 'DRAFT') throw new ConflictError('care_contract_not_editable');
    const settings = await requireCareSettings(tx, ctx.tenantId);
    const slots = subscription.slots.map((link) => link.slot);
    const address = subscription.customerAddressId
      ? await tx.customerAddress.findFirst({
          where: {
            tenantId: ctx.tenantId,
            id: subscription.customerAddressId,
            status: 'ACTIVE',
          },
          select: { id: true },
        })
      : null;
    if (
      !subscription.frequency ||
      !address ||
      !settings.frequencies.includes(subscription.frequency) ||
      slots.some((slot) => slot.status !== 'ACTIVE') ||
      careScheduleProblem(subscription.frequency, slots) !== null
    ) {
      throw new ConflictError('care_schedule_outdated');
    }
    const plants = await tx.carePlant.count({
      where: { tenantId: ctx.tenantId, subscriptionId, status: 'ACTIVE' },
    });
    if (plants === 0) throw new ConflictError('care_no_plants');
    const pricing = await priceContractNow(tx, ctx.tenantId, subscription, settings);
    if (pricing.travel.kind === 'out_of_range' && !subscription.outOfRange) {
      throw new ConflictError('care_out_of_range');
    }
    await refreshServiceSnapshots(tx, ctx.tenantId, subscriptionId);
    const today = todayInTimeZone(ctx.timezone);
    const start = laterDate(requiredParts(subscription.startDate), today);
    await tx.customerSubscription.update({
      where: { id: subscription.id, tenantId: ctx.tenantId },
      data: {
        status: 'ACTIVE',
        confirmedAt: new Date(),
        confirmedById: ctx.userId,
        startDate: dbDate(start),
        visitFeeMinor: pricing.price.visitFeeMinor,
        careFeeSmallMinor: settings.careFeeSmallMinor,
        careFeeMediumMinor: settings.careFeeMediumMinor,
        careFeeLargeMinor: settings.careFeeLargeMinor,
        travelSurchargeMinor: pricing.price.travelSurchargeMinor,
        perVisitMinor: pricing.price.perVisitMinor,
        oneTimeMinor: pricing.price.oneTimeMinor,
        distanceMeters: pricing.distanceMeters,
        outOfRange: pricing.travel.kind === 'out_of_range',
      },
    });
    const generated = await extendCareVisitsTx(tx, memberScope(ctx), subscription.id);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.subscriptionConfirmed,
      entityType: 'CustomerSubscription',
      entityId: subscription.id,
      metadata: {
        number: formatSubscriptionNumber(subscription.number),
        perVisitMinor: pricing.price.perVisitMinor,
        oneTimeMinor: pricing.price.oneTimeMinor,
        startDate: toIsoDate(start),
        ...generated,
      },
    });
    return generated;
  });
  if (!result) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return result;
}

/**
 * Aggiorna il prezzo salvato con piante, servizi e tariffe di oggi (nuova versione del prezzo).
 * Cambia quanto paga il cliente: serve "Sí, avisé al cliente".
 */
export async function repriceCareContract(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<{ changed: boolean }> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const notified = readNotice(rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return null;
    const subscription = await loadSubscription(tx, ctx, subscriptionId);
    if (!subscription) return null;
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'PAUSED') {
      throw new ConflictError('care_contract_not_editable');
    }
    const settings = await requireCareSettings(tx, ctx.tenantId);
    const plants = await tx.carePlant.count({
      where: { tenantId: ctx.tenantId, subscriptionId, status: 'ACTIVE' },
    });
    if (plants === 0) throw new ConflictError('care_no_plants');
    const pricing = await priceContractNow(tx, ctx.tenantId, subscription, settings);
    const same =
      pricing.price.perVisitMinor === subscription.perVisitMinor &&
      pricing.price.oneTimeMinor === subscription.oneTimeMinor &&
      pricing.price.visitFeeMinor === subscription.visitFeeMinor &&
      pricing.price.travelSurchargeMinor === subscription.travelSurchargeMinor;
    if (same) return { changed: false };
    requireNotice(1, notified);
    await refreshServiceSnapshots(tx, ctx.tenantId, subscriptionId);
    await tx.customerSubscription.update({
      where: { id: subscription.id, tenantId: ctx.tenantId },
      data: {
        priceVersion: subscription.priceVersion + 1,
        visitFeeMinor: pricing.price.visitFeeMinor,
        careFeeSmallMinor: settings.careFeeSmallMinor,
        careFeeMediumMinor: settings.careFeeMediumMinor,
        careFeeLargeMinor: settings.careFeeLargeMinor,
        travelSurchargeMinor: pricing.price.travelSurchargeMinor,
        perVisitMinor: pricing.price.perVisitMinor,
        oneTimeMinor: pricing.price.oneTimeMinor,
        distanceMeters: pricing.distanceMeters,
        outOfRange: pricing.travel.kind === 'out_of_range',
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.subscriptionRepriced,
      entityType: 'CustomerSubscription',
      entityId: subscription.id,
      metadata: {
        number: formatSubscriptionNumber(subscription.number),
        priceVersion: subscription.priceVersion + 1,
        perVisitMinor: { from: subscription.perVisitMinor, to: pricing.price.perVisitMinor },
        oneTimeMinor: { from: subscription.oneTimeMinor, to: pricing.price.oneTimeMinor },
        customerNotified: true,
      },
    });
    return { changed: true };
  });
  if (!result) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return result;
}

export interface CareScheduleChangeResult extends CareGenerationResult {
  /** Visite già fissate cancellate e sostituite dal calendario nuovo. */
  readonly cancelled: number;
}

/**
 * Nuova frequenza o nuove fasce da un giorno in poi ("A partir de"): le visite ancora da fare da
 * quel giorno si cancellano e si creano quelle del calendario nuovo (nuova versione). Un contratto
 * che non è ancora iniziato prende anche il nuovo primo giorno.
 */
export async function changeCareSchedule(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<CareScheduleChangeResult> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = careScheduleChangeSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  assertStartInRange(input.startDate, today);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return null;
    // Ordine dei blocchi (care-booking.ts): contratto, fasce, visite. Le visite si cancellano
    // prima di crearne di nuove: senza le fasce già bloccate un cambio di fascia insieme si
    // fermerebbe sulle stesse righe.
    await lockCareSlots(tx, ctx.tenantId);
    const subscription = await loadSubscription(tx, ctx, subscriptionId);
    if (!subscription) return null;
    if (subscription.status !== 'ACTIVE') throw new ConflictError('care_contract_not_editable');
    const settings = await requireCareSettings(tx, ctx.tenantId);
    const slots = await resolveSlots(tx, ctx.tenantId, settings, input);
    const contractStart = requiredParts(subscription.startDate);
    const notStarted = compareDates(contractStart, today) > 0;
    const from = notStarted ? input.startDate : laterDate(input.startDate, contractStart);
    const end = dateToParts(subscription.endDate);
    if (end && compareDates(from, end) > 0) {
      throw new ValidationError({ startDate: 'care_start_out_of_range' });
    }
    const before = {
      frequency: subscription.frequency,
      seats: subscription.seats,
      slotIds: subscription.slots.map((link) => link.slotId).sort(),
    };
    const after = {
      frequency: input.frequency,
      seats: input.seats,
      slotIds: slots.map((slot) => slot.id).sort(),
    };
    const same =
      before.frequency === after.frequency &&
      before.seats === after.seats &&
      before.slotIds.join(',') === after.slotIds.join(',') &&
      (!notStarted || compareDates(contractStart, from) === 0);
    if (same) return { cancelled: 0, scheduled: 0, toReschedule: 0 };
    // Le visite extra restano: sono state fissate a parte (ADR-078).
    const where = openVisitsFrom(ctx.tenantId, subscription.id, from, { includeExtra: false });
    const touched = await tx.careVisit.count({ where });
    requireNotice(touched, input.customerNotified);
    const scope = memberScope(ctx);
    const cancelled = await cancelOpenVisitsTx(tx, scope, where, 'SCHEDULE_CHANGE');
    await replaceSlotLinks(tx, ctx.tenantId, subscription.id, after.slotIds);
    await tx.customerSubscription.update({
      where: { id: subscription.id, tenantId: ctx.tenantId },
      data: {
        frequency: input.frequency,
        seats: input.seats,
        scheduleVersion: subscription.scheduleVersion + 1,
        // Le visite nuove partono da `from`: le vecchie prima di quel giorno restano.
        generatedUntil: dbDate(addDays(from, -1)),
        ...(notStarted ? { startDate: dbDate(from) } : {}),
      },
    });
    const generated = await extendCareVisitsTx(tx, scope, subscription.id);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.subscriptionScheduleChanged,
      entityType: 'CustomerSubscription',
      entityId: subscription.id,
      metadata: {
        number: formatSubscriptionNumber(subscription.number),
        from: before,
        to: after,
        effectiveFrom: toIsoDate(from),
        scheduleVersion: subscription.scheduleVersion + 1,
        cancelled,
        ...generated,
        customerNotified: touched > 0,
      },
    });
    return { cancelled, ...generated };
  });
  if (!result) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return result;
}

export interface CareEndResult {
  readonly cancelled: number;
  /** true se l'ultimo giorno è già passato: il contratto è chiuso adesso. */
  readonly ended: boolean;
}

/**
 * Fine del contratto: l'ultimo giorno di servizio. Le visite ancora da fare dopo quel giorno si
 * cancellano (con "Sí, avisé al cliente" se ce n'è almeno una); se il giorno è già passato il
 * contratto si chiude subito, altrimenti lo chiude la manutenzione il giorno dopo.
 */
export async function endCareContract(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<CareEndResult> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = careEndSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return null;
    await lockCareSlots(tx, ctx.tenantId);
    const subscription = await loadSubscription(tx, ctx, subscriptionId);
    if (!subscription) return null;
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'PAUSED') {
      throw new ConflictError('care_contract_not_editable');
    }
    const start = requiredParts(subscription.startDate);
    if (
      compareDates(input.endDate, start) < 0 ||
      compareDates(input.endDate, addDays(today, 365)) > 0
    ) {
      throw new ValidationError({ endDate: 'care_end_out_of_range' });
    }
    const doneAfter = await tx.careVisit.count({
      where: {
        tenantId: ctx.tenantId,
        subscriptionId,
        status: { in: ['IN_PROGRESS', 'DONE', 'NOT_DONE'] },
        scheduledDate: { gt: dbDate(input.endDate) },
      },
    });
    if (doneAfter > 0) throw new ValidationError({ endDate: 'care_end_before_done' });
    const endsNow = compareDates(input.endDate, today) < 0;
    const after = addDays(input.endDate, 1);
    const where: Prisma.CareVisitWhereInput = endsNow
      ? {
          tenantId: ctx.tenantId,
          subscriptionId,
          OR: [
            { status: 'SCHEDULED', scheduledDate: { gte: dbDate(after) } },
            { status: 'TO_RESCHEDULE' },
          ],
        }
      : openVisitsFrom(ctx.tenantId, subscriptionId, after, { includeExtra: true });
    const touched = await tx.careVisit.count({ where });
    requireNotice(touched, input.customerNotified);
    const cancelled = await cancelOpenVisitsTx(tx, memberScope(ctx), where, 'CONTRACT_END');
    const generated = dateToParts(subscription.generatedUntil);
    await tx.customerSubscription.update({
      where: { id: subscription.id, tenantId: ctx.tenantId },
      data: {
        endDate: dbDate(input.endDate),
        generatedUntil: generated ? dbDate(earlierDate(generated, input.endDate)) : null,
        ...(endsNow ? { status: 'ENDED', endedAt: new Date() } : {}),
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.subscriptionEnded,
      entityType: 'CustomerSubscription',
      entityId: subscription.id,
      metadata: {
        number: formatSubscriptionNumber(subscription.number),
        endDate: toIsoDate(input.endDate),
        ended: endsNow,
        cancelled,
        customerNotified: touched > 0,
      },
    });
    return { cancelled, ended: endsNow };
  });
  if (!result) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return result;
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

const visitSummarySelect = {
  id: true,
  status: true,
  scheduledDate: true,
  originalDate: true,
  startMinutes: true,
  endMinutes: true,
  isExtra: true,
  extraKind: true,
  extraFee: true,
  cancelReason: true,
  assignedTo: { select: { user: { select: { name: true } } } },
} satisfies Prisma.CareVisitSelect;

type VisitSummaryRow = Prisma.CareVisitGetPayload<{ select: typeof visitSummarySelect }>;

function toVisitSummary(row: VisitSummaryRow): CareVisitSummaryDto {
  return {
    id: row.id,
    status: row.status,
    date: isoOf(row.scheduledDate),
    originalDate: isoOf(row.originalDate) ?? '',
    start: row.startMinutes === null ? null : formatTimeOfDay(row.startMinutes),
    end: row.endMinutes === null ? null : formatTimeOfDay(row.endMinutes),
    isExtra: row.isExtra,
    extraKind: row.extraKind,
    extraFee: row.extraFee,
    assigneeName: row.assignedTo?.user.name ?? null,
    cancelReason: row.cancelReason,
  };
}

function weekdayCount(frequency: CareFrequency | null, slots: number): number {
  return frequency === 'WEEKLY' ? Math.max(1, slots) : 1;
}

/** Scheda del contratto: sede, calendario, servizi, piante, prezzo salvato e di oggi, visite. */
export async function getCareContract(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<CareContractDetailDto> {
  requirePermission(ctx, 'subscriptions:read');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const subscription = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      include: {
        customer: { select: { id: true, displayName: true, status: true } },
        customerAddress: {
          select: {
            id: true,
            label: true,
            addressLine1: true,
            neighborhood: true,
            city: true,
            status: true,
          },
        },
        slots: { include: { slot: true } },
        services: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!subscription) return null;
    const plants = await tx.carePlant.findMany({
      where: { tenantId: ctx.tenantId, subscriptionId, status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        species: {
          select: { id: true, category: true, scientificName: true, names: true, synonyms: true },
        },
      },
    });
    const open = {
      tenantId: ctx.tenantId,
      subscriptionId,
      OR: [
        { status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, scheduledDate: { gte: dbDate(today) } },
        { status: 'TO_RESCHEDULE' },
      ],
    } satisfies Prisma.CareVisitWhereInput;
    const [upcoming, upcomingCount, toReschedule, recent] = await Promise.all([
      tx.careVisit.findMany({
        where: open,
        orderBy: [
          { scheduledDate: { sort: 'asc', nulls: 'first' } },
          { startMinutes: 'asc' },
          { originalDate: 'asc' },
        ],
        take: 8,
        select: visitSummarySelect,
      }),
      tx.careVisit.count({ where: open }),
      tx.careVisit.count({
        where: { tenantId: ctx.tenantId, subscriptionId, status: 'TO_RESCHEDULE' },
      }),
      tx.careVisit.findMany({
        where: {
          tenantId: ctx.tenantId,
          subscriptionId,
          OR: [
            { status: { in: ['DONE', 'NOT_DONE'] } },
            { status: 'CANCELLED', cancelReason: { in: ['SHOP', 'CUSTOMER'] } },
          ],
        },
        orderBy: [{ scheduledDate: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
        take: 5,
        select: visitSummarySelect,
      }),
    ]);
    const settings = await loadCareSettings(tx, ctx.tenantId);
    let current: CareCurrentPriceDto | null = null;
    let travel: CareTravelQuote | null = null;
    const slotCount = subscription.slots.length;
    if (settings && plants.length > 0) {
      try {
        const pricing = await priceContractNow(tx, ctx.tenantId, subscription, settings);
        travel = pricing.travel;
        current = {
          ...pricing.price,
          monthly: subscription.frequency
            ? estimateCareMonth(
                pricing.price.perVisitMinor,
                subscription.frequency,
                weekdayCount(subscription.frequency, slotCount),
              )
            : { minMinor: 0, maxMinor: 0 },
        };
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
      }
    }
    return {
      subscription,
      plants,
      upcoming,
      upcomingCount,
      toReschedule,
      recent,
      settings,
      current,
      travel,
    };
  });
  if (!found) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  const { subscription, plants, settings, current } = found;
  const confirmed = subscription.confirmedAt !== null;
  const slotCount = subscription.slots.length;
  const saved: CareSavedPriceDto | null = confirmed
    ? {
        visitFeeMinor: subscription.visitFeeMinor,
        travelSurchargeMinor: subscription.travelSurchargeMinor,
        perVisitMinor: subscription.perVisitMinor,
        oneTimeMinor: subscription.oneTimeMinor,
        monthly: subscription.frequency
          ? estimateCareMonth(
              subscription.perVisitMinor,
              subscription.frequency,
              weekdayCount(subscription.frequency, slotCount),
            )
          : { minMinor: 0, maxMinor: 0 },
      }
    : null;
  const live = EDITABLE.includes(subscription.status);
  return {
    id: subscription.id,
    numberLabel: formatSubscriptionNumber(subscription.number),
    status: subscription.status,
    customer: {
      id: subscription.customer.id,
      name: subscription.customer.displayName,
      archived: subscription.customer.status !== 'ACTIVE',
    },
    address: subscription.customerAddress
      ? {
          id: subscription.customerAddress.id,
          label: subscription.customerAddress.label,
          line: addressLineOf(subscription.customerAddress),
          city: subscription.customerAddress.city,
        }
      : null,
    frequency: subscription.frequency,
    seats: subscription.seats,
    startDate: isoOf(subscription.startDate) ?? '',
    endDate: isoOf(subscription.endDate),
    slots: subscription.slots
      .map((link) => link.slot)
      .sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes)
      .map((slot) => ({
        id: slot.id,
        weekday: slot.weekday,
        start: formatTimeOfDay(slot.startMinutes),
        end: formatTimeOfDay(slot.endMinutes),
        active: slot.status === 'ACTIVE',
      })),
    services: subscription.services.map((service) => ({
      serviceId: service.serviceId,
      name: service.name,
      pricing: service.pricing,
      unit: service.unit,
      priceMinor: service.priceMinor,
    })),
    plants: plants.map((plant) => ({
      id: plant.id,
      name: plant.name,
      speciesId: plant.canonicalFlowerId,
      speciesName: plant.species
        ? speciesOption(
            {
              id: plant.species.id,
              category: plant.species.category,
              scientificName: plant.species.scientificName,
              names: plant.species.names,
              synonyms: plant.species.synonyms,
            },
            ctx.locale,
          ).name
        : null,
      quantity: plant.quantity,
      size: plant.size,
      location: plant.location,
      light: plant.light,
      watering: plant.watering,
      instructions: plant.instructions,
      seasonal: plant.seasonal,
    })),
    plantCount: plants.reduce((total, plant) => total + plant.quantity, 0),
    contactName: subscription.contactName,
    contactPhone: subscription.contactPhone,
    accessNotes: subscription.accessNotes,
    notes: subscription.notes,
    saved,
    current,
    priceOutdated:
      saved !== null &&
      current !== null &&
      live &&
      (current.perVisitMinor !== saved.perVisitMinor ||
        current.oneTimeMinor !== saved.oneTimeMinor),
    travel: found.travel,
    outOfRange: subscription.outOfRange,
    upcoming: found.upcoming.map(toVisitSummary),
    upcomingCount: found.upcomingCount,
    toReschedule: found.toReschedule,
    recent: found.recent.map(toVisitSummary),
    scheduleVersion: subscription.scheduleVersion,
    priceVersion: subscription.priceVersion,
    confirmedAt: subscription.confirmedAt,
    endedAt: subscription.endedAt,
    createdAt: subscription.createdAt,
    currency: subscription.currency,
    issues: {
      archivedSlots: live && subscription.slots.some((link) => link.slot.status !== 'ACTIVE'),
      frequencyUnavailable:
        live &&
        settings !== null &&
        subscription.frequency !== null &&
        !settings.frequencies.includes(subscription.frequency),
      addressArchived: live && subscription.customerAddress?.status !== 'ACTIVE',
    },
    canWrite: hasPermission(ctx, 'subscriptions:write') && live,
    canVisit: hasPermission(ctx, 'care:visit'),
  };
}

function listWhere(
  ctx: TenantContext,
  view: CareContractView,
  q: string,
  customerId: string | null,
): Prisma.CustomerSubscriptionWhereInput {
  const number = /^(?:sus-?)?0*(\d{1,9})$/i.exec(q)?.[1];
  return {
    tenantId: ctx.tenantId,
    kind: 'CARE',
    status: { in: [...STATUSES_BY_VIEW[view]] },
    ...(customerId ? { customerId } : {}),
    ...(q
      ? {
          OR: [
            { customer: { displayName: { contains: q, mode: 'insensitive' } } },
            ...(number ? [{ number: Number(number) }] : []),
          ],
        }
      : {}),
  };
}

async function toListItems(
  tx: TransactionClient,
  ctx: TenantContext,
  rows: readonly Prisma.CustomerSubscriptionGetPayload<{
    include: {
      customer: { select: { displayName: true } };
      customerAddress: { select: { addressLine1: true; neighborhood: true } };
    };
  }>[],
): Promise<CareContractListItemDto[]> {
  const ids = rows.map((row) => row.id);
  const today = todayInTimeZone(ctx.timezone);
  const [next, pending, plants] = await Promise.all([
    tx.careVisit.groupBy({
      by: ['subscriptionId'],
      where: {
        tenantId: ctx.tenantId,
        subscriptionId: { in: ids },
        status: 'SCHEDULED',
        scheduledDate: { gte: dbDate(today) },
      },
      _min: { scheduledDate: true },
    }),
    tx.careVisit.groupBy({
      by: ['subscriptionId'],
      where: { tenantId: ctx.tenantId, subscriptionId: { in: ids }, status: 'TO_RESCHEDULE' },
      _count: { _all: true },
    }),
    tx.carePlant.groupBy({
      by: ['subscriptionId'],
      where: { tenantId: ctx.tenantId, subscriptionId: { in: ids }, status: 'ACTIVE' },
      _sum: { quantity: true },
    }),
  ]);
  const nextBy = new Map(next.map((row) => [row.subscriptionId, isoOf(row._min.scheduledDate)]));
  const pendingBy = new Map(pending.map((row) => [row.subscriptionId, row._count._all]));
  const plantsBy = new Map(plants.map((row) => [row.subscriptionId, row._sum.quantity ?? 0]));
  return rows.map((row) => ({
    id: row.id,
    numberLabel: formatSubscriptionNumber(row.number),
    status: row.status,
    customerId: row.customerId,
    customerName: row.customer.displayName,
    addressLine: row.customerAddress ? addressLineOf(row.customerAddress) : null,
    frequency: row.frequency,
    perVisitMinor: row.confirmedAt ? row.perVisitMinor : null,
    currency: row.currency,
    nextVisit: nextBy.get(row.id) ?? null,
    toReschedule: pendingBy.get(row.id) ?? 0,
    plantCount: plantsBy.get(row.id) ?? 0,
  }));
}

const listInclude = {
  customer: { select: { displayName: true } },
  customerAddress: { select: { addressLine1: true, neighborhood: true } },
} as const;

/** Elenco dei contratti (Suscripciones): attivi, borradores o chiusi, con ricerca per cliente o numero. */
export async function listCareContracts(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<CareContractListResult> {
  requirePermission(ctx, 'subscriptions:read');
  const filters = careContractListFiltersSchema.parse(rawFilters ?? {});
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const count = (view: CareContractView) =>
      tx.customerSubscription.count({ where: listWhere(ctx, view, '', null) });
    const counts = {
      active: await count('active'),
      draft: await count('draft'),
      closed: await count('closed'),
    };
    const where = listWhere(ctx, filters.view, filters.q, null);
    const total = filters.q ? await tx.customerSubscription.count({ where }) : counts[filters.view];
    const pageCount = Math.max(1, Math.ceil(total / CARE_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const rows = await tx.customerSubscription.findMany({
      where,
      include: listInclude,
      orderBy:
        filters.view === 'closed'
          ? [{ updatedAt: 'desc' }, { number: 'desc' }]
          : [{ number: 'desc' }],
      skip: (page - 1) * CARE_PAGE_SIZE,
      take: CARE_PAGE_SIZE,
    });
    return {
      items: await toListItems(tx, ctx, rows),
      total,
      page,
      pageCount,
      view: filters.view,
      counts,
      canWrite: hasPermission(ctx, 'subscriptions:write'),
    };
  });
}

/** I contratti di un cliente (scheda del cliente), dai più recenti; senza le bozze scartate. */
export async function listCustomerCareContracts(
  ctx: TenantContext,
  customerId: string,
): Promise<readonly CareContractListItemDto[]> {
  requirePermission(ctx, 'subscriptions:read');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const rows = await tx.customerSubscription.findMany({
      where: {
        tenantId: ctx.tenantId,
        kind: 'CARE',
        customerId,
        status: { not: 'CANCELLED' },
      },
      include: listInclude,
      orderBy: [{ number: 'desc' }],
      take: 20,
    });
    return toListItems(tx, ctx, rows);
  });
}
