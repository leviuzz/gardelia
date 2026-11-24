/**
 * Cargos dei contratti di Floral Care (ADR-082, blocco 3a).
 *
 *  - Un cargo per contratto e mese (CAR-0001). Nasce alla conferma per il mese in corso (con le
 *    visite che restano: la proporzione viene da sola) e poi ogni mese dal lavoro giornaliero, con
 *    la scadenza dei "Días para pagar" della fioreria. Non cambia più: ogni variazione va sul cargo
 *    del mese dopo (le regole stanno in `@floral/domain`, `floral-care-charges.ts`).
 *  - Per ogni visita `CareVisitBilling` dice quanto è cobrado adesso. Il cargo non aggiorna mai la
 *    visita: blocca il contratto (come finire, spostare e cancellare una visita), legge le visite e
 *    scrive solo le sue righe. Il cambio di una fascia aggiorna le visite senza bloccare il
 *    contratto: la sua modifica, se arriva dopo, va sul cargo del mese dopo.
 *  - Un contratto rimasto indietro recupera un mese alla volta; un cambio di prezzo emette prima il
 *    mese in corso al prezzo vecchio (il prezzo nuovo vale dal mese dopo).
 *  - Leggere i cargos vuole `subscriptions:payments` (PROPOSTO: i soldi li vede chi li gestisce) e
 *    non chiede il piano: un cambio di piano non ferma i contratti già firmati.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_CHARGE_LIMITS,
  CARE_CHARGE_PAGE_SIZE,
  CARE_CHARGE_VIEWS,
  careBillingPeriods,
  careChargeDueDate,
  careChargeListFiltersSchema,
  careChargeStatus,
  carePeriodEnd,
  carePeriodKey,
  careVisitDay,
  compareDates,
  formatCareChargeNumber,
  formatSubscriptionNumber,
  isUuid,
  planCareChargeLines,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
  type CareBillableVisit,
  type CareChargeLineKind,
  type CareChargeStatus,
  type CareChargeView,
  type CareCreditReason,
  type CarePaymentKind,
  type CarePaymentStatus,
  type CustomerSubscriptionStatus,
  type PaymentMethod,
} from '@floral/domain';
import { notFound } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError } from '../errors';
import {
  recordScopeAudit,
  scopeTenantId,
  scopeTimezone,
  scopeUserId,
  type WriteScope,
} from '../scope';
import {
  addressLineOf,
  dbDate,
  isoOf,
  loadCareSettings,
  lockSubscription,
  requiredParts,
} from './care-internals';
import { dateToParts, nextTenantCounter } from './quote-internals';

// -----------------------------------------------------------------------------
// Emissione
// -----------------------------------------------------------------------------

export type CareChargeIssueOutcome =
  | { readonly kind: 'done' }
  | {
      readonly kind: 'issued';
      readonly period: CalendarDate;
      /** Null se nel mese non c'era niente da cobrar: il mese è comunque emesso. */
      readonly chargeId: string | null;
      /** Restano altri mesi da emettere fino a quello in corso. */
      readonly more: boolean;
    };

const DONE: CareChargeIssueOutcome = { kind: 'done' };

const BILLED_STATUSES: readonly CustomerSubscriptionStatus[] = ['ACTIVE', 'PAUSED', 'ENDED'];

/** Le visite di un contratto fino a un giorno (quello programmato, o l'originale se non c'è). */
function visitsUntil(day: CalendarDate): Prisma.CareVisitWhereInput {
  return {
    OR: [
      { scheduledDate: { lte: dbDate(day) } },
      { scheduledDate: null, originalDate: { lte: dbDate(day) } },
    ],
  };
}

/**
 * Emette il prossimo mese dovuto del contratto (al più uno): blocca il contratto, legge le visite
 * non ancora sistemate, pianifica le righe, crea il cargo se c'è qualcosa da cobrar e avanza
 * `chargedThrough` in ogni caso. Un mese si emette una volta (anche il database lo garantisce).
 * Gira nella transazione di chi chiama: la conferma, il cambio di prezzo o il lavoro giornaliero.
 */
export async function issueNextCareChargeTx(
  tx: TransactionClient,
  scope: WriteScope,
  subscriptionId: string,
  /** Solo per i test: il giorno della fioreria (di solito quello di oggi). */
  options: { readonly today?: CalendarDate } = {},
): Promise<CareChargeIssueOutcome> {
  const tenantId = scopeTenantId(scope);
  if (!(await lockSubscription(tx, tenantId, subscriptionId))) return DONE;
  const contract = await tx.customerSubscription.findFirst({
    where: { tenantId, id: subscriptionId, kind: 'CARE' },
    select: {
      id: true,
      number: true,
      status: true,
      customerId: true,
      confirmedAt: true,
      startDate: true,
      endDate: true,
      chargedThrough: true,
      currency: true,
      perVisitMinor: true,
      priceVersion: true,
    },
  });
  if (!contract?.confirmedAt || !BILLED_STATUSES.includes(contract.status)) return DONE;
  const today = options.today ?? todayInTimeZone(scopeTimezone(scope));
  const periods = careBillingPeriods({
    firstPeriod: requiredParts(contract.startDate),
    chargedThrough: dateToParts(contract.chargedThrough),
    currentPeriod: today,
    max: 2,
  });
  const period = periods[0];
  if (!period) return DONE;
  const end = dateToParts(contract.endDate);
  // Dopo l'ultimo giorno del contratto non c'è un mese dopo: si guarda tutto e il cargo può restare
  // a favore del cliente.
  const final = end !== null && compareDates(end, period) < 0;
  const limit = final ? {} : visitsUntil(carePeriodEnd(period));

  const visits = await tx.careVisit.findMany({
    where: {
      tenantId,
      subscriptionId,
      AND: [{ OR: [{ billing: { is: null } }, { billing: { is: { stableAt: null } } }] }, limit],
    },
    select: {
      id: true,
      isExtra: true,
      status: true,
      cancelReason: true,
      cancelCharged: true,
      notDoneCause: true,
      scheduledDate: true,
      originalDate: true,
      extraFee: true,
      extraFeeMinor: true,
      billing: { select: { billedMinor: true } },
    },
  });
  const billable: CareBillableVisit[] = visits.map((visit) => ({
    id: visit.id,
    isExtra: visit.isExtra,
    status: visit.status,
    cancelReason: visit.cancelReason,
    cancelCharged: visit.cancelCharged,
    notDoneCause: visit.notDoneCause,
    scheduledDate: dateToParts(visit.scheduledDate),
    originalDate: requiredParts(visit.originalDate),
    extraFee: visit.extraFee,
    extraFeeMinor: visit.extraFeeMinor,
    billedMinor: visit.billing?.billedMinor ?? null,
  }));

  // I servizi "una sola vez" fatti in una visita hecha e mai cobrati in questo contratto.
  const chargedServices = await tx.careChargeLine.findMany({
    where: { tenantId, subscriptionId, kind: 'ONE_TIME_SERVICE' },
    select: { serviceId: true },
  });
  const alreadyCharged = chargedServices.flatMap((row) => (row.serviceId ? [row.serviceId] : []));
  const services = await tx.careVisitServiceResult.findMany({
    where: {
      tenantId,
      unit: 'ONE_TIME',
      pricing: 'EXTRA',
      outcome: 'DONE',
      ...(alreadyCharged.length > 0 ? { serviceId: { notIn: alreadyCharged } } : {}),
      visit: {
        subscriptionId,
        status: 'DONE',
        ...(final ? {} : { scheduledDate: { lte: dbDate(carePeriodEnd(period)) } }),
      },
    },
    select: {
      id: true,
      serviceId: true,
      name: true,
      priceMinor: true,
      visit: { select: { scheduledDate: true, originalDate: true } },
    },
  });

  const [pastCharges, carried, adjustments] = await Promise.all([
    tx.careCharge.findMany({
      where: { tenantId, subscriptionId },
      select: { period: true, unitPriceMinor: true },
    }),
    // I saldi a favore usciti da un cargo e non ancora entrati nel cargo dopo.
    tx.careChargeLine.findMany({
      where: {
        tenantId,
        subscriptionId,
        kind: 'CREDIT_CARRIED_OUT',
        charge: { carriedInto: { none: {} } },
      },
      select: { chargeId: true, amountMinor: true },
    }),
    // Gli ajustes in attesa (blocco 3b): entrano tutti in questo cargo. Il contratto è bloccato,
    // quindi nessuno li toglie nel frattempo.
    tx.careChargeAdjustment.findMany({
      where: { tenantId, subscriptionId, removedAt: null, lines: { none: {} } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, amountMinor: true, reason: true },
    }),
  ]);

  const plan = planCareChargeLines({
    period,
    unitPriceMinor: contract.perVisitMinor,
    pastPrices: new Map(
      pastCharges.map((charge) => [
        carePeriodKey(requiredParts(charge.period)),
        charge.unitPriceMinor,
      ]),
    ),
    visits: billable,
    oneTimeServices: services.map((service) => ({
      serviceResultId: service.id,
      serviceId: service.serviceId,
      name: service.name,
      priceMinor: service.priceMinor ?? 0,
      day: careVisitDay({
        scheduledDate: dateToParts(service.visit.scheduledDate),
        originalDate: requiredParts(service.visit.originalDate),
      }),
    })),
    carriedIn: carried.map((line) => ({ chargeId: line.chargeId, amountMinor: line.amountMinor })),
    adjustments,
    final,
  });
  if (!plan.ok) throw new ConflictError('care_charge_too_large');

  let chargeId: string | null = null;
  if (plan.lines.length > 0) {
    const settings = await loadCareSettings(tx, tenantId);
    const dueDays = settings?.paymentDueDays ?? CARE_CHARGE_LIMITS.dueDaysDefault;
    const number = await nextTenantCounter(tx, tenantId, 'care_charge');
    const charge = await tx.careCharge.create({
      data: {
        tenantId,
        number,
        subscriptionId,
        customerId: contract.customerId,
        period: dbDate(period),
        issuedOn: dbDate(today),
        dueDate: dbDate(careChargeDueDate(period, today, dueDays)),
        currency: contract.currency,
        unitPriceMinor: contract.perVisitMinor,
        priceVersion: contract.priceVersion,
        visitCount: plan.visitCount,
        totalMinor: plan.totalMinor,
        paidMinor: 0,
        balanceMinor: plan.totalMinor,
        final,
        issuedById: scopeUserId(scope),
      },
      select: { id: true },
    });
    await tx.careChargeLine.createMany({
      data: plan.lines.map((line, position) => ({
        tenantId,
        chargeId: charge.id,
        subscriptionId,
        position,
        kind: line.kind,
        visitId: line.visitId,
        visitDate: line.visitDate ? dbDate(line.visitDate) : null,
        serviceResultId: line.serviceResultId,
        serviceId: line.serviceId,
        sourceChargeId: line.sourceChargeId,
        adjustmentId: line.adjustmentId,
        creditReason: line.creditReason,
        label: line.label,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        amountMinor: line.amountMinor,
      })),
    });
    chargeId = charge.id;
    await recordScopeAudit(tx, scope, {
      action: AUDIT_ACTIONS.careChargeIssued,
      entityType: 'CareCharge',
      entityId: charge.id,
      metadata: {
        number: formatCareChargeNumber(number),
        contract: formatSubscriptionNumber(contract.number),
        period: toIsoDate(period),
        totalMinor: plan.totalMinor,
        visits: plan.visitCount,
        lines: plan.lines.length,
        ...(adjustments.length > 0 ? { adjustments: adjustments.length } : {}),
        final,
      },
    });
  }

  // Quanto è cobrado adesso per ogni visita: righe nuove insieme, le altre per gruppi di valori.
  const now = new Date();
  const known = new Set(visits.filter((visit) => visit.billing).map((visit) => visit.id));
  const fresh = plan.billing.filter((update) => !known.has(update.visitId));
  if (fresh.length > 0) {
    await tx.careVisitBilling.createMany({
      data: fresh.map((update) => ({
        tenantId,
        visitId: update.visitId,
        billedMinor: update.billedMinor,
        stableAt: update.stable ? now : null,
      })),
    });
  }
  const groups = new Map<string, { billedMinor: number | null; stable: boolean; ids: string[] }>();
  for (const update of plan.billing) {
    if (!known.has(update.visitId)) continue;
    const key = `${update.billedMinor ?? 'none'}:${update.stable}`;
    const group = groups.get(key) ?? {
      billedMinor: update.billedMinor,
      stable: update.stable,
      ids: [],
    };
    group.ids.push(update.visitId);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    await tx.careVisitBilling.updateMany({
      where: { tenantId, visitId: { in: group.ids } },
      data: { billedMinor: group.billedMinor, stableAt: group.stable ? now : null },
    });
  }

  await tx.customerSubscription.update({
    where: { id: subscriptionId, tenantId },
    data: { chargedThrough: dbDate(period) },
  });
  return { kind: 'issued', period, chargeId, more: periods.length > 1 };
}

/**
 * Emette tutti i mesi dovuti fino a quello in corso, nella transazione di chi chiama (conferma del
 * contratto, cambio di prezzo). Restituisce quanti cargos sono nati.
 */
export async function catchUpCareChargesTx(
  tx: TransactionClient,
  scope: WriteScope,
  subscriptionId: string,
): Promise<number> {
  let issued = 0;
  for (let month = 0; month < 24; month += 1) {
    const outcome = await issueNextCareChargeTx(tx, scope, subscriptionId);
    if (outcome.kind === 'done') break;
    if (outcome.chargeId) issued += 1;
    if (!outcome.more) break;
  }
  return issued;
}

// -----------------------------------------------------------------------------
// DTO e letture
// -----------------------------------------------------------------------------

export interface CareChargeSummaryDto {
  readonly id: string;
  readonly numberLabel: string;
  /** Il mese ("2026-11-01"). */
  readonly period: string;
  readonly issuedOn: string;
  readonly dueDate: string;
  readonly status: CareChargeStatus;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly balanceMinor: number;
  readonly currency: string;
  readonly final: boolean;
}

export interface CareChargeListItemDto extends CareChargeSummaryDto {
  readonly subscriptionId: string;
  readonly contractLabel: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly addressLine: string | null;
}

export interface CareChargeListResult {
  readonly items: readonly CareChargeListItemDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly view: CareChargeView;
  /** "2026-11" o null (tutti i mesi). */
  readonly month: string | null;
  readonly q: string;
  readonly counts: Readonly<Record<CareChargeView, number>>;
  /** Somme dei cargos della pestaña (con mese e ricerca). */
  readonly sums: {
    readonly totalMinor: number;
    readonly paidMinor: number;
    readonly balanceMinor: number;
  };
  readonly currency: string;
}

export interface CareChargeLineDto {
  readonly id: string;
  readonly kind: CareChargeLineKind;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly amountMinor: number;
  readonly visitId: string | null;
  readonly visitDate: string | null;
  readonly creditReason: CareCreditReason | null;
  readonly label: string | null;
  /** CREDIT_CARRIED_IN: il cargo da cui viene il saldo a favore. */
  readonly sourceCharge: { readonly id: string; readonly numberLabel: string } | null;
}

/** Un movimento visto da un cargo: quanto è andato su questo cargo e quanto vale in tutto. */
export interface CareChargePaymentDto {
  readonly id: string;
  readonly kind: CarePaymentKind;
  readonly status: CarePaymentStatus;
  readonly method: PaymentMethod;
  readonly paidOn: string;
  readonly reference: string | null;
  readonly note: string | null;
  /** La parte su questo cargo (con il segno). */
  readonly amountMinor: number;
  /** Tutto il movimento (con il segno): più grande se distribuito su più cargos. */
  readonly paymentAmountMinor: number;
  /** Su quanti cargos è distribuito. */
  readonly chargeCount: number;
  /** Il movimento è stato annullato (ha il suo storno). */
  readonly reversed: boolean;
  readonly createdAt: Date;
  readonly createdByName: string | null;
}

export interface CareChargeDetailDto extends CareChargeSummaryDto {
  readonly unitPriceMinor: number;
  readonly priceVersion: number;
  readonly visitCount: number;
  readonly subscription: {
    readonly id: string;
    readonly numberLabel: string;
    readonly status: CustomerSubscriptionStatus;
    readonly addressLine: string | null;
    readonly city: string | null;
  };
  readonly customer: { readonly id: string; readonly name: string };
  readonly lines: readonly CareChargeLineDto[];
  readonly payments: readonly CareChargePaymentDto[];
  /** Il saldo a favore di questo cargo è entrato in quest'altro cargo. */
  readonly carriedInto: { readonly id: string; readonly numberLabel: string } | null;
  readonly canPay: boolean;
  readonly canRefund: boolean;
}

/** Un "Ajuste para el próximo cargo" ancora in attesa (blocco 3b). */
export interface CareAdjustmentDto {
  readonly id: string;
  /** Con il segno: negativo a favore del cliente. */
  readonly amountMinor: number;
  readonly reason: string;
  readonly createdAt: string;
  readonly createdByName: string | null;
}

export interface CareContractChargesDto {
  readonly items: readonly CareChargeSummaryDto[];
  readonly total: number;
  /** Quanto manca da pagare in tutti i cargos del contratto. */
  readonly balanceMinor: number;
  readonly overdueCount: number;
  readonly currency: string;
  /** Gli ajustes che entreranno nel prossimo cargo. */
  readonly adjustments: readonly CareAdjustmentDto[];
  /** Si può aggiungere un ajuste: il contratto avrà ancora un cargo (attivo o in pausa). */
  readonly canAdjust: boolean;
}

export interface CareChargesOverviewDto {
  readonly openCount: number;
  readonly openMinor: number;
  readonly overdueCount: number;
  readonly overdueMinor: number;
  /** Blocco 3b: incassi segnati alla visita che aspettano chi gestisce. */
  readonly pendingCollections: number;
  readonly currency: string;
}

const summarySelect = {
  id: true,
  number: true,
  period: true,
  issuedOn: true,
  dueDate: true,
  totalMinor: true,
  paidMinor: true,
  balanceMinor: true,
  currency: true,
  final: true,
} satisfies Prisma.CareChargeSelect;

type SummaryRow = Prisma.CareChargeGetPayload<{ select: typeof summarySelect }>;

export function toCareChargeSummary(row: SummaryRow, today: CalendarDate): CareChargeSummaryDto {
  return {
    id: row.id,
    numberLabel: formatCareChargeNumber(row.number),
    period: isoOf(row.period) ?? '',
    issuedOn: isoOf(row.issuedOn) ?? '',
    dueDate: isoOf(row.dueDate) ?? '',
    status: careChargeStatus({
      totalMinor: row.totalMinor,
      paidMinor: row.paidMinor,
      dueDate: requiredParts(row.dueDate),
      today,
    }),
    totalMinor: row.totalMinor,
    paidMinor: row.paidMinor,
    balanceMinor: row.balanceMinor,
    currency: row.currency,
    final: row.final,
  };
}

/** Il filtro di una pestaña di "Cobros" (lo stato si calcola: qui con saldo e scadenza). */
export function careChargeViewWhere(
  view: CareChargeView,
  today: CalendarDate,
): Prisma.CareChargeWhereInput {
  switch (view) {
    case 'open':
      return { balanceMinor: { gt: 0 } };
    case 'overdue':
      return { balanceMinor: { gt: 0 }, dueDate: { lt: dbDate(today) } };
    case 'paid':
      return { balanceMinor: 0 };
    case 'credit':
      return { balanceMinor: { lt: 0 } };
  }
}

/** "CAR-0012", "car12" o "12" → 12. */
function chargeNumberOf(query: string): number | null {
  const match = /^(?:car-?)?0*(\d{1,7})$/i.exec(query.trim());
  return match ? Number(match[1]) : null;
}

/** "Cobros": i cargos della fioreria per pestaña, mese e ricerca (cliente o numero). */
export async function listCareCharges(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<CareChargeListResult> {
  requirePermission(ctx, 'subscriptions:payments');
  const filters = careChargeListFiltersSchema.parse(rawFilters ?? {});
  const today = todayInTimeZone(ctx.timezone);
  const number = filters.q ? chargeNumberOf(filters.q) : null;
  const base: Prisma.CareChargeWhereInput = {
    tenantId: ctx.tenantId,
    ...(filters.month ? { period: dbDate(filters.month) } : {}),
    ...(filters.q
      ? {
          OR: [
            { customer: { displayName: { contains: filters.q, mode: 'insensitive' } } },
            ...(number !== null ? [{ number }] : []),
          ],
        }
      : {}),
  };
  const where: Prisma.CareChargeWhereInput = {
    AND: [base, careChargeViewWhere(filters.view, today)],
  };
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const counts = {} as Record<CareChargeView, number>;
    for (const view of CARE_CHARGE_VIEWS) {
      counts[view] = await tx.careCharge.count({
        where: { AND: [base, careChargeViewWhere(view, today)] },
      });
    }
    const total = counts[filters.view];
    const pageCount = Math.max(1, Math.ceil(total / CARE_CHARGE_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const ascending = filters.view === 'open' || filters.view === 'overdue';
    const [rows, sums] = await Promise.all([
      tx.careCharge.findMany({
        where,
        orderBy: ascending
          ? [{ dueDate: 'asc' }, { number: 'asc' }]
          : [{ period: 'desc' }, { number: 'desc' }],
        skip: (page - 1) * CARE_CHARGE_PAGE_SIZE,
        take: CARE_CHARGE_PAGE_SIZE,
        select: {
          ...summarySelect,
          subscription: {
            select: {
              id: true,
              number: true,
              customerAddress: { select: { addressLine1: true, neighborhood: true } },
            },
          },
          customer: { select: { id: true, displayName: true } },
        },
      }),
      tx.careCharge.aggregate({
        where,
        _sum: { totalMinor: true, paidMinor: true, balanceMinor: true },
      }),
    ]);
    return { counts, total, page, pageCount, rows, sums };
  });
  return {
    items: result.rows.map((row) => ({
      ...toCareChargeSummary(row, today),
      subscriptionId: row.subscription.id,
      contractLabel: formatSubscriptionNumber(row.subscription.number),
      customerId: row.customer.id,
      customerName: row.customer.displayName,
      addressLine: row.subscription.customerAddress
        ? addressLineOf(row.subscription.customerAddress)
        : null,
    })),
    total: result.total,
    page: result.page,
    pageCount: result.pageCount,
    view: filters.view,
    month: filters.month ? carePeriodKey(filters.month) : null,
    q: filters.q,
    counts: result.counts,
    sums: {
      totalMinor: result.sums._sum.totalMinor ?? 0,
      paidMinor: result.sums._sum.paidMinor ?? 0,
      balanceMinor: result.sums._sum.balanceMinor ?? 0,
    },
    currency: ctx.currency,
  };
}

/** Un cargo con le righe e i movimenti, dentro il suo contratto. 404 se non è della fioreria. */
export async function getCareCharge(
  ctx: TenantContext,
  subscriptionId: string,
  chargeId: string,
): Promise<CareChargeDetailDto> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(chargeId) || !isUuid(subscriptionId)) throw new NotFoundError('CareCharge');
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const charge = await tx.careCharge.findFirst({
      where: { tenantId: ctx.tenantId, id: chargeId, subscriptionId },
      select: {
        ...summarySelect,
        unitPriceMinor: true,
        priceVersion: true,
        visitCount: true,
        subscription: {
          select: {
            id: true,
            number: true,
            status: true,
            customerAddress: { select: { addressLine1: true, neighborhood: true, city: true } },
          },
        },
        customer: { select: { id: true, displayName: true } },
        lines: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            kind: true,
            quantity: true,
            unitPriceMinor: true,
            amountMinor: true,
            visitId: true,
            visitDate: true,
            creditReason: true,
            label: true,
            sourceCharge: { select: { id: true, number: true } },
          },
        },
        carriedInto: { take: 1, select: { charge: { select: { id: true, number: true } } } },
        allocations: {
          orderBy: { createdAt: 'asc' },
          select: {
            amountMinor: true,
            payment: {
              select: {
                id: true,
                kind: true,
                status: true,
                method: true,
                paidOn: true,
                reference: true,
                note: true,
                amountMinor: true,
                createdAt: true,
                createdById: true,
                reversal: { select: { id: true } },
                _count: { select: { allocations: true } },
              },
            },
          },
        },
      },
    });
    if (!charge) return null;
    const names = await memberNamesTx(tx, ctx.tenantId, [
      ...new Set(charge.allocations.flatMap((item) => item.payment.createdById ?? [])),
    ]);
    return { charge, names };
  });
  if (!found) return notFound(ctx, 'CareCharge', chargeId);
  const { charge: row, names } = found;
  const summary = toCareChargeSummary(row, today);
  const carried = row.carriedInto[0]?.charge ?? null;
  return {
    ...summary,
    unitPriceMinor: row.unitPriceMinor,
    priceVersion: row.priceVersion,
    visitCount: row.visitCount,
    subscription: {
      id: row.subscription.id,
      numberLabel: formatSubscriptionNumber(row.subscription.number),
      status: row.subscription.status,
      addressLine: row.subscription.customerAddress
        ? addressLineOf(row.subscription.customerAddress)
        : null,
      city: row.subscription.customerAddress?.city ?? null,
    },
    customer: { id: row.customer.id, name: row.customer.displayName },
    lines: row.lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      amountMinor: line.amountMinor,
      visitId: line.visitId,
      visitDate: isoOf(line.visitDate),
      creditReason: line.creditReason,
      label: line.label,
      sourceCharge: line.sourceCharge
        ? {
            id: line.sourceCharge.id,
            numberLabel: formatCareChargeNumber(line.sourceCharge.number),
          }
        : null,
    })),
    payments: row.allocations.map((item) => ({
      id: item.payment.id,
      kind: item.payment.kind,
      status: item.payment.status,
      method: item.payment.method,
      paidOn: isoOf(item.payment.paidOn) ?? '',
      reference: item.payment.reference,
      note: item.payment.note,
      amountMinor: item.amountMinor,
      paymentAmountMinor: item.payment.amountMinor,
      chargeCount: item.payment._count.allocations,
      reversed: item.payment.reversal !== null,
      createdAt: item.payment.createdAt,
      createdByName: item.payment.createdById
        ? (names.get(item.payment.createdById) ?? null)
        : null,
    })),
    carriedInto: carried
      ? { id: carried.id, numberLabel: formatCareChargeNumber(carried.number) }
      : null,
    canPay: summary.balanceMinor > 0,
    canRefund: summary.balanceMinor < 0,
  };
}

/** I nomi di chi ha registrato i movimenti (membri della fioreria). */
export async function memberNamesTx(
  tx: TransactionClient,
  tenantId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const members = await tx.membership.findMany({
    where: { tenantId, userId: { in: [...userIds] } },
    select: { userId: true, user: { select: { name: true } } },
  });
  return new Map(members.map((member) => [member.userId, member.user.name]));
}

/** Gli ultimi cargos di un contratto (la card del contratto), con il saldo di tutti. */
export async function listContractCharges(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<CareContractChargesDto> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const today = todayInTimeZone(ctx.timezone);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      select: { id: true, currency: true, status: true, confirmedAt: true },
    });
    if (!contract) return null;
    const where = { tenantId: ctx.tenantId, subscriptionId };
    const [rows, total, open, overdueCount, adjustments] = await Promise.all([
      tx.careCharge.findMany({
        where,
        orderBy: [{ period: 'desc' }, { number: 'desc' }],
        take: 6,
        select: summarySelect,
      }),
      tx.careCharge.count({ where }),
      tx.careCharge.aggregate({
        where: { ...where, balanceMinor: { gt: 0 } },
        _sum: { balanceMinor: true },
      }),
      tx.careCharge.count({
        where: { ...where, balanceMinor: { gt: 0 }, dueDate: { lt: dbDate(today) } },
      }),
      tx.careChargeAdjustment.findMany({
        where: { ...where, removedAt: null, lines: { none: {} } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, amountMinor: true, reason: true, createdAt: true, createdById: true },
      }),
    ]);
    const names = await memberNamesTx(
      tx,
      ctx.tenantId,
      adjustments.flatMap((adjustment) => (adjustment.createdById ? [adjustment.createdById] : [])),
    );
    return { contract, rows, total, open, overdueCount, adjustments, names };
  });
  if (!result) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  const { contract } = result;
  return {
    items: result.rows.map((row) => toCareChargeSummary(row, today)),
    total: result.total,
    balanceMinor: result.open._sum.balanceMinor ?? 0,
    overdueCount: result.overdueCount,
    currency: contract.currency,
    adjustments: result.adjustments.map((adjustment) => ({
      id: adjustment.id,
      amountMinor: adjustment.amountMinor,
      reason: adjustment.reason,
      createdAt: adjustment.createdAt.toISOString(),
      createdByName: adjustment.createdById
        ? (result.names.get(adjustment.createdById) ?? null)
        : null,
    })),
    canAdjust:
      contract.confirmedAt !== null &&
      (contract.status === 'ACTIVE' || contract.status === 'PAUSED'),
  };
}

/**
 * Il riquadro "Cobros de Floral Care" del pannello: quanto c'è da cobrar e quanto è vencido. Null
 * per chi non gestisce i soldi o se la fioreria non ha ancora cargos.
 */
export async function getCareChargesOverview(
  ctx: TenantContext,
): Promise<CareChargesOverviewDto | null> {
  if (!hasPermission(ctx, 'subscriptions:payments')) return null;
  const today = todayInTimeZone(ctx.timezone);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const [anyCharge, pendingCollections] = await Promise.all([
      tx.careCharge.findFirst({ where: { tenantId: ctx.tenantId }, select: { id: true } }),
      tx.carePayment.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } }),
    ]);
    if (!anyCharge && pendingCollections === 0) return null;
    const [open, overdue] = await Promise.all([
      tx.careCharge.aggregate({
        where: { tenantId: ctx.tenantId, balanceMinor: { gt: 0 } },
        _count: { _all: true },
        _sum: { balanceMinor: true },
      }),
      tx.careCharge.aggregate({
        where: {
          tenantId: ctx.tenantId,
          balanceMinor: { gt: 0 },
          dueDate: { lt: dbDate(today) },
        },
        _count: { _all: true },
        _sum: { balanceMinor: true },
      }),
    ]);
    return { open, overdue, pendingCollections };
  });
  if (!result) return null;
  return {
    openCount: result.open._count._all,
    openMinor: result.open._sum.balanceMinor ?? 0,
    overdueCount: result.overdue._count._all,
    overdueMinor: result.overdue._sum.balanceMinor ?? 0,
    pendingCollections: result.pendingCollections,
    currency: ctx.currency,
  };
}

/**
 * I contratti (fra quelli dati) con almeno un cargo vencido: l'etichetta "Vencido" dell'elenco.
 * Vuoto per chi non gestisce i soldi.
 */
export async function overdueCareContractIdsTx(
  tx: TransactionClient,
  ctx: TenantContext,
  subscriptionIds: readonly string[],
): Promise<Set<string>> {
  if (!hasPermission(ctx, 'subscriptions:payments') || subscriptionIds.length === 0) {
    return new Set();
  }
  const today = todayInTimeZone(ctx.timezone);
  const rows = await tx.careCharge.findMany({
    where: {
      tenantId: ctx.tenantId,
      subscriptionId: { in: [...subscriptionIds] },
      balanceMinor: { gt: 0 },
      dueDate: { lt: dbDate(today) },
    },
    distinct: ['subscriptionId'],
    select: { subscriptionId: true },
  });
  return new Set(rows.map((row) => row.subscriptionId));
}
