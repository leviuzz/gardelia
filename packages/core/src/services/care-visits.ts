/**
 * Visite di Floral Care nell'Agenda dei lavori (ADR-074, blocco 1): il giorno per fascia (con i
 * posti occupati), il mese (quante visite per giorno) e le visite "Por reprogramar". Dalla visita:
 * "Hecha" o "No se pudo" (tutta la squadra, `care:visit`), e chi gestisce la sposta, la cancella o
 * la assegna a una persona. Spostare o cancellare tocca una visita già fissata: serve "Sí, avisé al
 * cliente"; cambiare solo la persona no.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_LIMITS,
  CARE_VISIT_HOLDING_STATUSES,
  addDays,
  canCloseCareVisit,
  careVisitCancelSchema,
  careVisitMoveSchema,
  careVisitOutcomeSchema,
  compareDates,
  dayOfWeek,
  daysInMonth,
  formatSubscriptionNumber,
  formatTimeOfDay,
  isUuid,
  parseIsoDate,
  toFieldErrors,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
  type CareVisitCancelReason,
  type CareVisitStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { requireEntitlement } from './billing';
import { openSlotBook } from './care-booking';
import {
  addressLineOf,
  dbDate,
  earlierDate,
  isoOf,
  laterDate,
  lockSubscription,
  requiredParts,
} from './care-internals';
import { dateToParts } from './quote-internals';

export interface CareAgendaVisitDto {
  readonly id: string;
  readonly subscriptionId: string;
  readonly numberLabel: string;
  readonly customerName: string;
  readonly addressLine: string | null;
  readonly status: CareVisitStatus;
  /** Giorno programmato ("AAAA-MM-GG"); null per "Por reprogramar". */
  readonly date: string | null;
  /** Il giorno che diceva il calendario del contratto. */
  readonly originalDate: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly slotId: string | null;
  readonly seats: number;
  readonly isExtra: boolean;
  /** Non è più nel suo giorno originale. */
  readonly moved: boolean;
  readonly assignee: { readonly membershipId: string; readonly name: string } | null;
  readonly plantCount: number;
  readonly outcomeNote: string | null;
  readonly cancelReason: CareVisitCancelReason | null;
  /** Chi guarda può segnarla "Hecha" o "No se pudo" adesso. */
  readonly canClose: boolean;
  /** Chi guarda può spostarla, cancellarla o assegnarla. */
  readonly canManage: boolean;
}

export interface CareAgendaSlotGroup {
  /** null = visite senza fascia (non succede per quelle programmate). */
  readonly slotId: string | null;
  readonly start: string | null;
  readonly end: string | null;
  /** Posti della fascia; null se la fascia è archiviata. */
  readonly capacity: number | null;
  readonly used: number;
  readonly visits: readonly CareAgendaVisitDto[];
}

export interface CareAgendaDayDto {
  readonly date: string;
  readonly isToday: boolean;
  /** Le fasce del giorno della settimana (anche vuote) e le visite, in ordine di ora. */
  readonly groups: readonly CareAgendaSlotGroup[];
  readonly counts: { readonly total: number; readonly done: number; readonly pending: number };
  /** Visite di tutta la fioreria ancora da riprogrammare. */
  readonly toReschedule: number;
}

export interface CareAgendaMonthDto {
  readonly year: number;
  readonly month: number;
  /** Solo i giorni con visite. */
  readonly days: readonly { readonly date: string; readonly visits: number }[];
  readonly toReschedule: number;
}

export interface CareMoveOptionDto {
  readonly date: string;
  readonly slotId: string;
  readonly start: string;
  readonly end: string;
  readonly free: number;
}

export interface CareVisitMoveOptionsDto {
  readonly visit: CareAgendaVisitDto;
  /** Fasce con posto nei prossimi 21 giorni (dentro il contratto). */
  readonly options: readonly CareMoveOptionDto[];
}

export interface CareAssigneeDto {
  readonly membershipId: string;
  readonly name: string;
}

const MOVE_OPTION_DAYS = 21;

const agendaSelect = {
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

type AgendaRow = Prisma.CareVisitGetPayload<{ select: typeof agendaSelect }>;

async function plantCounts(
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

function toAgendaVisit(
  ctx: TenantContext,
  row: AgendaRow,
  plants: ReadonlyMap<string, number>,
  today: CalendarDate,
): CareAgendaVisitDto {
  const date = dateToParts(row.scheduledDate);
  const original = requiredParts(row.originalDate);
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
    plantCount: plants.get(row.subscriptionId) ?? 0,
    outcomeNote: row.outcomeNote,
    cancelReason: row.cancelReason,
    canClose:
      hasPermission(ctx, 'care:visit') &&
      canCloseCareVisit(row.status) &&
      date !== null &&
      compareDates(date, today) <= 0,
    canManage:
      hasPermission(ctx, 'subscriptions:write') &&
      (row.status === 'SCHEDULED' || row.status === 'TO_RESCHEDULE'),
  };
}

function parseDay(ctx: TenantContext, raw: unknown): CalendarDate {
  return parseIsoDate(raw) ?? todayInTimeZone(ctx.timezone);
}

/** Un giorno dell'Agenda: le fasce di quel giorno della settimana con le visite e i posti. */
export async function getCareAgendaDay(
  ctx: TenantContext,
  rawDate: unknown,
): Promise<CareAgendaDayDto> {
  requirePermission(ctx, 'subscriptions:read');
  const day = parseDay(ctx, rawDate);
  const today = todayInTimeZone(ctx.timezone);
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const [rows, slots, toReschedule] = await Promise.all([
      tx.careVisit.findMany({
        where: {
          tenantId: ctx.tenantId,
          scheduledDate: dbDate(day),
          status: { in: [...CARE_VISIT_HOLDING_STATUSES] },
        },
        orderBy: [{ startMinutes: 'asc' }, { createdAt: 'asc' }],
        select: agendaSelect,
      }),
      tx.careSlot.findMany({
        where: { tenantId: ctx.tenantId, status: 'ACTIVE', weekday: dayOfWeek(day) },
        orderBy: [{ startMinutes: 'asc' }, { endMinutes: 'asc' }],
      }),
      tx.careVisit.count({ where: { tenantId: ctx.tenantId, status: 'TO_RESCHEDULE' } }),
    ]);
    const plants = await plantCounts(
      tx,
      ctx.tenantId,
      rows.map((row) => row.subscriptionId),
    );
    const groups = new Map<string, CareAgendaSlotGroup & { visits: CareAgendaVisitDto[] }>();
    for (const slot of slots) {
      groups.set(slot.id, {
        slotId: slot.id,
        start: formatTimeOfDay(slot.startMinutes),
        end: formatTimeOfDay(slot.endMinutes),
        capacity: slot.capacity,
        used: 0,
        visits: [],
      });
    }
    for (const row of rows) {
      const key = row.slotId ?? 'none';
      let group = groups.get(key);
      if (!group) {
        group = {
          slotId: row.slotId,
          start: row.startMinutes === null ? null : formatTimeOfDay(row.startMinutes),
          end: row.endMinutes === null ? null : formatTimeOfDay(row.endMinutes),
          capacity: null,
          used: 0,
          visits: [],
        };
        groups.set(key, group);
      }
      group.visits.push(toAgendaVisit(ctx, row, plants, today));
      groups.set(key, { ...group, used: group.used + row.seats });
    }
    const ordered = [...groups.values()].sort((a, b) =>
      (a.start ?? '').localeCompare(b.start ?? ''),
    );
    const done = rows.filter((row) => row.status === 'DONE' || row.status === 'NOT_DONE').length;
    return {
      date: toIsoDate(day),
      isToday: compareDates(day, today) === 0,
      groups: ordered,
      counts: { total: rows.length, done, pending: rows.length - done },
      toReschedule,
    };
  });
}

/** `rawMonth` = "AAAA-MM"; senza (o non valido) il mese di oggi. */
export async function getCareAgendaMonth(
  ctx: TenantContext,
  rawMonth: unknown,
): Promise<CareAgendaMonthDto> {
  requirePermission(ctx, 'subscriptions:read');
  const today = todayInTimeZone(ctx.timezone);
  const match = typeof rawMonth === 'string' ? /^(\d{4})-(\d{2})$/.exec(rawMonth) : null;
  const year = match ? Number(match[1]) : today.year;
  const month = match ? Number(match[2]) : today.month;
  const valid = year >= 1900 && year <= 2200 && month >= 1 && month <= 12;
  const target = valid ? { year, month } : { year: today.year, month: today.month };
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const [grouped, toReschedule] = await Promise.all([
      tx.careVisit.groupBy({
        by: ['scheduledDate'],
        where: {
          tenantId: ctx.tenantId,
          status: { in: [...CARE_VISIT_HOLDING_STATUSES] },
          scheduledDate: {
            gte: dbDate({ ...target, day: 1 }),
            lte: dbDate({ ...target, day: daysInMonth(target.year, target.month) }),
          },
        },
        _count: { _all: true },
      }),
      tx.careVisit.count({ where: { tenantId: ctx.tenantId, status: 'TO_RESCHEDULE' } }),
    ]);
    return {
      year: target.year,
      month: target.month,
      days: grouped
        .filter((row) => row.scheduledDate !== null)
        .map((row) => ({ date: isoOf(row.scheduledDate) ?? '', visits: row._count._all }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      toReschedule,
    };
  });
}

/** Le visite senza posto nel loro mese, dalla più vecchia: la fioreria dà loro un giorno a mano. */
export async function listCareVisitsToReschedule(
  ctx: TenantContext,
): Promise<readonly CareAgendaVisitDto[]> {
  requirePermission(ctx, 'subscriptions:read');
  const today = todayInTimeZone(ctx.timezone);
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const rows = await tx.careVisit.findMany({
      where: { tenantId: ctx.tenantId, status: 'TO_RESCHEDULE' },
      orderBy: [{ originalDate: 'asc' }, { createdAt: 'asc' }],
      take: 100,
      select: agendaSelect,
    });
    const plants = await plantCounts(
      tx,
      ctx.tenantId,
      rows.map((row) => row.subscriptionId),
    );
    return rows.map((row) => toAgendaVisit(ctx, row, plants, today));
  });
}

async function findVisit(tx: TransactionClient, ctx: TenantContext, visitId: string) {
  return tx.careVisit.findFirst({
    where: { tenantId: ctx.tenantId, id: visitId },
    select: agendaSelect,
  });
}

/** Dove si può spostare una visita: le fasce con posto nei prossimi 21 giorni, dentro il contratto. */
export async function getCareVisitMoveOptions(
  ctx: TenantContext,
  visitId: string,
): Promise<CareVisitMoveOptionsDto> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const row = await findVisit(tx, ctx, visitId);
    if (!row) return null;
    const contract = await tx.customerSubscription.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, id: row.subscriptionId },
      select: { startDate: true, endDate: true },
    });
    const from = laterDate(today, requiredParts(contract.startDate));
    const end = dateToParts(contract.endDate);
    let until = addDays(from, MOVE_OPTION_DAYS - 1);
    if (end) until = earlierDate(until, end);
    const plants = await plantCounts(tx, ctx.tenantId, [row.subscriptionId]);
    const visit = toAgendaVisit(ctx, row, plants, today);
    if (compareDates(from, until) > 0) return { visit, options: [] };
    const book = await openSlotBook(tx, ctx.tenantId, { from, until }, { lock: false });
    const current = dateToParts(row.scheduledDate);
    const options: CareMoveOptionDto[] = [];
    for (let day = from; compareDates(day, until) <= 0; day = addDays(day, 1)) {
      for (const slot of book.activeSlots()) {
        if (slot.weekday !== dayOfWeek(day)) continue;
        const own = current && row.slotId === slot.id && compareDates(current, day) === 0;
        if (own) continue;
        const free = book.free(slot.id, day);
        if (free < row.seats) continue;
        options.push({
          date: toIsoDate(day),
          slotId: slot.id,
          start: formatTimeOfDay(slot.startMinutes),
          end: formatTimeOfDay(slot.endMinutes),
          free,
        });
      }
    }
    return { visit, options };
  });
  if (!found) return notFound(ctx, 'CareVisit', visitId);
  return found;
}

// -----------------------------------------------------------------------------
// Azioni sulla visita
// -----------------------------------------------------------------------------

async function lockVisit(tx: TransactionClient, ctx: TenantContext, visitId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CareVisit"
    WHERE "id" = ${visitId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.careVisit.findFirst({
    where: { tenantId: ctx.tenantId, id: visitId },
    include: { subscription: { select: { number: true, startDate: true, endDate: true } } },
  });
}

async function closeVisit(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
  outcome: 'DONE' | 'NOT_DONE',
): Promise<void> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const parsed = careVisitOutcomeSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { note } = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await lockVisit(tx, ctx, visitId);
    if (!visit) return false;
    if (!canCloseCareVisit(visit.status)) throw new ConflictError('care_visit_closed');
    const date = dateToParts(visit.scheduledDate);
    if (!date || compareDates(date, today) > 0) throw new ConflictError('care_visit_future');
    const now = new Date();
    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        status: outcome,
        startedAt: visit.startedAt ?? now,
        finishedAt: now,
        outcomeNote: note,
        closedById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: outcome === 'DONE' ? AUDIT_ACTIONS.careVisitDone : AUDIT_ACTIONS.careVisitNotDone,
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

/** "Hecha": la visita di oggi (o di un giorno passato) è stata fatta. */
export async function completeCareVisit(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<void> {
  await closeVisit(ctx, visitId, rawInput, 'DONE');
}

/** "No se pudo": il cliente non ha aperto (o altro); vale la regola del contratto. */
export async function markCareVisitNotDone(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<void> {
  await closeVisit(ctx, visitId, rawInput, 'NOT_DONE');
}

/**
 * Sposta una visita (anche una "Por reprogramar") a un giorno e una fascia con posto, fino a 90
 * giorni da oggi e dentro il contratto. Senza "Sí, avisé al cliente" non si salva.
 */
export async function moveCareVisit(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const parsed = careVisitMoveSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    // Ordine dei blocchi: contratto, fasce, visita (care-booking.ts).
    const first = await tx.careVisit.findFirst({
      where: { tenantId: ctx.tenantId, id: visitId },
      select: { subscriptionId: true },
    });
    if (!first) return false;
    await lockSubscription(tx, ctx.tenantId, first.subscriptionId);
    const book = await openSlotBook(tx, ctx.tenantId, { from: input.date, until: input.date });
    const visit = await lockVisit(tx, ctx, visitId);
    if (!visit) return false;
    if (visit.status !== 'SCHEDULED' && visit.status !== 'TO_RESCHEDULE') {
      throw new ConflictError('care_visit_closed');
    }
    const start = requiredParts(visit.subscription.startDate);
    const end = dateToParts(visit.subscription.endDate);
    if (
      compareDates(input.date, today) < 0 ||
      compareDates(input.date, addDays(today, CARE_LIMITS.moveDaysMax)) > 0 ||
      compareDates(input.date, start) < 0 ||
      (end && compareDates(input.date, end) > 0)
    ) {
      throw new ValidationError({ date: 'care_move_out_of_range' });
    }
    const slot = book.slot(input.slotId);
    if (!slot?.active) throw new ValidationError({ slotId: 'invalid_option' });
    if (slot.weekday !== dayOfWeek(input.date)) {
      throw new ValidationError({ slotId: 'care_slot_weekday' });
    }
    const current = dateToParts(visit.scheduledDate);
    if (
      visit.status === 'SCHEDULED' &&
      current &&
      visit.slotId === slot.id &&
      compareDates(current, input.date) === 0
    ) {
      return true;
    }
    if (book.free(slot.id, input.date) < visit.seats) throw new ConflictError('care_slot_full');
    if (!input.customerNotified) {
      throw new ValidationError({ customerNotified: 'care_notice_required' });
    }
    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        status: 'SCHEDULED',
        scheduledDate: dbDate(input.date),
        slotId: slot.id,
        startMinutes: slot.startMinutes,
        endMinutes: slot.endMinutes,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careVisitMoved,
      entityType: 'CareVisit',
      entityId: visit.id,
      metadata: {
        number: formatSubscriptionNumber(visit.subscription.number),
        from: current ? toIsoDate(current) : null,
        to: toIsoDate(input.date),
        slotId: slot.id,
        customerNotified: true,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CareVisit', visitId);
}

/**
 * Cancella una visita ancora da fare: la toglie la fioreria (un credito per i cargos, blocco 3) o
 * il cliente. La riga resta. Senza "Sí, avisé al cliente" non si salva.
 */
export async function cancelCareVisit(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const parsed = careVisitCancelSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const first = await tx.careVisit.findFirst({
      where: { tenantId: ctx.tenantId, id: visitId },
      select: { subscriptionId: true },
    });
    if (!first) return false;
    await lockSubscription(tx, ctx.tenantId, first.subscriptionId);
    const visit = await lockVisit(tx, ctx, visitId);
    if (!visit) return false;
    if (visit.status !== 'SCHEDULED' && visit.status !== 'TO_RESCHEDULE') {
      throw new ConflictError('care_visit_closed');
    }
    if (!input.customerNotified) {
      throw new ValidationError({ customerNotified: 'care_notice_required' });
    }
    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        status: 'CANCELLED',
        cancelReason: input.reason,
        outcomeNote: input.note,
        closedById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careVisitCancelled,
      entityType: 'CareVisit',
      entityId: visit.id,
      metadata: {
        number: formatSubscriptionNumber(visit.subscription.number),
        date: isoOf(visit.scheduledDate),
        reason: input.reason,
        customerNotified: true,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CareVisit', visitId);
}

/** Membri attivi della fioreria a cui assegnare una visita. */
export async function listCareAssignees(ctx: TenantContext): Promise<readonly CareAssigneeDto[]> {
  requirePermission(ctx, 'subscriptions:write');
  const members = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    return tx.membership.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, user: { select: { name: true } } },
    });
  });
  return members
    .map((member) => ({ membershipId: member.id, name: member.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Chi fa la visita (o nessuno, con vuoto). Cambia solo la persona, non l'ora: niente avviso al
 * cliente (decisione del founder del 24/11/2026).
 */
export async function assignCareVisit(
  ctx: TenantContext,
  visitId: string,
  rawMembershipId: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const membershipId =
    typeof rawMembershipId === 'string' && rawMembershipId.trim() !== ''
      ? rawMembershipId.trim()
      : null;
  if (membershipId !== null && !isUuid(membershipId)) {
    throw new ValidationError({ assignee: 'invalid_option' });
  }
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await lockVisit(tx, ctx, visitId);
    if (!visit) return false;
    if (visit.status !== 'SCHEDULED' && visit.status !== 'IN_PROGRESS') {
      throw new ConflictError('care_visit_closed');
    }
    if (membershipId !== null) {
      const member = await tx.membership.findFirst({
        where: { tenantId: ctx.tenantId, id: membershipId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!member) throw new ValidationError({ assignee: 'invalid_option' });
    }
    if (visit.assignedMembershipId === membershipId) return true;
    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: { assignedMembershipId: membershipId },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careVisitAssigned,
      entityType: 'CareVisit',
      entityId: visit.id,
      // ID dei membri, mai nomi: nel registro niente dati personali.
      metadata: {
        number: formatSubscriptionNumber(visit.subscription.number),
        from: visit.assignedMembershipId,
        to: membershipId,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CareVisit', visitId);
}
