/**
 * Visite di Floral Care nell'Agenda dei lavori (ADR-075, blocco 1): il giorno per fascia (con i
 * posti occupati), il mese (quante visite per giorno) e le visite "Por reprogramar". Chi gestisce
 * sposta, cancella o assegna una visita. Spostare o cancellare tocca una visita già fissata: serve
 * "Sí, avisé al cliente"; cambiare solo la persona no. La visita dal telefono (Empezar, passi,
 * Terminar, No se pudo) è in `care-visit-work.ts` (ADR-078).
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_CHARGE_LIMITS,
  CARE_LIMITS,
  CARE_LIVE_RECOVERY_STATUSES,
  CARE_VISIT_HOLDING_STATUSES,
  addDays,
  careCancellationCharged,
  careVisitCancelSchema,
  careVisitStartAt,
  careVisitMoveSchema,
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
  type CareExtraFee,
  type CareExtraKind,
  type CareNotDoneCause,
  type CareVisitCancelReason,
  type CareVisitStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { requireEntitlement } from './billing';
import { openSlotBook } from './care-booking';
import { countOpenCareFollowUpsTx } from './care-follow-ups';
import {
  dbDate,
  earlierDate,
  isoOf,
  laterDate,
  lockSubscription,
  requiredParts,
} from './care-internals';
import {
  agendaSelect,
  lockCareVisit as lockVisit,
  plantCounts,
  toAgendaVisit,
} from './care-visit-internals';
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
  /** Visita extra (ADR-078): perché, quale costo e quanto, la nota per chi la fa. */
  readonly extra: {
    readonly kind: CareExtraKind;
    readonly fee: CareExtraFee;
    readonly feeMinor: number;
    readonly note: string | null;
  } | null;
  /** Non è più nel suo giorno originale. */
  readonly moved: boolean;
  readonly assignee: { readonly membershipId: string; readonly name: string } | null;
  /** È assegnata a chi guarda ("Mis visitas"). */
  readonly assignedToMe: boolean;
  readonly plantCount: number;
  readonly outcomeNote: string | null;
  readonly cancelReason: CareVisitCancelReason | null;
  /** Cancellata dal cliente: si paga (true) o no (false); null negli altri casi (ADR-082). */
  readonly cancelCharged: boolean | null;
  /** "No se pudo": il cliente non ha aperto o la fioreria non è potuta andare (ADR-082). */
  readonly notDoneCause: CareNotDoneCause | null;
  /**
   * Cancelación del cliente (ADR-082): le ore del contratto, fino a quando cancella senza pagare
   * (istante ISO; null se non si paga mai o la visita non ha giorno e ora) e se adesso si
   * pagherebbe. null per le visite extra e per quelle già chiuse.
   */
  readonly lateCancel: {
    readonly hours: number;
    readonly freeUntil: string | null;
    readonly chargedNow: boolean;
  } | null;
  /**
   * Blocco 3b: una visita mancata per il cliente in un contratto con «Se agenda otra visita».
   * `visitId` è la sua visita di recupero ancora valida ("Recuperada el …"); senza, è "Por
   * recuperar" e chi gestisce la può fissare (`canSchedule`). null se la regola non vale.
   */
  readonly recovery: {
    readonly visitId: string | null;
    readonly date: string | null;
    readonly canSchedule: boolean;
  } | null;
  /** Questa visita extra recupera una visita mancata ("Recuperación de la visita del …"). */
  readonly recoveryOf: { readonly visitId: string; readonly date: string } | null;
  /** Chi guarda può iniziarla adesso ("Empezar visita": programmata, di oggi o di un giorno passato). */
  readonly canStart: boolean;
  /** È in corso e chi guarda può continuarla. */
  readonly canContinue: boolean;
  /** Chi guarda può segnarla "No se pudo" adesso. */
  readonly canMarkNotDone: boolean;
  /** Chiusa (hecha o no realizada): ha il suo resoconto. */
  readonly hasReport: boolean;
  /** Chi guarda può spostarla, cancellarla o assegnarla. */
  readonly canManage: boolean;
}

export interface CareAgendaSlotGroup {
  /** null = visite extra a un'ora libera (ADR-078): un gruppo per ora, senza posti. */
  readonly slotId: string | null;
  readonly start: string | null;
  readonly end: string | null;
  /** Posti della fascia; null se la fascia è archiviata. */
  readonly capacity: number | null;
  readonly used: number;
  /** Il nome del blocco che toglie questa fascia quel giorno (ADR-083), o null. */
  readonly blockedBy: string | null;
  readonly visits: readonly CareAgendaVisitDto[];
}

/** Un blocco di giorni attivo in quel giorno (ADR-083). */
export interface CareAgendaBlockDto {
  readonly id: string;
  readonly label: string;
  /** null = tutto il giorno; altrimenti l'orario tolto. */
  readonly slot: { readonly start: string; readonly end: string } | null;
}

export interface CareAgendaDayDto {
  readonly date: string;
  readonly isToday: boolean;
  /** Le fasce del giorno della settimana (anche vuote) e le visite, in ordine di ora. */
  readonly groups: readonly CareAgendaSlotGroup[];
  readonly counts: { readonly total: number; readonly done: number; readonly pending: number };
  /** Visite di tutta la fioreria ancora da riprogrammare. */
  readonly toReschedule: number;
  /** Blocco 3b: visite mancate per il cliente da recuperare con una visita gratis. */
  readonly toRecover: number;
  /** Avvisi della squadra ancora aperti (reposición, extra, altro), per chi gestisce. */
  readonly openFollowUps: number;
  /** I blocchi di giorni attivi quel giorno (ADR-083). */
  readonly blocks: readonly CareAgendaBlockDto[];
}

export interface CareAgendaMonthDto {
  readonly year: number;
  readonly month: number;
  /** Solo i giorni con visite. */
  readonly days: readonly { readonly date: string; readonly visits: number }[];
  readonly toReschedule: number;
  /** I giorni con un blocco attivo (ADR-083): tutto il giorno o solo un orario. */
  readonly blockedDays: readonly { readonly date: string; readonly wholeDay: boolean }[];
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
  /** Una visita extra si può spostare anche a un'ora libera (ADR-078). */
  readonly freeTime: boolean;
}

export interface CareAssigneeDto {
  readonly membershipId: string;
  readonly name: string;
}

const MOVE_OPTION_DAYS = 21;

function parseDay(ctx: TenantContext, raw: unknown): CalendarDate {
  return parseIsoDate(raw) ?? todayInTimeZone(ctx.timezone);
}

/**
 * "Por recuperar" (blocco 3b): visite del calendario mancate per il cliente (o di prima, senza
 * causa), in un contratto attivo con «Se agenda otra visita», senza una visita di recupero valida.
 * Stessa regola di `careVisitRecoverable`, scritta per il database.
 */
function toRecoverWhere(tenantId: string) {
  return {
    tenantId,
    isExtra: false,
    status: 'NOT_DONE' as const,
    OR: [{ notDoneCause: null }, { notDoneCause: 'CUSTOMER' as const }],
    subscription: { missedVisitPolicy: 'RECOVER' as const, status: 'ACTIVE' as const },
    recoveries: { none: { status: { in: [...CARE_LIVE_RECOVERY_STATUSES] } } },
  };
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
    const [rows, slots, toReschedule, toRecover, openFollowUps, blocks] = await Promise.all([
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
      tx.careVisit.count({ where: toRecoverWhere(ctx.tenantId) }),
      countOpenCareFollowUpsTx(tx, ctx.tenantId),
      tx.careBlock.findMany({
        where: {
          tenantId: ctx.tenantId,
          removedAt: null,
          startDate: { lte: dbDate(day) },
          endDate: { gte: dbDate(day) },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          label: true,
          slotId: true,
          slot: { select: { startMinutes: true, endMinutes: true } },
        },
      }),
    ]);
    // Il nome del primo blocco che toglie la fascia quel giorno (tutto il giorno o proprio lei).
    const blockedBy = (slotId: string | null) =>
      blocks.find((block) => block.slotId === null || block.slotId === slotId)?.label ?? null;
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
        blockedBy: blockedBy(slot.id),
        visits: [],
      });
    }
    for (const row of rows) {
      // Senza fascia (visita extra a un'ora libera): un gruppo per ora, senza posti da contare.
      const key = row.slotId ?? `time:${row.startMinutes ?? ''}-${row.endMinutes ?? ''}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          slotId: row.slotId,
          start: row.startMinutes === null ? null : formatTimeOfDay(row.startMinutes),
          end: row.endMinutes === null ? null : formatTimeOfDay(row.endMinutes),
          capacity: null,
          used: 0,
          blockedBy: row.slotId ? blockedBy(row.slotId) : blockedBy(null),
          visits: [],
        };
        groups.set(key, group);
      }
      group.visits.push(toAgendaVisit(ctx, row, plants, today));
      groups.set(key, { ...group, used: row.slotId ? group.used + row.seats : 0 });
    }
    const ordered = [...groups.values()].sort(
      (a, b) =>
        (a.start ?? '').localeCompare(b.start ?? '') || (a.end ?? '').localeCompare(b.end ?? ''),
    );
    const done = rows.filter((row) => row.status === 'DONE' || row.status === 'NOT_DONE').length;
    return {
      date: toIsoDate(day),
      isToday: compareDates(day, today) === 0,
      groups: ordered,
      counts: { total: rows.length, done, pending: rows.length - done },
      toReschedule,
      toRecover,
      openFollowUps,
      blocks: blocks.map((block) => ({
        id: block.id,
        label: block.label,
        slot: block.slot
          ? {
              start: formatTimeOfDay(block.slot.startMinutes),
              end: formatTimeOfDay(block.slot.endMinutes),
            }
          : null,
      })),
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
    const first = { ...target, day: 1 };
    const last = { ...target, day: daysInMonth(target.year, target.month) };
    const [grouped, toReschedule, blocks] = await Promise.all([
      tx.careVisit.groupBy({
        by: ['scheduledDate'],
        where: {
          tenantId: ctx.tenantId,
          status: { in: [...CARE_VISIT_HOLDING_STATUSES] },
          scheduledDate: { gte: dbDate(first), lte: dbDate(last) },
        },
        _count: { _all: true },
      }),
      tx.careVisit.count({ where: { tenantId: ctx.tenantId, status: 'TO_RESCHEDULE' } }),
      tx.careBlock.findMany({
        where: {
          tenantId: ctx.tenantId,
          removedAt: null,
          startDate: { lte: dbDate(last) },
          endDate: { gte: dbDate(first) },
        },
        select: { startDate: true, endDate: true, slotId: true },
      }),
    ]);
    // Ogni giorno del mese con un blocco: tutto il giorno vince su un orario solo.
    const blockedDays = new Map<string, boolean>();
    for (const block of blocks) {
      const start = laterDate(requiredParts(block.startDate), first);
      const end = earlierDate(requiredParts(block.endDate), last);
      for (let day = start; compareDates(day, end) <= 0; day = addDays(day, 1)) {
        const key = toIsoDate(day);
        blockedDays.set(key, (blockedDays.get(key) ?? false) || block.slotId === null);
      }
    }
    return {
      year: target.year,
      month: target.month,
      days: grouped
        .filter((row) => row.scheduledDate !== null)
        .map((row) => ({ date: isoOf(row.scheduledDate) ?? '', visits: row._count._all }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      toReschedule,
      blockedDays: [...blockedDays]
        .map(([date, wholeDay]) => ({ date, wholeDay }))
        .sort((a, b) => a.date.localeCompare(b.date)),
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

/** "Por recuperar": le visite mancate da recuperare, dalla più vecchia (blocco 3b). */
export async function listCareVisitsToRecover(
  ctx: TenantContext,
): Promise<readonly CareAgendaVisitDto[]> {
  requirePermission(ctx, 'subscriptions:read');
  const today = todayInTimeZone(ctx.timezone);
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const rows = await tx.careVisit.findMany({
      where: toRecoverWhere(ctx.tenantId),
      orderBy: [{ scheduledDate: 'asc' }, { originalDate: 'asc' }, { createdAt: 'asc' }],
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

/** Una visita (Agenda → la visita): per chi la fa e per chi la sposta. */
export async function getCareVisit(
  ctx: TenantContext,
  visitId: string,
): Promise<CareAgendaVisitDto> {
  requirePermission(ctx, 'subscriptions:read');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const today = todayInTimeZone(ctx.timezone);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const row = await findVisit(tx, ctx, visitId);
    if (!row) return null;
    const plants = await plantCounts(tx, ctx.tenantId, [row.subscriptionId]);
    return toAgendaVisit(ctx, row, plants, today);
  });
  if (!found) return notFound(ctx, 'CareVisit', visitId);
  return found;
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
    if (compareDates(from, until) > 0) return { visit, options: [], freeTime: row.isExtra };
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
    return { visit, options, freeTime: row.isExtra };
  });
  if (!found) return notFound(ctx, 'CareVisit', visitId);
  return found;
}

// -----------------------------------------------------------------------------
// Azioni sulla visita
// -----------------------------------------------------------------------------

/**
 * Sposta una visita (anche una "Por reprogramar") a un giorno e una fascia con posto, fino a 90
 * giorni da oggi e dentro il contratto. Una visita extra può andare anche a un'ora libera, che non
 * tocca i posti (ADR-078). Senza "Sí, avisé al cliente" non si salva.
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
    // Ordine dei blocchi: contratto, fasce, visita (care-booking.ts). Un'ora libera non ha fasce.
    const first = await tx.careVisit.findFirst({
      where: { tenantId: ctx.tenantId, id: visitId },
      select: { subscriptionId: true },
    });
    if (!first) return false;
    await lockSubscription(tx, ctx.tenantId, first.subscriptionId);
    // Anche per un'ora libera: le fasce bloccate tengono fermi i blocchi di giorni (ADR-083).
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
    const current = dateToParts(visit.scheduledDate);
    const sameDay =
      visit.status === 'SCHEDULED' && current && compareDates(current, input.date) === 0;
    let target: { slotId: string | null; startMinutes: number; endMinutes: number };
    if (input.placement === 'TIME') {
      // Solo le visite extra hanno l'ora libera: le altre stanno negli orari di visita.
      if (!visit.isExtra) throw new ValidationError({ placement: 'invalid_option' });
      if (book.dayBlock(input.date)) throw new ValidationError({ date: 'care_day_blocked' });
      if (
        sameDay &&
        visit.slotId === null &&
        visit.startMinutes === input.startMinutes &&
        visit.endMinutes === input.endMinutes
      ) {
        return true;
      }
      target = { slotId: null, startMinutes: input.startMinutes, endMinutes: input.endMinutes };
    } else {
      const slot = book.slot(input.slotId);
      if (!slot?.active) throw new ValidationError({ slotId: 'invalid_option' });
      if (slot.weekday !== dayOfWeek(input.date)) {
        throw new ValidationError({ slotId: 'care_slot_weekday' });
      }
      if (sameDay && visit.slotId === slot.id) return true;
      if (book.blockFor(slot.id, input.date)) {
        throw new ValidationError({ slotId: 'care_day_blocked' });
      }
      if (book.free(slot.id, input.date) < visit.seats) throw new ConflictError('care_slot_full');
      target = { slotId: slot.id, startMinutes: slot.startMinutes, endMinutes: slot.endMinutes };
    }
    if (!input.customerNotified) {
      throw new ValidationError({ customerNotified: 'care_notice_required' });
    }
    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: { status: 'SCHEDULED', scheduledDate: dbDate(input.date), ...target },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careVisitMoved,
      entityType: 'CareVisit',
      entityId: visit.id,
      metadata: {
        number: formatSubscriptionNumber(visit.subscription.number),
        from: current ? toIsoDate(current) : null,
        to: toIsoDate(input.date),
        slotId: target.slotId,
        ...(target.slotId === null
          ? {
              start: formatTimeOfDay(target.startMinutes),
              end: formatTimeOfDay(target.endMinutes),
            }
          : {}),
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
    // Il cliente: si paga solo con meno preavviso del limite del contratto (decisione del founder
    // del 24/11), salvo "No cobrar esta vez". Una visita extra si cobra solo se fatta (ADR-082).
    const late =
      input.reason === 'CUSTOMER' && !visit.isExtra
        ? careCancellationCharged({
            visitStart: careVisitStartAt(
              dateToParts(visit.scheduledDate),
              visit.startMinutes,
              ctx.timezone,
            ),
            lateCancelHours:
              visit.subscription.lateCancelHours ?? CARE_CHARGE_LIMITS.lateCancelHoursDefault,
            now: new Date(),
          })
        : false;
    const cancelCharged = input.reason === 'CUSTOMER' ? late && !input.noCharge : null;
    await tx.careVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        status: 'CANCELLED',
        cancelReason: input.reason,
        cancelCharged,
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
        ...(cancelCharged === null
          ? {}
          : { charged: cancelCharged, waived: late && !cancelCharged }),
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
