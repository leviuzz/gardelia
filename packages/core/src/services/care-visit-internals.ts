/**
 * Parti comuni delle visite di Floral Care (ADR-075, ADR-078): la riga dell'Agenda, i permessi di
 * chi guarda e il blocco della visita. NON esportato da `@floral/core`.
 */
import type { Prisma, TransactionClient } from '@floral/db';
import {
  canShareCareVisit,
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
  outcomeNote: true,
  cancelReason: true,
  assignedMembershipId: true,
  assignedTo: { select: { user: { select: { name: true } } } },
  subscription: {
    select: {
      number: true,
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
    moved: date !== null && compareDates(date, original) !== 0,
    assignee:
      row.assignedMembershipId && row.assignedTo
        ? { membershipId: row.assignedMembershipId, name: row.assignedTo.user.name }
        : null,
    assignedToMe: row.assignedMembershipId === ctx.membershipId,
    plantCount: plants.get(row.subscriptionId) ?? 0,
    outcomeNote: row.outcomeNote,
    cancelReason: row.cancelReason,
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
