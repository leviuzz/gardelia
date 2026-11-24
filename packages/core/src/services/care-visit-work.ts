/**
 * La visita dal telefono (ADR-078, Floral Care blocco 2). Chi la fa (`care:visit`, anche lo staff):
 *  1. "Empezar visita": la visita passa "En curso" (ora e persona);
 *  2. i passi, ognuno salvato subito (sul posto il segnale può mancare): servizi della checklist,
 *     stato delle piante (anche "Todas bien"), materiali, avvisi per chi gestisce, nota per il
 *     cliente; le foto sono in `care-photos.ts`;
 *  3. "Terminar visita": ogni pianta ha il suo stato; i materiali escono dall'inventario una volta
 *     sola; le piante morte diventano avvisi di reposición; nascono il link del resoconto e, se
 *     chiesta, l'email al cliente (una per visita, tabella d'uscita `CareEmail`);
 *  4. "No se pudo": niente materiali; foto e stati restano come prova; stesso link ed email.
 *
 * Ordine dei blocchi: contratto → visita → righe d'inventario (dentro `consumeStockTx`), come nel
 * blocco 1 (contratto → fasce → visite) e senza cicli con gli ordini. I passi che non cambiano lo
 * stato bloccano solo la visita. File ed email sempre fuori dalla transazione.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_EMAIL_RETRY,
  CARE_VISIT_LIMITS,
  canShareCareVisit,
  canWorkOnCareVisit,
  careChecklist,
  careEmailsAllowed,
  careFinishSchema,
  careFollowUpSchema,
  careMaterialSchema,
  careNotDoneSchema,
  carePlantResultSchema,
  careReportRecipient,
  careServiceResultSchema,
  careVisitNoteSchema,
  compareDates,
  formatSubscriptionNumber,
  getMarket,
  isUuid,
  resolveLocale,
  speciesOption,
  toFieldErrors,
  todayInTimeZone,
  toIsoDate,
  type CareEmailStatus,
  type CarePlantCondition,
  type CareServiceOutcome,
  type CareServicePricing,
  type CareServiceUnit,
  type PlantLight,
  type PlantSize,
  type SaleUnit,
} from '@floral/domain';
import { careBlockNoticeEmail, careVisitReportEmail } from '../care-email';
import { loadBlockNoticeTx } from './care-block-notice';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import type { Mailer } from '../mailer';
import { createPublicLinkToken, publicLinkUrl } from '../public-links';
import { getEntitlements, requireEntitlement } from './billing';
import { addressLineOf, lockSubscription } from './care-internals';
import { loadCareVisitReportTx, type CareVisitReportDto } from './care-report';
import { followUpSelect, toFollowUpDto, type CareFollowUpDto } from './care-follow-ups';
import {
  agendaSelect,
  lockCareVisit,
  plantCounts,
  toAgendaVisit,
  type LockedCareVisit,
} from './care-visit-internals';
import type { CareAgendaVisitDto } from './care-visits';
import { consumeStockTx } from './inventory';
import { ensureCareVisitPublicLinkTx } from './public-links';
import { dateToParts } from './quote-internals';

/** Quello che serve per mandare le email di Floral Care (lo passa il web, come per gli ordini). */
export interface CareMailDeps {
  readonly mailer: Mailer;
  /** URL pubblico dell'app (APP_URL), per il link del resoconto. */
  readonly appUrl: string;
  /** Firma dei link pubblici (BETTER_AUTH_SECRET). */
  readonly secret: string;
}

/** Cosa è successo al resoconto per il cliente. */
export type CareReportDelivery =
  'sent' | 'failed' | 'not_requested' | 'no_email' | 'demo' | 'already_sent';

export interface CareVisitCloseResult {
  /** La visita era già chiusa (un secondo "Terminar"): niente è cambiato. */
  readonly alreadyClosed: boolean;
  readonly report: CareReportDelivery;
}

export interface CareChecklistItemDto {
  readonly serviceId: string;
  readonly name: string;
  readonly pricing: CareServicePricing;
  readonly unit: CareServiceUnit;
  readonly outcome: CareServiceOutcome | null;
  readonly note: string | null;
  /** Non è più fra i servizi del contratto (resta il risultato già segnato). */
  readonly removed: boolean;
}

export interface CareVisitPlantDto {
  readonly plantId: string;
  readonly name: string;
  readonly speciesName: string | null;
  readonly quantity: number;
  readonly size: PlantSize;
  readonly location: string | null;
  readonly light: PlantLight | null;
  readonly watering: string | null;
  readonly instructions: string | null;
  readonly condition: CarePlantCondition | null;
  readonly affected: number | null;
  readonly note: string | null;
  /** Tolta dal contratto dopo che è stata segnata in questa visita. */
  readonly removed: boolean;
  /** Pianta del cambio di stagione (ADR-078). */
  readonly seasonal: boolean;
}

export interface CareVisitPhotoDto {
  readonly id: string;
  readonly plantId: string | null;
  readonly createdAt: Date;
}

export interface CareVisitMaterialDto {
  readonly catalogItemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly saleUnit: SaleUnit;
}

export interface CareVisitEmailDto {
  readonly status: CareEmailStatus;
  readonly attempts: number;
  readonly sentAt: Date | null;
  readonly lastError: string | null;
}

export interface CareVisitSheetDto {
  readonly visit: CareAgendaVisitDto;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  /** Chi l'ha iniziata (nome completo: la pagina è della squadra). */
  readonly startedBy: string | null;
  readonly place: {
    readonly address: string | null;
    readonly contactName: string | null;
    readonly contactPhone: string | null;
    readonly customerPhone: string | null;
    readonly accessNotes: string | null;
    readonly notes: string | null;
  };
  /** I servizi del contratto (una visita extra non ha la checklist: fa il suo lavoro). */
  readonly checklist: readonly CareChecklistItemDto[];
  readonly plants: readonly CareVisitPlantDto[];
  /**
   * Visita di ritiro del cambio di stagione: alla fine si archiviano le piante di temporada
   * (casella attiva). `plants`: quante sono ancora nel contratto.
   */
  readonly seasonalPickup: { readonly plants: number } | null;
  readonly photos: readonly CareVisitPhotoDto[];
  readonly photoLimit: number;
  readonly materials: readonly CareVisitMaterialDto[];
  /** La fioreria controlla l'inventario: i materiali si possono segnare. */
  readonly inventoryEnabled: boolean;
  readonly followUps: readonly CareFollowUpDto[];
  /** Il resoconto, a visita chiusa. */
  readonly report: CareVisitReportDto | null;
  readonly email: CareVisitEmailDto | null;
  /** Il cliente ha un'email a cui mandare il resoconto. */
  readonly customerHasEmail: boolean;
  /** La fioreria può scrivere ai clienti (LIVE, mai demo). */
  readonly emailsAllowed: boolean;
  readonly progress: {
    readonly servicesDone: number;
    readonly services: number;
    readonly plantsMarked: number;
    readonly plants: number;
    readonly photos: number;
  };
  readonly can: {
    /** Registrare i passi (visita in corso). */
    readonly work: boolean;
    /** Togliere le foto: chi fa la visita mentre è in corso, chi gestisce sempre. */
    readonly removePhotos: boolean;
    /** Copiare o mandare il link del resoconto. */
    readonly share: boolean;
    /** Rinnovare o disattivare il link. */
    readonly manageLink: boolean;
    readonly resolveFollowUps: boolean;
    /** Mandare (o rimandare) il resoconto per email. */
    readonly sendReport: boolean;
  };
}

// -----------------------------------------------------------------------------
// Lettura
// -----------------------------------------------------------------------------

/** Tutto quello che serve alla pagina della visita, in una lettura. */
export async function getCareVisitSheet(
  ctx: TenantContext,
  visitId: string,
): Promise<CareVisitSheetDto> {
  requirePermission(ctx, 'subscriptions:read');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const row = await tx.careVisit.findFirst({
      where: { tenantId: ctx.tenantId, id: visitId },
      select: {
        ...agendaSelect,
        startedAt: true,
        finishedAt: true,
        startedById: true,
      },
    });
    if (!row) return null;
    const subscription = await tx.customerSubscription.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, id: row.subscriptionId },
      select: {
        contactName: true,
        contactPhone: true,
        accessNotes: true,
        notes: true,
        customer: { select: { phone: true, email: true } },
        customerAddress: {
          select: {
            addressLine1: true,
            addressLine2: true,
            neighborhood: true,
            postalCode: true,
            city: true,
          },
        },
        services: {
          orderBy: { createdAt: 'asc' },
          select: { serviceId: true, name: true, pricing: true, unit: true },
        },
      },
    });
    const [
      plants,
      counts,
      serviceResults,
      plantResults,
      oneTimeDone,
      photos,
      materials,
      followUps,
      email,
      starter,
      entitlements,
    ] = await Promise.all([
      tx.carePlant.findMany({
        where: { tenantId: ctx.tenantId, subscriptionId: row.subscriptionId, status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          species: {
            select: {
              id: true,
              category: true,
              scientificName: true,
              names: true,
              synonyms: true,
            },
          },
        },
      }),
      plantCounts(tx, ctx.tenantId, [row.subscriptionId]),
      tx.careVisitServiceResult.findMany({
        where: { tenantId: ctx.tenantId, visitId },
        orderBy: { createdAt: 'asc' },
      }),
      tx.careVisitPlantResult.findMany({
        where: { tenantId: ctx.tenantId, visitId },
        orderBy: { createdAt: 'asc' },
      }),
      oneTimeServicesDone(tx, ctx.tenantId, row.subscriptionId, visitId),
      tx.carePhoto.findMany({
        where: { tenantId: ctx.tenantId, visitId, removedAt: null, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, plantId: true, createdAt: true },
      }),
      tx.careVisitMaterial.findMany({
        where: { tenantId: ctx.tenantId, visitId },
        orderBy: { createdAt: 'asc' },
        select: {
          catalogItemId: true,
          quantity: true,
          catalogItem: { select: { name: true, saleUnit: true } },
        },
      }),
      tx.careFollowUp.findMany({
        where: { tenantId: ctx.tenantId, visitId },
        orderBy: { createdAt: 'asc' },
        select: followUpSelect,
      }),
      tx.careEmail.findFirst({
        where: { tenantId: ctx.tenantId, visitId, kind: 'VISIT_REPORT' },
        select: { status: true, attempts: true, sentAt: true, lastError: true },
      }),
      row.startedById
        ? tx.membership.findFirst({
            where: { tenantId: ctx.tenantId, userId: row.startedById },
            select: { user: { select: { name: true } } },
          })
        : Promise.resolve(null),
      getEntitlements(ctx, tx),
    ]);
    const report = canShareCareVisit(row.status)
      ? await loadCareVisitReportTx(tx, ctx.tenantId, visitId, ctx.timezone)
      : null;
    return {
      row,
      subscription,
      plants,
      counts,
      serviceResults,
      plantResults,
      oneTimeDone,
      photos,
      materials,
      followUps,
      email,
      starter,
      inventory: entitlements.inventory,
      report,
    };
  });
  if (!found) return notFound(ctx, 'CareVisit', visitId);

  const visit = toAgendaVisit(ctx, found.row, found.counts, today);
  const working = canWorkOnCareVisit(visit.status);
  const serviceResult = new Map(found.serviceResults.map((result) => [result.serviceId, result]));
  const contractServices = found.row.isExtra
    ? []
    : careChecklist(found.subscription.services, found.oneTimeDone);
  const checklist: CareChecklistItemDto[] = contractServices.map((service) => ({
    serviceId: service.serviceId,
    name: service.name,
    pricing: service.pricing,
    unit: service.unit,
    outcome: serviceResult.get(service.serviceId)?.outcome ?? null,
    note: serviceResult.get(service.serviceId)?.note ?? null,
    removed: false,
  }));
  const listed = new Set(checklist.map((item) => item.serviceId));
  for (const result of found.serviceResults) {
    if (listed.has(result.serviceId)) continue;
    checklist.push({
      serviceId: result.serviceId,
      name: result.name,
      pricing: result.pricing,
      unit: result.unit,
      outcome: result.outcome,
      note: result.note,
      removed: true,
    });
  }
  const plantResult = new Map(found.plantResults.map((result) => [result.plantId, result]));
  const plants: CareVisitPlantDto[] = found.plants.map((plant) => {
    const result = plantResult.get(plant.id);
    return {
      plantId: plant.id,
      name: plant.name,
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
      condition: result?.condition ?? null,
      affected: result?.affected ?? null,
      note: result?.note ?? null,
      removed: false,
      seasonal: plant.seasonal,
    };
  });
  const activePlants = new Set(plants.map((plant) => plant.plantId));
  for (const result of found.plantResults) {
    if (activePlants.has(result.plantId)) continue;
    plants.push({
      plantId: result.plantId,
      name: result.plantName,
      speciesName: null,
      quantity: result.quantity,
      size: 'MEDIUM',
      location: null,
      light: null,
      watering: null,
      instructions: null,
      condition: result.condition,
      affected: result.affected,
      note: result.note,
      removed: true,
      seasonal: false,
    });
  }
  const address = found.subscription.customerAddress;
  const manager = hasPermission(ctx, 'subscriptions:write');
  const visits = hasPermission(ctx, 'care:visit');
  return {
    visit,
    startedAt: found.row.startedAt,
    finishedAt: found.row.finishedAt,
    startedBy: found.starter?.user.name ?? null,
    place: {
      address: address
        ? [addressLineOf(address), address.addressLine2, address.postalCode, address.city]
            .filter((part) => part && part.trim())
            .join(', ')
        : null,
      contactName: found.subscription.contactName,
      contactPhone: found.subscription.contactPhone,
      customerPhone: found.subscription.customer.phone,
      accessNotes: found.subscription.accessNotes,
      notes: found.subscription.notes,
    },
    checklist,
    plants,
    seasonalPickup:
      found.row.extraKind === 'SEASONAL_PICKUP'
        ? {
            plants: found.plants
              .filter((plant) => plant.seasonal)
              .reduce((total, plant) => total + plant.quantity, 0),
          }
        : null,
    photos: found.photos,
    photoLimit: CARE_VISIT_LIMITS.photos,
    materials: found.materials.map((material) => ({
      catalogItemId: material.catalogItemId,
      name: material.catalogItem.name,
      quantity: material.quantity,
      saleUnit: material.catalogItem.saleUnit,
    })),
    inventoryEnabled: found.inventory,
    followUps: found.followUps.map((row) => toFollowUpDto(row, null)),
    report: found.report,
    email: found.email,
    customerHasEmail: Boolean(found.subscription.customer.email?.trim()),
    emailsAllowed: careEmailsAllowed({ mode: ctx.mode, status: 'ACTIVE' }),
    progress: {
      servicesDone: checklist.filter((item) => !item.removed && item.outcome !== null).length,
      services: checklist.filter((item) => !item.removed).length,
      plantsMarked: plants.filter((plant) => !plant.removed && plant.condition !== null).length,
      plants: plants.filter((plant) => !plant.removed).length,
      photos: found.photos.length,
    },
    can: {
      work: visits && working,
      removePhotos: (visits && working) || manager,
      share: visits && canShareCareVisit(visit.status),
      manageLink: manager && canShareCareVisit(visit.status),
      resolveFollowUps: manager,
      sendReport: visits && canShareCareVisit(visit.status),
    },
  };
}

/** I servizi "una sola vez" già fatti in un'altra visita hecha dello stesso contratto. */
async function oneTimeServicesDone(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
  visitId: string,
): Promise<Set<string>> {
  const rows = await tx.careVisitServiceResult.findMany({
    where: {
      tenantId,
      outcome: 'DONE',
      unit: 'ONE_TIME',
      visitId: { not: visitId },
      visit: { subscriptionId, status: 'DONE' },
    },
    select: { serviceId: true },
  });
  return new Set(rows.map((row) => row.serviceId));
}

export interface CareMaterialOptionDto {
  readonly catalogItemId: string;
  readonly name: string;
  readonly saleUnit: SaleUnit;
  /** Giacenza (senza costi: la vede anche lo staff). */
  readonly onHand: number;
}

/** I prodotti controllati dall'inventario da segnare come materiali; vuoto senza il piano. */
export async function listCareMaterialOptions(
  ctx: TenantContext,
  visitId: string,
): Promise<readonly CareMaterialOptionDto[]> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await tx.careVisit.findFirst({
      where: { tenantId: ctx.tenantId, id: visitId },
      select: { id: true },
    });
    if (!visit) return null;
    if (!(await getEntitlements(ctx, tx)).inventory) return [];
    const items = await tx.inventoryItem.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      orderBy: { catalogItem: { name: 'asc' } },
      take: 300,
      select: {
        catalogItemId: true,
        onHand: true,
        catalogItem: { select: { name: true, saleUnit: true } },
      },
    });
    return items.map((item) => ({
      catalogItemId: item.catalogItemId,
      name: item.catalogItem.name,
      saleUnit: item.catalogItem.saleUnit,
      onHand: item.onHand,
    }));
  });
  if (result === null) return notFound(ctx, 'CareVisit', visitId);
  return result;
}

// -----------------------------------------------------------------------------
// Empezar
// -----------------------------------------------------------------------------

/**
 * "Empezar visita": da programmata (oggi o un giorno passato) a in corso, con ora e persona; se
 * non era assegnata, la prende chi la inizia. Ripetuta non fa nulla (doppio tocco, rete lenta).
 */
export async function startCareVisit(ctx: TenantContext, visitId: string): Promise<void> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await lockContractThenVisit(tx, ctx, visitId);
    if (!visit) return false;
    if (visit.status === 'IN_PROGRESS') return true;
    if (visit.status !== 'SCHEDULED') throw new ConflictError('care_visit_closed');
    if (visit.subscription.status !== 'ACTIVE') {
      throw new ConflictError('care_contract_not_editable');
    }
    const date = dateToParts(visit.scheduledDate);
    if (!date || compareDates(date, today) > 0) throw new ConflictError('care_visit_future');
    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        startedById: ctx.userId,
        assignedMembershipId: visit.assignedMembershipId ?? ctx.membershipId,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careVisitStarted,
      entityType: 'CareVisit',
      entityId: visit.id,
      metadata: {
        number: formatSubscriptionNumber(visit.subscription.number),
        date: toIsoDate(date),
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CareVisit', visitId);
}

async function lockContractThenVisit(
  tx: TransactionClient,
  ctx: TenantContext,
  visitId: string,
): Promise<LockedCareVisit | null> {
  const first = await tx.careVisit.findFirst({
    where: { tenantId: ctx.tenantId, id: visitId },
    select: { subscriptionId: true },
  });
  if (!first) return null;
  await lockSubscription(tx, ctx.tenantId, first.subscriptionId);
  return lockCareVisit(tx, ctx, visitId);
}

// -----------------------------------------------------------------------------
// I passi (visita in corso)
// -----------------------------------------------------------------------------

/** Un passo su una visita in corso: blocca solo la visita. 404 se non è della fioreria. */
async function withWorkingVisit<T>(
  ctx: TenantContext,
  visitId: string,
  step: (tx: TransactionClient, visit: LockedCareVisit) => Promise<T>,
): Promise<T> {
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await lockCareVisit(tx, ctx, visitId);
    if (!visit) return { found: false as const };
    if (!canWorkOnCareVisit(visit.status)) throw new ConflictError('care_visit_not_in_progress');
    return { found: true as const, value: await step(tx, visit) };
  });
  if (!result.found) return notFound(ctx, 'CareVisit', visitId);
  return result.value;
}

/** Un servizio della checklist: "Hecho", "No se hizo" o vuoto (toglie la scelta). */
export async function setCareVisitServiceResult(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'care:visit');
  const parsed = careServiceResultSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await withWorkingVisit(ctx, visitId, async (tx, visit) => {
    const service = await tx.customerSubscriptionService.findFirst({
      where: {
        tenantId: ctx.tenantId,
        subscriptionId: visit.subscriptionId,
        serviceId: input.serviceId,
      },
      select: { serviceId: true, name: true, pricing: true, unit: true, priceMinor: true },
    });
    if (!service) throw new ValidationError({ serviceId: 'invalid_option' });
    if (input.outcome === null) {
      await tx.careVisitServiceResult.deleteMany({
        where: { tenantId: ctx.tenantId, visitId: visit.id, serviceId: service.serviceId },
      });
      return;
    }
    await tx.careVisitServiceResult.upsert({
      where: {
        tenantId_visitId_serviceId: {
          tenantId: ctx.tenantId,
          visitId: visit.id,
          serviceId: service.serviceId,
        },
      },
      create: {
        tenantId: ctx.tenantId,
        visitId: visit.id,
        serviceId: service.serviceId,
        name: service.name,
        pricing: service.pricing,
        unit: service.unit,
        // Il prezzo del contratto adesso: un servizio "una sola vez" si cobra così (ADR-082).
        priceMinor: service.priceMinor,
        outcome: input.outcome,
        note: input.note,
        recordedById: ctx.userId,
      },
      update: {
        outcome: input.outcome,
        note: input.note,
        priceMinor: service.priceMinor,
        recordedById: ctx.userId,
      },
    });
  });
}

/** Lo stato di una pianta (o di un gruppo, con quante sono toccate). */
export async function setCareVisitPlantResult(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'care:visit');
  const parsed = carePlantResultSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await withWorkingVisit(ctx, visitId, async (tx, visit) => {
    const plant = await tx.carePlant.findFirst({
      where: {
        tenantId: ctx.tenantId,
        subscriptionId: visit.subscriptionId,
        id: input.plantId,
        status: 'ACTIVE',
      },
      select: { id: true, name: true, quantity: true },
    });
    if (!plant) throw new ValidationError({ plantId: 'invalid_option' });
    if (input.affected !== null && input.affected > plant.quantity) {
      throw new ValidationError({ affected: 'out_of_range' });
    }
    const values = {
      plantName: plant.name,
      quantity: plant.quantity,
      condition: input.condition,
      // In un gruppo di una sola pianta "quante" non serve.
      affected: plant.quantity === 1 ? null : input.affected,
      note: input.note,
      recordedById: ctx.userId,
    };
    await tx.careVisitPlantResult.upsert({
      where: {
        tenantId_visitId_plantId: { tenantId: ctx.tenantId, visitId: visit.id, plantId: plant.id },
      },
      create: { tenantId: ctx.tenantId, visitId: visit.id, plantId: plant.id, ...values },
      update: values,
    });
  });
}

/** "Todas bien": segna "Bien" le piante ancora senza stato; non tocca quelle già segnate. */
export async function markAllCarePlantsOk(
  ctx: TenantContext,
  visitId: string,
): Promise<{ readonly marked: number }> {
  requirePermission(ctx, 'care:visit');
  return withWorkingVisit(ctx, visitId, async (tx, visit) => {
    const plants = await tx.carePlant.findMany({
      where: { tenantId: ctx.tenantId, subscriptionId: visit.subscriptionId, status: 'ACTIVE' },
      select: { id: true, name: true, quantity: true },
    });
    if (plants.length === 0) return { marked: 0 };
    const created = await tx.careVisitPlantResult.createMany({
      data: plants.map((plant) => ({
        tenantId: ctx.tenantId,
        visitId: visit.id,
        plantId: plant.id,
        plantName: plant.name,
        quantity: plant.quantity,
        condition: 'OK' as const,
        recordedById: ctx.userId,
      })),
      skipDuplicates: true,
    });
    return { marked: created.count };
  });
}

/** Un materiale usato (prodotto controllato dall'inventario); quantità 0 toglie la riga. */
export async function setCareVisitMaterial(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'care:visit');
  const parsed = careMaterialSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await withWorkingVisit(ctx, visitId, async (tx, visit) => {
    if (input.quantity === 0) {
      await tx.careVisitMaterial.deleteMany({
        where: { tenantId: ctx.tenantId, visitId: visit.id, catalogItemId: input.catalogItemId },
      });
      return;
    }
    if (!(await getEntitlements(ctx, tx)).inventory) {
      throw new ValidationError({ catalogItemId: 'invalid_option' });
    }
    const item = await tx.inventoryItem.findFirst({
      where: { tenantId: ctx.tenantId, catalogItemId: input.catalogItemId, status: 'ACTIVE' },
      select: { catalogItemId: true },
    });
    if (!item) throw new ValidationError({ catalogItemId: 'invalid_option' });
    const existing = await tx.careVisitMaterial.findMany({
      where: { tenantId: ctx.tenantId, visitId: visit.id },
      select: { catalogItemId: true },
    });
    const already = existing.some((line) => line.catalogItemId === item.catalogItemId);
    if (!already && existing.length >= CARE_VISIT_LIMITS.materials) {
      throw new ConflictError('care_material_limit');
    }
    await tx.careVisitMaterial.upsert({
      where: {
        tenantId_visitId_catalogItemId: {
          tenantId: ctx.tenantId,
          visitId: visit.id,
          catalogItemId: item.catalogItemId,
        },
      },
      create: {
        tenantId: ctx.tenantId,
        visitId: visit.id,
        catalogItemId: item.catalogItemId,
        quantity: input.quantity,
        createdById: ctx.userId,
      },
      update: { quantity: input.quantity },
    });
  });
}

/** La nota per il cliente (la legge nel resoconto). */
export async function saveCareVisitNote(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'care:visit');
  const parsed = careVisitNoteSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { note } = parsed.data;
  await withWorkingVisit(ctx, visitId, async (tx, visit) => {
    if (visit.outcomeNote === note) return;
    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: { outcomeNote: note },
    });
  });
}

/** Un avviso per chi gestisce: reposición, un extra chiesto dal cliente, altro. */
export async function addCareFollowUp(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'care:visit');
  const parsed = careFollowUpSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await withWorkingVisit(ctx, visitId, async (tx, visit) => {
    if (input.plantId !== null) {
      const plant = await tx.carePlant.findFirst({
        where: { tenantId: ctx.tenantId, subscriptionId: visit.subscriptionId, id: input.plantId },
        select: { id: true },
      });
      if (!plant) throw new ValidationError({ plantId: 'invalid_option' });
    }
    const open = await tx.careFollowUp.count({
      where: { tenantId: ctx.tenantId, visitId: visit.id },
    });
    if (open >= CARE_VISIT_LIMITS.followUps) throw new ConflictError('care_follow_up_limit');
    // Una seconda reposición della stessa pianta nella stessa visita non si raddoppia.
    const created = await tx.careFollowUp.createMany({
      data: [
        {
          tenantId: ctx.tenantId,
          subscriptionId: visit.subscriptionId,
          visitId: visit.id,
          kind: input.kind,
          plantId: input.plantId,
          quantity: input.quantity,
          note: input.note,
          createdById: ctx.userId,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count > 0) {
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.careFollowUpCreated,
        entityType: 'CareVisit',
        entityId: visit.id,
        metadata: { number: formatSubscriptionNumber(visit.subscription.number), kind: input.kind },
      });
    }
  });
}

// -----------------------------------------------------------------------------
// Terminar / No se pudo
// -----------------------------------------------------------------------------

interface ReportRequest {
  readonly requested: boolean;
}

/**
 * La riga d'uscita del resoconto (una per visita), se chiesta e possibile. Restituisce l'ID da
 * mandare dopo il commit, o perché non si manda.
 */
async function queueReportEmailTx(
  tx: TransactionClient,
  ctx: TenantContext,
  visit: LockedCareVisit,
  request: ReportRequest,
): Promise<{ readonly emailId: string | null; readonly outcome: CareReportDelivery }> {
  if (!request.requested) return { emailId: null, outcome: 'not_requested' };
  if (!careEmailsAllowed({ mode: ctx.mode, status: 'ACTIVE' })) {
    return { emailId: null, outcome: 'demo' };
  }
  const customer = await tx.customer.findFirst({
    where: { tenantId: ctx.tenantId, id: visit.subscription.customerId },
    select: { email: true },
  });
  const recipient = careReportRecipient({
    requested: true,
    allowed: true,
    customerEmail: customer?.email ?? null,
  });
  if (!recipient) return { emailId: null, outcome: 'no_email' };
  const created = await tx.careEmail.createManyAndReturn({
    data: [
      {
        tenantId: ctx.tenantId,
        kind: 'VISIT_REPORT',
        subscriptionId: visit.subscriptionId,
        visitId: visit.id,
        requestedById: ctx.userId,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  const emailId = created[0]?.id ?? null;
  return emailId ? { emailId, outcome: 'sent' } : { emailId: null, outcome: 'already_sent' };
}

async function deliverAfterCommit(
  ctx: TenantContext,
  queued: { readonly emailId: string | null; readonly outcome: CareReportDelivery },
  mail: CareMailDeps | null,
): Promise<CareReportDelivery> {
  if (!queued.emailId) return queued.outcome;
  // Senza mailer (es. una chiamata senza email) la riga resta PENDING: la manda il lavoro.
  if (!mail) return 'failed';
  const result = await deliverCareEmail(ctx, queued.emailId, mail);
  return result === 'sent' ? 'sent' : 'failed';
}

/**
 * "Terminar visita". Ogni pianta attiva deve avere il suo stato. I materiali segnati escono
 * dall'inventario in un solo registro (senza giacenza serve la conferma); le piante morte
 * diventano avvisi di reposición; nascono il link del resoconto e, se chiesta, l'email.
 * Con la visita già chiusa (secondo "Terminar") non fa nulla.
 */
export async function finishCareVisit(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
  mail: CareMailDeps | null,
): Promise<CareVisitCloseResult> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const parsed = careFinishSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await lockContractThenVisit(tx, ctx, visitId);
    if (!visit) return null;
    if (visit.status === 'DONE' || visit.status === 'NOT_DONE') {
      return { alreadyClosed: true, queued: { emailId: null, outcome: 'already_sent' as const } };
    }
    if (visit.status !== 'IN_PROGRESS') {
      throw new ConflictError(
        visit.status === 'SCHEDULED' ? 'care_visit_not_in_progress' : 'care_visit_closed',
      );
    }
    const date = dateToParts(visit.scheduledDate);
    if (!date) throw new ConflictError('care_visit_closed');
    const number = formatSubscriptionNumber(visit.subscription.number);
    const [plants, plantResults, serviceResults, materials, photos] = await Promise.all([
      tx.carePlant.findMany({
        where: { tenantId: ctx.tenantId, subscriptionId: visit.subscriptionId, status: 'ACTIVE' },
        select: { id: true },
      }),
      tx.careVisitPlantResult.findMany({
        where: { tenantId: ctx.tenantId, visitId: visit.id },
        select: {
          plantId: true,
          quantity: true,
          condition: true,
          affected: true,
          note: true,
        },
      }),
      tx.careVisitServiceResult.findMany({
        where: { tenantId: ctx.tenantId, visitId: visit.id },
        select: { outcome: true },
      }),
      tx.careVisitMaterial.findMany({
        where: { tenantId: ctx.tenantId, visitId: visit.id },
        select: { catalogItemId: true, quantity: true },
      }),
      tx.carePhoto.count({
        where: { tenantId: ctx.tenantId, visitId: visit.id, removedAt: null },
      }),
    ]);
    const marked = new Set(plantResults.map((result) => result.plantId));
    if (plants.some((plant) => !marked.has(plant.id))) {
      throw new ConflictError('care_plants_unmarked');
    }

    let inventoryEntryId: string | null = null;
    if (materials.length > 0) {
      try {
        const consumed = await consumeStockTx(tx, ctx, {
          lines: materials,
          note: `${number} · ${toIsoDate(date)}`,
          confirmShortage: input.confirmShortage,
        });
        inventoryEntryId = consumed.entryId;
      } catch (error) {
        if (error instanceof ConflictError && error.reason === 'inventory_insufficient_stock') {
          throw new ConflictError('care_visit_inventory_shortage');
        }
        throw error;
      }
    }

    const dead = plantResults.filter((result) => result.condition === 'DEAD');
    if (dead.length > 0) {
      await tx.careFollowUp.createMany({
        data: dead.map((result) => ({
          tenantId: ctx.tenantId,
          subscriptionId: visit.subscriptionId,
          visitId: visit.id,
          kind: 'REPLACEMENT' as const,
          plantId: result.plantId,
          quantity: result.affected ?? result.quantity,
          note: result.note,
          createdById: ctx.userId,
        })),
        skipDuplicates: true,
      });
    }

    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        status: 'DONE',
        startedAt: visit.startedAt ?? new Date(),
        finishedAt: new Date(),
        closedById: ctx.userId,
        inventoryEntryId,
      },
    });
    // Ritiro del cambio di stagione: le piante di temporada escono dal contratto (casella attiva,
    // ADR-078). Il resoconto le mostra lo stesso: le righe della visita ne copiano nome e quantità.
    if (visit.extraKind === 'SEASONAL_PICKUP' && input.archiveSeasonal) {
      const archived = await tx.carePlant.updateMany({
        where: {
          tenantId: ctx.tenantId,
          subscriptionId: visit.subscriptionId,
          status: 'ACTIVE',
          seasonal: true,
        },
        data: { status: 'ARCHIVED' },
      });
      if (archived.count > 0) {
        await recordAudit(tx, ctx, {
          action: AUDIT_ACTIONS.careSeasonalPlantsArchived,
          entityType: 'CustomerSubscription',
          entityId: visit.subscriptionId,
          metadata: { number, visitId: visit.id, plants: archived.count },
        });
      }
    }
    await ensureCareVisitPublicLinkTx(tx, ctx, {
      id: visit.id,
      number: visit.subscription.number,
    });
    const queued = await queueReportEmailTx(tx, ctx, visit, { requested: input.sendReport });
    const counts = { ok: 0, attention: 0, problem: 0, dead: 0 };
    for (const plant of plantResults) {
      if (plant.condition === 'OK') counts.ok += 1;
      else if (plant.condition === 'ATTENTION') counts.attention += 1;
      else if (plant.condition === 'PROBLEM') counts.problem += 1;
      else counts.dead += 1;
    }
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careVisitDone,
      entityType: 'CareVisit',
      entityId: visit.id,
      metadata: {
        number,
        date: toIsoDate(date),
        servicesDone: serviceResults.filter((service) => service.outcome === 'DONE').length,
        servicesSkipped: serviceResults.filter((service) => service.outcome === 'SKIPPED').length,
        plants: counts,
        photos,
        materials: materials.length,
        shortageConfirmed: input.confirmShortage,
        report: queued.emailId ? 'queued' : queued.outcome,
      },
    });
    return { alreadyClosed: false, queued };
  });
  if (!result) return notFound(ctx, 'CareVisit', visitId);
  if (result.alreadyClosed) return { alreadyClosed: true, report: 'already_sent' };
  return { alreadyClosed: false, report: await deliverAfterCommit(ctx, result.queued, mail) };
}

/**
 * "No se pudo": da programmata o in corso, con la nota per il cliente. I materiali non escono;
 * foto e stati già segnati restano come prova. Nascono il link e, se chiesta, l'email.
 */
export async function markCareVisitNotDone(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
  mail: CareMailDeps | null,
): Promise<CareVisitCloseResult> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const parsed = careNotDoneSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await lockContractThenVisit(tx, ctx, visitId);
    if (!visit) return null;
    if (visit.status === 'DONE' || visit.status === 'NOT_DONE') {
      return { alreadyClosed: true, queued: { emailId: null, outcome: 'already_sent' as const } };
    }
    if (visit.status !== 'SCHEDULED' && visit.status !== 'IN_PROGRESS') {
      throw new ConflictError('care_visit_closed');
    }
    const date = dateToParts(visit.scheduledDate);
    if (!date || compareDates(date, today) > 0) throw new ConflictError('care_visit_future');
    const now = new Date();
    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        status: 'NOT_DONE',
        // Il cliente non ha aperto (si paga) o la fioreria non è potuta andare (credito, ADR-082).
        notDoneCause: input.cause,
        startedAt: visit.startedAt ?? now,
        finishedAt: now,
        outcomeNote: input.note,
        closedById: ctx.userId,
      },
    });
    await ensureCareVisitPublicLinkTx(tx, ctx, {
      id: visit.id,
      number: visit.subscription.number,
    });
    const queued = await queueReportEmailTx(tx, ctx, visit, { requested: input.sendReport });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careVisitNotDone,
      entityType: 'CareVisit',
      entityId: visit.id,
      metadata: {
        number: formatSubscriptionNumber(visit.subscription.number),
        date: toIsoDate(date),
        cause: input.cause,
        report: queued.emailId ? 'queued' : queued.outcome,
      },
    });
    return { alreadyClosed: false, queued };
  });
  if (!result) return notFound(ctx, 'CareVisit', visitId);
  if (result.alreadyClosed) return { alreadyClosed: true, report: 'already_sent' };
  return { alreadyClosed: false, report: await deliverAfterCommit(ctx, result.queued, mail) };
}

/**
 * "Enviar reporte" / "Reintentar": manda il resoconto di una visita chiusa. Crea la riga d'uscita
 * se a "Terminar" non era stato chiesto; rimette in fila quella fallita (fino a 3 tentativi).
 * Dopo un invio riuscito non si rimanda.
 */
export async function sendCareVisitReport(
  ctx: TenantContext,
  visitId: string,
  mail: CareMailDeps,
): Promise<CareReportDelivery> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await lockCareVisit(tx, ctx, visitId);
    if (!visit) return null;
    if (!canShareCareVisit(visit.status)) throw new ConflictError('care_email_not_retryable');
    const existing = await tx.careEmail.findFirst({
      where: { tenantId: ctx.tenantId, visitId: visit.id, kind: 'VISIT_REPORT' },
      select: { id: true, status: true, attempts: true },
    });
    if (existing) {
      const retryable =
        (existing.status === 'PENDING' || existing.status === 'FAILED') &&
        existing.attempts < CARE_EMAIL_RETRY.maxAttempts;
      if (!retryable) throw new ConflictError('care_email_not_retryable');
      await ensureCareVisitPublicLinkTx(tx, ctx, {
        id: visit.id,
        number: visit.subscription.number,
      });
      return { emailId: existing.id, outcome: 'sent' as CareReportDelivery };
    }
    await ensureCareVisitPublicLinkTx(tx, ctx, {
      id: visit.id,
      number: visit.subscription.number,
    });
    return queueReportEmailTx(tx, ctx, visit, { requested: true });
  });
  if (!result) return notFound(ctx, 'CareVisit', visitId);
  return deliverAfterCommit(ctx, result, mail);
}

// -----------------------------------------------------------------------------
// Invio dell'email (dopo il commit, dal membro o dal lavoro giornaliero)
// -----------------------------------------------------------------------------

type DeliveryOutcome = 'sent' | 'failed' | 'skipped';

/**
 * Manda una riga d'uscita del resoconto. La prende in modo atomico (PENDING o FAILED → SENDING,
 * un tentativo in più), ricontrolla fioreria, email del cliente e link, manda e segna SENT o
 * FAILED. Non lancia mai errori di invio: finiscono nel log (senza indirizzi). `context` è il
 * membro che ha chiuso la visita o un lavoro senza utente.
 */
export async function deliverCareEmail(
  context: { readonly tenantId: string; readonly userId: string | null },
  emailId: string,
  mail: CareMailDeps,
): Promise<DeliveryOutcome> {
  const tenantId = context.tenantId;
  const prepared = await withTenantContext(
    getDb(),
    { tenantId, userId: context.userId },
    async (tx) => {
      const claimed = await tx.careEmail.updateMany({
        where: {
          tenantId,
          id: emailId,
          status: { in: ['PENDING', 'FAILED'] },
          attempts: { lt: CARE_EMAIL_RETRY.maxAttempts },
        },
        data: { status: 'SENDING', attempts: { increment: 1 } },
      });
      if (claimed.count === 0) return { kind: 'skipped' as const };
      const fail = async (code: string) => {
        await tx.careEmail.updateMany({
          where: { tenantId, id: emailId },
          data: { status: 'FAILED', lastError: code },
        });
        return { kind: 'failed' as const };
      };
      const email = await tx.careEmail.findFirst({
        where: { tenantId, id: emailId },
        select: { visitId: true, blockId: true, subscriptionId: true },
      });
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: {
          mode: true,
          status: true,
          displayName: true,
          contactEmail: true,
          contactPhone: true,
          marketCountry: true,
          timezone: true,
        },
      });
      if (!tenant || !careEmailsAllowed(tenant)) return fail('not_allowed');
      const locale = resolveLocale(getMarket(tenant.marketCountry).defaultLocale);
      const shop = {
        name: tenant.displayName,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
      };
      // L'avviso di un blocco di giorni (ADR-083): i cambi del contratto, senza link.
      if (email?.blockId) {
        const notice = await loadBlockNoticeTx(tx, tenantId, email.blockId, email.subscriptionId);
        const noticeTo = careReportRecipient({
          requested: true,
          allowed: true,
          customerEmail: notice?.customerEmail ?? null,
        });
        if (!notice || !noticeTo) return fail('no_email');
        return {
          kind: 'ready' as const,
          message: careBlockNoticeEmail({
            locale,
            to: noticeTo,
            customerName: notice.customerName,
            shop,
            place: notice.place,
            changes: notice.changes,
          }),
        };
      }
      if (!email?.visitId) return fail('no_visit');
      const visit = await tx.careVisit.findFirst({
        where: { tenantId, id: email.visitId },
        select: {
          subscription: { select: { customer: { select: { displayName: true, email: true } } } },
        },
      });
      const customer = visit?.subscription.customer;
      const to = careReportRecipient({
        requested: true,
        allowed: true,
        customerEmail: customer?.email ?? null,
      });
      if (!customer || !to) return fail('no_email');
      const link = await tx.publicLink.findFirst({
        where: {
          tenantId,
          kind: 'CARE_VISIT',
          careVisitId: email.visitId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!link) return fail('link_revoked');
      const report = await loadCareVisitReportTx(tx, tenantId, email.visitId, tenant.timezone);
      if (!report) return fail('no_report');
      const token = createPublicLinkToken(mail.secret, { tenantId, linkId: link.id });
      return {
        kind: 'ready' as const,
        message: careVisitReportEmail({
          locale,
          to,
          customerName: customer.displayName,
          shop,
          report,
          reportUrl: publicLinkUrl(mail.appUrl, 'CARE_VISIT', token),
        }),
      };
    },
  );
  if (prepared.kind !== 'ready') return prepared.kind;
  let sent = true;
  try {
    await mail.mailer.send(prepared.message);
  } catch (error) {
    sent = false;
    logger.error({ err: error, emailId }, 'email di Floral Care non inviata');
  }
  await withTenantContext(getDb(), { tenantId, userId: context.userId }, (tx) =>
    tx.careEmail.updateMany({
      where: { tenantId, id: emailId, status: 'SENDING' },
      data: sent
        ? { status: 'SENT', sentAt: new Date(), lastError: null }
        : { status: 'FAILED', lastError: 'send_failed' },
    }),
  );
  return sent ? 'sent' : 'failed';
}
