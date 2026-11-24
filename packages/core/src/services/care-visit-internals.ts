/**
 * Parti comuni delle visite di Floral Care (ADR-075, ADR-078): la riga dell'Agenda, i permessi di
 * chi guarda e il blocco della visita. NON esportato da `@floral/core`.
 */
import type { Prisma, TransactionClient } from '@floral/db';
import {
  CARE_LIVE_RECOVERY_STATUSES,
  canShareCareVisit,
  careVisitRecoverable,
  compareDates,
  formatSubscriptionNumber,
  formatTimeOfDay,
  toIsoDate,
  type CalendarDate,
} from '@floral/domain';
import { hasPermission } from '../authorization';
import type { TenantContext } from '../context';
import { addressLineOf, requiredParts } from './care-internals';
import type { CareAgendaVisitDto } from './care-visits';
import { dateToParts } from './quote-internals';

export const agendaSelect = {
  id: true,
  subscriptionId: true,
  status: true,
  scheduledDate: true,
  originalDate: true,
  slotId: true,
  startMinutes: true,
  endMinutes: true,
  seats: true,
  isExtra: true,
  extraKind: true,
  extraFee: true,
  extraFeeMinor: true,
  extraNote: true,
  outcomeNote: true,
  cancelReason: true,
  notDoneCause: true,
  assignedMembershipId: true,
  assignedTo: { select: { user: { select: { name: true } } } },
  // Blocco 3b: la visita mancata che questa recupera, e la visita di recupero ancora valida.
  recoveryOfVisitId: true,
  recoveryOf: { select: { scheduledDate: true, originalDate: true } },
  recoveries: {
    where: { status: { in: [...CARE_LIVE_RECOVERY_STATUSES] } },
    select: { id: true, scheduledDate: true, originalDate: true },
    take: 1,
  },
  subscription: {
    select: {
      number: true,
      status: true,
      missedVisitPolicy: true,
      customer: { select: { displayName: true } },
      customerAddress: { select: { addressLine1: true, neighborhood: true } },
    },
  },
} satisfies Prisma.CareVisitSelect;

export type AgendaRow = Prisma.CareVisitGetPayload<{ select: typeof agendaSelect }>;

/** Piante attive per contratto (un gruppo conta la sua quantità). */
export async function plantCounts(
  tx: TransactionClient,
  tenantId: string,
  subscriptionIds: readonly string[],
): Promise<Map<string, number>> {
  if (subscriptionIds.length === 0) return new Map();
  const rows = await tx.carePlant.groupBy({
    by: ['subscriptionId'],
    where: { tenantId, subscriptionId: { in: [...new Set(subscriptionIds)] }, status: 'ACTIVE' },
    _sum: { quantity: true },
  });
  return new Map(rows.map((row) => [row.subscriptionId, row._sum.quantity ?? 0]));
}

export function toAgendaVisit(
  ctx: TenantContext,
  row: AgendaRow,
  plants: ReadonlyMap<string, number>,
  today: CalendarDate,
): CareAgendaVisitDto {
  const date = dateToParts(row.scheduledDate);
  const original = requiredParts(row.originalDate);
  const due = date !== null && compareDates(date, today) <= 0;
  const visits = hasPermission(ctx, 'care:visit');
  const dayOf = (visit: { scheduledDate: Date | null; originalDate: Date }) =>
    toIsoDate(dateToParts(visit.scheduledDate) ?? requiredParts(visit.originalDate));
  const live = row.recoveries[0] ?? null;
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    numberLabel: formatSubscriptionNumber(row.subscription.number),
    customerName: row.subscription.customer.displayName,
    addressLine: row.subscription.customerAddress
      ? addressLineOf(row.subscription.customerAddress)
      : null,
    status: row.status,
    date: date ? toIsoDate(date) : null,
    originalDate: toIsoDate(original),
    start: row.startMinutes === null ? null : formatTimeOfDay(row.startMinutes),
    end: row.endMinutes === null ? null : formatTimeOfDay(row.endMinutes),
    slotId: row.slotId,
    seats: row.seats,
    isExtra: row.isExtra,
    extra:
      row.isExtra && row.extraKind && row.extraFee
        ? {
            kind: row.extraKind,
            fee: row.extraFee,
            feeMinor: row.extraFeeMinor ?? 0,
            note: row.extraNote,
          }
        : null,
    // Una visita extra non ha un "giorno originale" del calendario: non risulta mai spostata.
    moved: !row.isExtra && date !== null && compareDates(date, original) !== 0,
    assignee:
      row.assignedMembershipId && row.assignedTo
        ? { membershipId: row.assignedMembershipId, name: row.assignedTo.user.name }
        : null,
    assignedToMe: row.assignedMembershipId === ctx.membershipId,
    plantCount: plants.get(row.subscriptionId) ?? 0,
    outcomeNote: row.outcomeNote,
    cancelReason: row.cancelReason,
    notDoneCause: row.notDoneCause,
    // Come l'elenco "Por recuperar": si recupera solo in un contratto attivo (una visita di
    // recupero già fissata resta visibile anche dopo).
    recovery:
      careVisitRecoverable(row, row.subscription.missedVisitPolicy) &&
      (live !== null || row.subscription.status === 'ACTIVE')
        ? {
            visitId: live?.id ?? null,
            date: live ? dayOf(live) : null,
            canSchedule:
              live === null &&
              row.subscription.status === 'ACTIVE' &&
              hasPermission(ctx, 'subscriptions:write'),
          }
        : null,
    recoveryOf:
      row.recoveryOfVisitId && row.recoveryOf
        ? { visitId: row.recoveryOfVisitId, date: dayOf(row.recoveryOf) }
        : null,
    canStart: visits && row.status === 'SCHEDULED' && due,
    canContinue: visits && row.status === 'IN_PROGRESS',
    canMarkNotDone: visits && (row.status === 'SCHEDULED' || row.status === 'IN_PROGRESS') && due,
    hasReport: canShareCareVisit(row.status),
    canManage:
      hasPermission(ctx, 'subscriptions:write') &&
      (row.status === 'SCHEDULED' || row.status === 'TO_RESCHEDULE'),
  };
}

/** Blocca la visita fino alla fine della transazione e la rilegge con il suo contratto. */
export async function lockCareVisit(tx: TransactionClient, ctx: TenantContext, visitId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CareVisit"
    WHERE "id" = ${visitId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.careVisit.findFirst({
    where: { tenantId: ctx.tenantId, id: visitId },
    include: {
      subscription: {
        select: { number: true, startDate: true, endDate: true, status: true, customerId: true },
      },
    },
  });
}

export type LockedCareVisit = NonNullable<Awaited<ReturnType<typeof lockCareVisit>>>;
