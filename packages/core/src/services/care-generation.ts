/**
 * Visite dei contratti di Floral Care (ADR-075):
 *  - si creano per i prossimi 60 giorni alla conferma, e la manutenzione le allunga;
 *  - si cancellano (restando come righe) quando cambia il calendario o finisce il contratto;
 *  - si spostano quando una fascia cambia capienza, orario o si archivia.
 * Ogni posto passa da `SlotBook` (care-booking.ts). Funzioni interne, non esportate da
 * `@floral/core`: girano nella transazione di chi chiama (un membro o un lavoro, `WriteScope`).
 */
import type { Prisma, TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_LIMITS,
  CARE_VISIT_HOLDING_STATUSES,
  addDays,
  careVisitDates,
  compareDates,
  dayOfWeek,
  formatSubscriptionNumber,
  isWeekday,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
  type CareVisitCancelReason,
  type Weekday,
} from '@floral/domain';
import {
  recordScopeAudit,
  scopeTenantId,
  scopeTimezone,
  scopeUserId,
  type WriteScope,
} from '../scope';
import { lockCareSlots, openSlotBook, type SlotBook } from './care-booking';
import { dbDate, laterDate, lockSubscription, requiredParts } from './care-internals';
import { dateToParts } from './quote-internals';

export interface CareGenerationResult {
  /** Visite create con giorno e fascia. */
  readonly scheduled: number;
  /** Visite create senza posto nel mese: "Por reprogramar". */
  readonly toReschedule: number;
}

const NOTHING: CareGenerationResult = { scheduled: 0, toReschedule: 0 };

/** I giorni in cui ogni contratto ha già una visita che occupa un posto (per non metterne due). */
async function busyDays(
  tx: TransactionClient,
  tenantId: string,
  subscriptionIds: readonly string[],
  range: { readonly from: CalendarDate; readonly until: CalendarDate },
): Promise<Map<string, Set<string>>> {
  const rows = await tx.careVisit.findMany({
    where: {
      tenantId,
      subscriptionId: { in: [...subscriptionIds] },
      status: { in: [...CARE_VISIT_HOLDING_STATUSES] },
      scheduledDate: { gte: dbDate(addDays(range.from, -7)), lte: dbDate(addDays(range.until, 7)) },
    },
    select: { subscriptionId: true, scheduledDate: true },
  });
  const days = new Map<string, Set<string>>();
  for (const row of rows) {
    const date = dateToParts(row.scheduledDate);
    if (!date) continue;
    const set = days.get(row.subscriptionId) ?? new Set<string>();
    set.add(toIsoDate(date));
    days.set(row.subscriptionId, set);
  }
  return days;
}

/**
 * Crea le visite del contratto fino a 60 giorni da oggi (o fino all'ultimo giorno del contratto),
 * dal giorno dopo l'ultima già creata. Ogni data va nella sua fascia; se è piena, `SlotBook.place`
 * cerca un altro posto nella stessa settimana e nello stesso mese, altrimenti la visita nasce "Por
 * reprogramar". Idempotente: una visita è unica per contratto, versione e data originale.
 */
export async function extendCareVisitsTx(
  tx: TransactionClient,
  scope: WriteScope,
  subscriptionId: string,
): Promise<CareGenerationResult> {
  const tenantId = scopeTenantId(scope);
  if (!(await lockSubscription(tx, tenantId, subscriptionId))) return NOTHING;
  const subscription = await tx.customerSubscription.findFirst({
    where: { tenantId, id: subscriptionId },
    select: {
      id: true,
      number: true,
      kind: true,
      status: true,
      frequency: true,
      seats: true,
      startDate: true,
      endDate: true,
      scheduleVersion: true,
      generatedUntil: true,
      slots: { select: { slot: { select: { id: true, weekday: true } } } },
    },
  });
  if (
    !subscription ||
    subscription.kind !== 'CARE' ||
    subscription.status !== 'ACTIVE' ||
    !subscription.frequency
  ) {
    return NOTHING;
  }

  const today = todayInTimeZone(scopeTimezone(scope));
  const horizon = addDays(today, CARE_LIMITS.generationDays);
  const start = requiredParts(subscription.startDate);
  const end = dateToParts(subscription.endDate);
  const generated = dateToParts(subscription.generatedUntil);
  let from = laterDate(start, today);
  if (generated) from = laterDate(from, addDays(generated, 1));
  const until = end && compareDates(end, horizon) < 0 ? end : horizon;
  if (compareDates(from, until) > 0) {
    // Niente da creare (inizio oltre l'orizzonte, o contratto già coperto fino alla fine): si
    // segna fin dove si è guardato, così la manutenzione non lo riprende ogni giorno.
    if (!generated || compareDates(generated, until) < 0) {
      await tx.customerSubscription.update({
        where: { id: subscriptionId, tenantId },
        data: { generatedUntil: dbDate(until) },
      });
    }
    return NOTHING;
  }

  // Il giorno della settimana di ogni fascia scelta: la fascia preferita delle sue visite.
  const slotByWeekday = new Map<Weekday, string>();
  for (const link of subscription.slots) {
    if (isWeekday(link.slot.weekday)) slotByWeekday.set(link.slot.weekday, link.slot.id);
  }
  const dates = careVisitDates({
    frequency: subscription.frequency,
    weekdays: [...slotByWeekday.keys()].sort((a, b) => a - b),
    from,
    until,
  });

  const existing = await tx.careVisit.findMany({
    where: {
      tenantId,
      subscriptionId,
      scheduleVersion: subscription.scheduleVersion,
      isExtra: false,
      originalDate: { gte: dbDate(from), lte: dbDate(until) },
    },
    select: { originalDate: true },
  });
  const done = new Set(existing.map((row) => toIsoDate(requiredParts(row.originalDate))));
  const pending = dates.filter((date) => !done.has(toIsoDate(date)));

  let scheduled = 0;
  let toReschedule = 0;
  if (pending.length > 0) {
    const book = await openSlotBook(tx, tenantId, { from, until });
    const avoid =
      (await busyDays(tx, tenantId, [subscriptionId], { from, until })).get(subscriptionId) ??
      new Set<string>();
    const rows: Prisma.CareVisitCreateManyInput[] = [];
    for (const date of pending) {
      const placement = book.place({
        date,
        preferredSlotId: slotByWeekday.get(dayOfWeek(date) as Weekday) ?? null,
        seats: subscription.seats,
        bounds: { from, until: end, avoid },
      });
      const base = {
        tenantId,
        subscriptionId,
        scheduleVersion: subscription.scheduleVersion,
        originalDate: dbDate(date),
        seats: subscription.seats,
        createdById: scopeUserId(scope),
      };
      if (placement) {
        book.take(placement.slot.id, placement.date, subscription.seats);
        avoid.add(toIsoDate(placement.date));
        scheduled += 1;
        rows.push({
          ...base,
          status: 'SCHEDULED',
          scheduledDate: dbDate(placement.date),
          slotId: placement.slot.id,
          startMinutes: placement.slot.startMinutes,
          endMinutes: placement.slot.endMinutes,
        });
      } else {
        toReschedule += 1;
        rows.push({ ...base, status: 'TO_RESCHEDULE' });
      }
    }
    await tx.careVisit.createMany({ data: rows });
  }

  await tx.customerSubscription.update({
    where: { id: subscriptionId, tenantId },
    data: { generatedUntil: dbDate(until) },
  });
  if (scheduled + toReschedule > 0) {
    await recordScopeAudit(tx, scope, {
      action: AUDIT_ACTIONS.careVisitsGenerated,
      entityType: 'CustomerSubscription',
      entityId: subscriptionId,
      metadata: {
        number: formatSubscriptionNumber(subscription.number),
        from: toIsoDate(from),
        until: toIsoDate(until),
        scheduled,
        toReschedule,
      },
    });
  }
  return { scheduled, toReschedule };
}

/**
 * Cancella le visite che rispondono a `where` (solo quelle ancora da fare), con il motivo. Le righe
 * restano: i cargos (blocco 3) sapranno chi ha tolto ogni visita. Restituisce quante.
 */
export async function cancelOpenVisitsTx(
  tx: TransactionClient,
  scope: WriteScope,
  where: Prisma.CareVisitWhereInput,
  reason: CareVisitCancelReason,
): Promise<number> {
  const result = await tx.careVisit.updateMany({
    where: {
      AND: [where, { tenantId: scopeTenantId(scope) }],
      status: { in: ['SCHEDULED', 'TO_RESCHEDULE'] },
    },
    data: { status: 'CANCELLED', cancelReason: reason, closedById: scopeUserId(scope) },
  });
  return result.count;
}

export interface SlotVisitRow {
  readonly id: string;
  readonly subscriptionId: string;
  readonly status: string;
  readonly scheduledDate: Date | null;
  readonly startMinutes: number | null;
  readonly endMinutes: number | null;
  readonly seats: number;
  readonly createdAt: Date;
}

/** Le visite di oggi in poi che occupano un posto in una fascia (in ordine di giorno e di arrivo). */
export async function loadSlotVisits(
  tx: TransactionClient,
  tenantId: string,
  slotId: string,
  today: CalendarDate,
): Promise<SlotVisitRow[]> {
  return tx.careVisit.findMany({
    where: {
      tenantId,
      slotId,
      status: { in: [...CARE_VISIT_HOLDING_STATUSES] },
      scheduledDate: { gte: dbDate(today) },
    },
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      subscriptionId: true,
      status: true,
      scheduledDate: true,
      startMinutes: true,
      endMinutes: true,
      seats: true,
      createdAt: true,
    },
  });
}

export interface SlotChangePlan {
  /** Visite programmate che restano nella fascia. */
  readonly keep: readonly SlotVisitRow[];
  /** Visite programmate che non ci stanno più e vanno spostate. */
  readonly move: readonly SlotVisitRow[];
}

/**
 * Chi resta e chi si sposta dopo un cambio di fascia: con la fascia archiviata (`capacity` null) si
 * spostano tutte le programmate; altrimenti, giorno per giorno, restano le visite già in corso o
 * chiuse e poi le programmate nell'ordine in cui sono state prese, finché c'è posto.
 */
export function planSlotChange(
  visits: readonly SlotVisitRow[],
  capacity: number | null,
): SlotChangePlan {
  const keep: SlotVisitRow[] = [];
  const move: SlotVisitRow[] = [];
  const byDay = new Map<string, SlotVisitRow[]>();
  for (const visit of visits) {
    const day = visit.scheduledDate?.toISOString().slice(0, 10) ?? '';
    byDay.set(day, [...(byDay.get(day) ?? []), visit]);
  }
  for (const dayVisits of byDay.values()) {
    const fixed = dayVisits.filter((visit) => visit.status !== 'SCHEDULED');
    let used = fixed.reduce((total, visit) => total + visit.seats, 0);
    for (const visit of dayVisits) {
      if (visit.status !== 'SCHEDULED') continue;
      if (capacity !== null && used + visit.seats <= capacity) {
        used += visit.seats;
        keep.push(visit);
      } else {
        move.push(visit);
      }
    }
  }
  return { keep, move };
}

export interface RebookResult {
  readonly moved: number;
  readonly toReschedule: number;
  /** Visite rimaste nella fascia con l'orario nuovo. */
  readonly retimed: number;
}

/**
 * Applica il piano dopo che la fascia è già stata salvata: le visite che restano prendono l'orario
 * nuovo; quelle da spostare cercano posto (stesso giorno, poi la settimana, nello stesso mese, mai
 * prima di oggi né fuori dal contratto) o diventano "Por reprogramar". Ogni aggiornamento vale solo
 * se la visita è ancora programmata (un "Hecha" arrivato nel frattempo vince).
 */
export async function applySlotChangeTx(
  tx: TransactionClient,
  scope: WriteScope,
  input: {
    readonly slotId: string;
    readonly plan: SlotChangePlan;
    readonly today: CalendarDate;
  },
): Promise<RebookResult> {
  const tenantId = scopeTenantId(scope);
  const { plan, today } = input;
  const all = [...plan.keep, ...plan.move];
  if (all.length === 0) return { moved: 0, toReschedule: 0, retimed: 0 };
  const lastDay = all.reduce(
    (latest, visit) => laterDate(latest, requiredParts(visit.scheduledDate ?? new Date(0))),
    today,
  );
  const book: SlotBook = await openSlotBook(tx, tenantId, { from: today, until: lastDay });
  const slot = book.slot(input.slotId);

  let retimed = 0;
  for (const visit of plan.keep) {
    if (
      !slot ||
      (visit.startMinutes === slot.startMinutes && visit.endMinutes === slot.endMinutes)
    ) {
      continue;
    }
    const updated = await tx.careVisit.updateMany({
      where: { id: visit.id, tenantId, status: 'SCHEDULED', slotId: input.slotId },
      data: { startMinutes: slot.startMinutes, endMinutes: slot.endMinutes },
    });
    retimed += updated.count;
  }

  let moved = 0;
  let toReschedule = 0;
  if (plan.move.length > 0) {
    const subscriptionIds = [...new Set(plan.move.map((visit) => visit.subscriptionId))];
    const contracts = await tx.customerSubscription.findMany({
      where: { tenantId, id: { in: subscriptionIds } },
      select: { id: true, startDate: true, endDate: true },
    });
    const bounds = new Map(contracts.map((contract) => [contract.id, contract]));
    const busy = await busyDays(tx, tenantId, subscriptionIds, { from: today, until: lastDay });
    for (const visit of plan.move) {
      const date = requiredParts(visit.scheduledDate ?? new Date(0));
      const contract = bounds.get(visit.subscriptionId);
      const avoid = busy.get(visit.subscriptionId) ?? new Set<string>();
      avoid.delete(toIsoDate(date));
      book.release(input.slotId, date, visit.seats);
      const placement = book.place({
        date,
        preferredSlotId: input.slotId,
        seats: visit.seats,
        bounds: {
          from: contract ? laterDate(today, requiredParts(contract.startDate)) : today,
          until: contract ? dateToParts(contract.endDate) : null,
          avoid,
        },
      });
      const data: Prisma.CareVisitUncheckedUpdateManyInput = placement
        ? {
            scheduledDate: dbDate(placement.date),
            slotId: placement.slot.id,
            startMinutes: placement.slot.startMinutes,
            endMinutes: placement.slot.endMinutes,
          }
        : {
            status: 'TO_RESCHEDULE',
            scheduledDate: null,
            slotId: null,
            startMinutes: null,
            endMinutes: null,
          };
      const updated = await tx.careVisit.updateMany({
        where: { id: visit.id, tenantId, status: 'SCHEDULED' },
        data,
      });
      if (updated.count === 0) {
        book.take(input.slotId, date, visit.seats);
        avoid.add(toIsoDate(date));
        continue;
      }
      if (placement) {
        book.take(placement.slot.id, placement.date, visit.seats);
        avoid.add(toIsoDate(placement.date));
        moved += 1;
      } else {
        toReschedule += 1;
      }
      busy.set(visit.subscriptionId, avoid);
    }
  }
  return { moved, toReschedule, retimed };
}

/**
 * Chiude un contratto il cui ultimo giorno è passato (manutenzione): le visite ancora da fare dopo
 * quel giorno e quelle mai riprogrammate si cancellano, il contratto diventa ENDED. Idempotente.
 */
export async function closeEndedCareContractTx(
  tx: TransactionClient,
  scope: WriteScope,
  subscriptionId: string,
): Promise<boolean> {
  const tenantId = scopeTenantId(scope);
  if (!(await lockSubscription(tx, tenantId, subscriptionId))) return false;
  await lockCareSlots(tx, tenantId);
  const subscription = await tx.customerSubscription.findFirst({
    where: { tenantId, id: subscriptionId, kind: 'CARE' },
    select: { id: true, number: true, status: true, endDate: true },
  });
  const end = dateToParts(subscription?.endDate ?? null);
  const today = todayInTimeZone(scopeTimezone(scope));
  if (
    !subscription ||
    !end ||
    (subscription.status !== 'ACTIVE' && subscription.status !== 'PAUSED') ||
    compareDates(end, today) >= 0
  ) {
    return false;
  }
  const cancelled = await cancelOpenVisitsTx(
    tx,
    scope,
    {
      subscriptionId,
      OR: [
        { status: 'SCHEDULED', scheduledDate: { gt: dbDate(end) } },
        { status: 'TO_RESCHEDULE' },
      ],
    },
    'CONTRACT_END',
  );
  await tx.customerSubscription.update({
    where: { id: subscriptionId, tenantId },
    data: { status: 'ENDED', endedAt: new Date() },
  });
  await recordScopeAudit(tx, scope, {
    action: AUDIT_ACTIONS.subscriptionEnded,
    entityType: 'CustomerSubscription',
    entityId: subscriptionId,
    metadata: {
      number: formatSubscriptionNumber(subscription.number),
      endDate: toIsoDate(end),
      ended: true,
      cancelled,
    },
  });
  return true;
}
