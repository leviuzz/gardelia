/**
 * Floral Care, blocco 2b (ADR-078): visite extra, piante morte e cambio di stagione.
 *  - Visita extra (lavoro in più, reposición, installazione o ritiro di stagione): in un orario di
 *    visita, che conta i posti, o a un'ora libera, che non li tocca e che i clienti non possono
 *    scegliere (decisione del founder del 24/11/2026). Il costo lo calcola il server: la tariffa
 *    per visita del contratto con il suo sovrapprezzo per distanza, niente, o dentro una cotización
 *    del contratto. È una visita nuova: non chiede "Sí, avisé al cliente"; spostarla o cancellarla sì.
 *  - "Cotizar" da un contratto: una cotización in bozza legata al contratto, con un titolo nella
 *    lingua del mercato della fioreria (va al cliente). Si completa nell'editor delle cotizaciones.
 *  - Una pianta morta si risolve anche da qui: "Reposición sin costo" (visita extra a costo 0) e
 *    "Cotizar" chiudono l'avviso nella stessa transazione.
 * Ordine dei blocchi: contratto → fasce (solo in un orario) → avviso → visita o numero della
 * cotización.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_EXTRA_LIMITS,
  CARE_LIMITS,
  CARE_LIVE_RECOVERY_STATUSES,
  addDays,
  careExtraFeeMinor,
  careExtraVisitSchema,
  careQuoteSchema,
  careVisitRecoverable,
  compareDates,
  dayOfWeek,
  formatQuoteNumber,
  formatSubscriptionNumber,
  formatTimeOfDay,
  getMarket,
  isUuid,
  resolveLocale,
  toFieldErrors,
  todayInTimeZone,
  toIsoDate,
  type CareQuotePurpose,
  type DeadPlantPolicy,
  type QuoteStatus,
  type SupportedLocale,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { requireEntitlement } from './billing';
import { openSlotBook } from './care-booking';
import { checkCareFollowUpOpenTx, resolveCareFollowUpTx } from './care-follow-ups';
import {
  dbDate,
  earlierDate,
  laterDate,
  lockSubscription,
  requireCareSettings,
  requiredParts,
} from './care-internals';
import type { CareMoveOptionDto } from './care-visits';
import { dateToParts, insertDraftQuote } from './quote-internals';

/** Cotizaciones di un contratto che possono ancora pagare una visita. */
const OPEN_QUOTE_STATUSES: readonly QuoteStatus[] = ['DRAFT', 'SENT', 'ACCEPTED'];

export interface CareContractQuoteDto {
  readonly id: string;
  readonly numberLabel: string;
  readonly title: string | null;
  readonly status: QuoteStatus;
  readonly totalMinor: number;
  readonly currency: string;
  readonly createdAt: Date;
}

export interface CareExtraVisitOptionsDto {
  /** Quanto costa con la tariffa per visita del contratto (con il viaggio). */
  readonly visitFeeMinor: number;
  readonly currency: string;
  /** Orari con posto nei prossimi 21 giorni, dentro il contratto (per i posti del contratto). */
  readonly options: readonly CareMoveOptionDto[];
  /** Cotizaciones del contratto che possono pagare la visita ("en la cotización"). */
  readonly quotes: readonly CareContractQuoteDto[];
  readonly deadPlantPolicy: DeadPlantPolicy;
  /** Il primo e l'ultimo giorno possibili ("AAAA-MM-GG"): da oggi, fino a 90 giorni e al contratto. */
  readonly firstDate: string;
  readonly lastDate: string;
}

/** Titoli proposti delle cotizaciones nate da un contratto, nella lingua del mercato. */
const QUOTE_TITLES: Readonly<Record<SupportedLocale, Readonly<Record<CareQuotePurpose, string>>>> =
  {
    'es-MX': {
      SEASONAL: 'Cambio de temporada',
      REPLACEMENT: 'Reposición de plantas',
      EXTRA: 'Trabajo adicional',
    },
    'it-IT': {
      SEASONAL: 'Cambio di stagione',
      REPLACEMENT: 'Sostituzione di piante',
      EXTRA: 'Lavoro extra',
    },
    'en-US': {
      SEASONAL: 'Seasonal change',
      REPLACEMENT: 'Plant replacement',
      EXTRA: 'Additional work',
    },
  };

async function loadContract(tx: TransactionClient, ctx: TenantContext, subscriptionId: string) {
  return tx.customerSubscription.findFirst({
    where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
    select: {
      id: true,
      number: true,
      status: true,
      customerId: true,
      startDate: true,
      endDate: true,
      seats: true,
      scheduleVersion: true,
      currency: true,
      visitFeeMinor: true,
      travelSurchargeMinor: true,
      deadPlantPolicy: true,
      missedVisitPolicy: true,
    },
  });
}

type ContractRow = NonNullable<Awaited<ReturnType<typeof loadContract>>>;

/** I giorni in cui una visita extra si può fissare: da oggi (e dall'inizio) fino a 90 giorni. */
function extraVisitWindow(contract: ContractRow, today: ReturnType<typeof todayInTimeZone>) {
  const first = laterDate(today, requiredParts(contract.startDate));
  const end = dateToParts(contract.endDate);
  const limit = addDays(today, CARE_LIMITS.moveDaysMax);
  return { first, last: end ? earlierDate(end, limit) : limit, end };
}

async function contractQuotes(
  tx: TransactionClient,
  ctx: TenantContext,
  subscriptionId: string,
  statuses?: readonly QuoteStatus[],
): Promise<CareContractQuoteDto[]> {
  const rows = await tx.quote.findMany({
    where: {
      tenantId: ctx.tenantId,
      subscriptionId,
      ...(statuses ? { status: { in: [...statuses] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      totalMinor: true,
      currency: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    numberLabel: formatQuoteNumber(row.number),
    title: row.title,
    status: row.status,
    totalMinor: row.totalMinor,
    currency: row.currency,
    createdAt: row.createdAt,
  }));
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

/** Cosa serve al modulo "Visita extra" di un contratto attivo. */
export async function getCareExtraVisitOptions(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<CareExtraVisitOptionsDto> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const contract = await loadContract(tx, ctx, subscriptionId);
    if (!contract) return null;
    const settings = await requireCareSettings(tx, ctx.tenantId);
    const window = extraVisitWindow(contract, today);
    const options: CareMoveOptionDto[] = [];
    const until = earlierDate(window.last, addDays(window.first, CARE_EXTRA_LIMITS.optionDays - 1));
    if (contract.status === 'ACTIVE' && compareDates(window.first, until) <= 0) {
      const book = await openSlotBook(
        tx,
        ctx.tenantId,
        { from: window.first, until },
        { lock: false },
      );
      for (let day = window.first; compareDates(day, until) <= 0; day = addDays(day, 1)) {
        for (const slot of book.activeSlots()) {
          if (slot.weekday !== dayOfWeek(day)) continue;
          const free = book.free(slot.id, day);
          if (free < contract.seats) continue;
          options.push({
            date: toIsoDate(day),
            slotId: slot.id,
            start: formatTimeOfDay(slot.startMinutes),
            end: formatTimeOfDay(slot.endMinutes),
            free,
          });
        }
      }
    }
    return {
      visitFeeMinor: careExtraFeeMinor('VISIT_FEE', contract),
      currency: contract.currency,
      options,
      quotes: hasPermission(ctx, 'quotes:read')
        ? await contractQuotes(tx, ctx, contract.id, OPEN_QUOTE_STATUSES)
        : [],
      // La regola copiata nel contratto alla conferma (ADR-082); prima c'era solo quella di oggi.
      deadPlantPolicy: contract.deadPlantPolicy ?? settings.deadPlantPolicy,
      firstDate: toIsoDate(window.first),
      lastDate: toIsoDate(window.last),
    };
  });
  if (!found) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return found;
}

/** Le cotizaciones nate dal contratto (cambio di stagione, reposición, extra), le più nuove prima. */
export async function listCareContractQuotes(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<readonly CareContractQuoteDto[]> {
  requirePermission(ctx, 'subscriptions:read');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  // Chi non vede le cotizaciones non le vede neanche qui.
  if (!hasPermission(ctx, 'quotes:read')) return [];
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const contract = await loadContract(tx, ctx, subscriptionId);
    if (!contract) return null;
    return contractQuotes(tx, ctx, contract.id);
  });
  if (!found) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return found;
}

// -----------------------------------------------------------------------------
// Scritture
// -----------------------------------------------------------------------------

/**
 * Nuova visita extra di un contratto attivo. In un orario serve un posto libero per i posti del
 * contratto; a un'ora libera no. "Reposición sin costo" (`followUpId`): una reposición a costo 0
 * che chiude l'avviso della pianta morta.
 */
export async function createCareExtraVisit(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<{ readonly visitId: string }> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = careExtraVisitSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const { placement } = input;
  if (input.followUpId && (input.kind !== 'REPLACEMENT' || input.fee !== 'FREE')) {
    throw new ValidationError({ followUpId: 'invalid_option' });
  }
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return null;
    // Ordine dei blocchi: contratto, fasce (solo in un orario), visita.
    const book =
      placement.placement === 'SLOT'
        ? await openSlotBook(tx, ctx.tenantId, { from: placement.date, until: placement.date })
        : null;
    const contract = await loadContract(tx, ctx, subscriptionId);
    if (!contract) return null;
    if (contract.status !== 'ACTIVE') throw new ConflictError('care_contract_not_editable');
    const window = extraVisitWindow(contract, today);
    if (
      compareDates(placement.date, window.first) < 0 ||
      compareDates(placement.date, window.last) > 0
    ) {
      throw new ValidationError({ date: 'care_move_out_of_range' });
    }
    let target: { slotId: string | null; startMinutes: number; endMinutes: number };
    if (placement.placement === 'SLOT') {
      const slot = book?.slot(placement.slotId);
      if (!book || !slot?.active) throw new ValidationError({ slotId: 'invalid_option' });
      if (slot.weekday !== dayOfWeek(placement.date)) {
        throw new ValidationError({ slotId: 'care_slot_weekday' });
      }
      if (book.free(slot.id, placement.date) < contract.seats) {
        throw new ConflictError('care_slot_full');
      }
      target = { slotId: slot.id, startMinutes: slot.startMinutes, endMinutes: slot.endMinutes };
    } else {
      target = {
        slotId: null,
        startMinutes: placement.startMinutes,
        endMinutes: placement.endMinutes,
      };
    }
    if (input.quoteId) {
      const quote = await tx.quote.findFirst({
        where: {
          tenantId: ctx.tenantId,
          id: input.quoteId,
          subscriptionId: contract.id,
          status: { in: [...OPEN_QUOTE_STATUSES] },
        },
        select: { id: true },
      });
      if (!quote) throw new ValidationError({ quoteId: 'invalid_option' });
    }
    if (input.assignee) {
      const member = await tx.membership.findFirst({
        where: { tenantId: ctx.tenantId, id: input.assignee, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!member) throw new ValidationError({ assignee: 'invalid_option' });
    }
    if (input.followUpId) {
      const open = await checkCareFollowUpOpenTx(tx, ctx, input.followUpId, {
        resolution: 'FREE_VISIT',
        subscriptionId: contract.id,
      });
      if (!open) throw new ValidationError({ followUpId: 'invalid_option' });
    }
    if (input.recoveryOfVisitId) {
      // "Agendar recuperación" (blocco 3b): la visita mancata del cliente, nello stesso contratto,
      // con «Se agenda otra visita», senza un'altra visita di recupero ancora valida. Il contratto
      // è bloccato: due richieste insieme non ne creano due.
      const missed = await tx.careVisit.findFirst({
        where: { tenantId: ctx.tenantId, id: input.recoveryOfVisitId, subscriptionId: contract.id },
        select: {
          isExtra: true,
          status: true,
          notDoneCause: true,
          recoveries: {
            where: { status: { in: [...CARE_LIVE_RECOVERY_STATUSES] } },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!missed || !careVisitRecoverable(missed, contract.missedVisitPolicy)) {
        throw new ValidationError({ recoveryOfVisitId: 'invalid_option' });
      }
      if (missed.recoveries.length > 0) throw new ConflictError('care_visit_already_recovered');
    }
    const feeMinor = careExtraFeeMinor(input.fee, contract);
    const visit = await tx.careVisit.create({
      data: {
        tenantId: ctx.tenantId,
        subscriptionId: contract.id,
        scheduleVersion: contract.scheduleVersion,
        originalDate: dbDate(placement.date),
        scheduledDate: dbDate(placement.date),
        ...target,
        seats: contract.seats,
        status: 'SCHEDULED',
        isExtra: true,
        extraKind: input.kind,
        extraFee: input.fee,
        extraFeeMinor: feeMinor,
        extraNote: input.note,
        quoteId: input.quoteId,
        recoveryOfVisitId: input.recoveryOfVisitId,
        assignedMembershipId: input.assignee,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    if (input.followUpId) {
      await resolveCareFollowUpTx(tx, ctx, input.followUpId, {
        resolution: 'FREE_VISIT',
        note: null,
        extraVisitId: visit.id,
        subscriptionId: contract.id,
      });
    }
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careExtraVisitCreated,
      entityType: 'CareVisit',
      entityId: visit.id,
      metadata: {
        number: formatSubscriptionNumber(contract.number),
        kind: input.kind,
        fee: input.fee,
        feeMinor,
        date: toIsoDate(placement.date),
        slotId: target.slotId,
        ...(target.slotId === null
          ? {
              start: formatTimeOfDay(target.startMinutes),
              end: formatTimeOfDay(target.endMinutes),
            }
          : {}),
        ...(input.quoteId ? { quoteId: input.quoteId } : {}),
        ...(input.followUpId ? { followUpId: input.followUpId } : {}),
        ...(input.recoveryOfVisitId ? { recoveryOfVisitId: input.recoveryOfVisitId } : {}),
      },
    });
    return { visitId: visit.id };
  });
  if (!found) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return found;
}

/**
 * "Cotizar" da un contratto (attivo o in pausa): una cotización in bozza per il cliente del
 * contratto, legata al contratto. Da un avviso (`followUpId`) lo chiude come "Cotizado". Serve
 * anche il permesso delle cotizaciones: lo staff non ne crea (O-08).
 */
export async function createCareQuote(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
): Promise<{ readonly id: string; readonly number: number }> {
  requirePermission(ctx, 'quotes:write');
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = careQuoteSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    if (!(await lockSubscription(tx, ctx.tenantId, subscriptionId))) return null;
    const contract = await loadContract(tx, ctx, subscriptionId);
    if (!contract) return null;
    if (contract.status !== 'ACTIVE' && contract.status !== 'PAUSED') {
      throw new ConflictError('care_contract_not_editable');
    }
    if (input.followUpId) {
      const open = await checkCareFollowUpOpenTx(tx, ctx, input.followUpId, {
        resolution: 'QUOTED',
        subscriptionId: contract.id,
      });
      if (!open) throw new ValidationError({ followUpId: 'invalid_option' });
    }
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { marketCountry: true },
    });
    const locale = resolveLocale(getMarket(tenant.marketCountry).defaultLocale);
    const number = formatSubscriptionNumber(contract.number);
    const quote = await insertDraftQuote(tx, ctx, contract.customerId, {
      subscriptionId: contract.id,
      title: `${QUOTE_TITLES[locale][input.purpose]} · ${number}`,
    });
    if (!quote) throw new ConflictError('care_customer_archived');
    if (input.followUpId) {
      await resolveCareFollowUpTx(tx, ctx, input.followUpId, {
        resolution: 'QUOTED',
        note: null,
        quoteId: quote.id,
        subscriptionId: contract.id,
      });
    }
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careQuoteCreated,
      entityType: 'CustomerSubscription',
      entityId: contract.id,
      metadata: {
        number,
        quoteNumber: formatQuoteNumber(quote.number),
        purpose: input.purpose,
        ...(input.followUpId ? { followUpId: input.followUpId } : {}),
      },
    });
    return quote;
  });
  if (!found) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return found;
}
