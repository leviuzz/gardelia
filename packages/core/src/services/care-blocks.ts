/**
 * Floral Care, blocco 4 (ADR-083): giorni bloccati, vacanze e cambi di massa.
 *
 *  - "Bloquear días" (chi gestisce): dal–al, tutte le fasce o una, con un nome e cosa fare delle
 *    visite già fissate: «Mover» al giorno libero più vicino dello stesso mese (da domani; senza
 *    posto, "Por reprogramar") oppure «Cancelar», come se le togliesse la fioreria (credito nel
 *    cargo dopo, ADR-082). Le visite che nasceranno in quei giorni seguono la stessa scelta
 *    (`extendCareVisitsTx`) e nessuna prenotazione entra più in un giorno bloccato (`SlotBook`).
 *  - L'anteprima elenca le visite toccate, contratto per contratto, con dove vanno. Il salvataggio
 *    rifà lo stesso piano con le fasce bloccate e, se è cambiato nel frattempo (un posto preso, una
 *    fascia cambiata), chiede di rivederlo (`care_block_changed`): ai clienti si dicono le date
 *    giuste. Con visite toccate serve "Sí, avisé al cliente"; l'email è facoltativa, una per
 *    contratto, nella tabella d'uscita di Floral Care.
 *  - Ordine dei blocchi come chi cambia le visite di un contratto (care-booking.ts): i contratti
 *    toccati in ordine di id, poi le fasce, poi le visite in ordine di id. Le righe nuove puntano ai
 *    contratti (chiave esterna): senza tenerli bloccati, uno spostamento che ha il contratto e
 *    aspetta le fasce si fermerebbe con noi. Le email partono dopo il commit con un tetto di
 *    tempo; quelle che restano le manda il lavoro giornaliero.
 *  - "Quitar": il blocco non vale più; le visite già spostate restano dove sono.
 *  - "Alguien no puede ir": le visite di una persona in quei giorni passano a un'altra (o a
 *    nessuno). Cambia solo la persona: niente avviso al cliente (decisione del founder del 24/11).
 */
import { getDb, Prisma, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_BLOCK_LIMITS,
  CARE_EMAIL_RETRY,
  addDays,
  careBlockConfirmSchema,
  careBlockPlanFingerprint,
  careBlockSchema,
  careEmailsAllowed,
  careReassignSchema,
  careReportRecipient,
  compareDates,
  daysBetween,
  daysInMonth,
  formatSubscriptionNumber,
  formatTimeOfDay,
  isUuid,
  toFieldErrors,
  todayInTimeZone,
  toIsoDate,
  upcomingCarePeakDays,
  type CalendarDate,
  type CareBlockAction,
  type CareBlockInput,
  type CareBlockOutcome,
  type CareEmailStatus,
  type CarePeakDayKey,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { requireEntitlement } from './billing';
import { lockCareSlots, openSlotBook, type SlotBook } from './care-booking';
import { busyDays } from './care-generation';
import { dbDate, isoOf, laterDate, requiredParts } from './care-internals';
import { deliverCareEmail, deliverCareEmailsWithin, type CareMailDeps } from './care-visit-work';
import { dateToParts } from './quote-internals';

// -----------------------------------------------------------------------------
// DTO
// -----------------------------------------------------------------------------

export interface CareBlockSlotDto {
  readonly id: string;
  readonly weekday: number;
  readonly start: string;
  readonly end: string;
}

export interface CareBlockWhenDto {
  readonly date: string;
  readonly start: string | null;
  readonly end: string | null;
}

export interface CareBlockChangeDto {
  readonly visitId: string;
  readonly isExtra: boolean;
  readonly outcome: CareBlockOutcome;
  readonly from: CareBlockWhenDto;
  /** Solo per MOVED. */
  readonly to: CareBlockWhenDto | null;
}

/** Le visite toccate di un contratto: il cliente, la sede e, nella pagina del blocco, l'avviso. */
export interface CareBlockContractDto {
  readonly subscriptionId: string;
  readonly numberLabel: string;
  readonly customerName: string;
  /** Il cliente ha un'email: può ricevere l'avviso. */
  readonly hasEmail: boolean;
  readonly changes: readonly CareBlockChangeDto[];
  /** Solo nella pagina del blocco: l'avviso per email di questo contratto, se c'è. */
  readonly email: {
    readonly status: CareEmailStatus;
    /** Si può (ri)mandare adesso: in coda o fallito, con tentativi rimasti. */
    readonly retryable: boolean;
  } | null;
}

export interface CareBlockCounts {
  readonly moved: number;
  readonly toReschedule: number;
  readonly cancelled: number;
}

export interface CareBlockSummaryDto {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  /** null = tutto il giorno. */
  readonly slot: CareBlockSlotDto | null;
  readonly label: string;
  readonly action: CareBlockAction;
  /** Visite spostate o cancellate quando è nato. */
  readonly changes: number;
  readonly removedAt: string | null;
}

export interface CareBlockPreviewDto {
  readonly startDate: string;
  readonly endDate: string;
  readonly slot: CareBlockSlotDto | null;
  readonly label: string;
  readonly action: CareBlockAction;
  readonly contracts: readonly CareBlockContractDto[];
  readonly counts: CareBlockCounts;
  /** Impronta del piano: il salvataggio la confronta (`care_block_changed`). */
  readonly plan: string;
  /** La fioreria può mandare email ai clienti (attiva e non demo). */
  readonly emailsAllowed: boolean;
  /** Blocchi attivi negli stessi giorni: per non farne due uguali. */
  readonly overlapping: readonly CareBlockSummaryDto[];
}

export interface CareBlockDetailDto extends CareBlockSummaryDto {
  readonly contracts: readonly CareBlockContractDto[];
  readonly counts: CareBlockCounts;
  readonly createdAt: string;
  readonly emailsAllowed: boolean;
  /** Chi guarda può togliere il blocco e mandare gli avvisi. */
  readonly canWrite: boolean;
}

export interface CarePeakDaySuggestionDto {
  readonly key: CarePeakDayKey;
  readonly startDate: string;
  readonly endDate: string;
}

export interface CareBlocksDto {
  /** Attivi da oggi in poi, in ordine di data. */
  readonly current: readonly CareBlockSummaryDto[];
  /** Gli ultimi passati o tolti. */
  readonly past: readonly CareBlockSummaryDto[];
  /** Giorni di punta proposti (ADR-083), non ancora bloccati per tutto il giorno. */
  readonly peakDays: readonly CarePeakDaySuggestionDto[];
  /** Le fasce attive, per il modulo. */
  readonly slots: readonly CareBlockSlotDto[];
  readonly canWrite: boolean;
}

export interface CareBlockCreateResult {
  readonly blockId: string;
  readonly counts: CareBlockCounts;
  /** Avvisi messi in coda (uno per contratto con email) e quanti sono già partiti. */
  readonly emails: { readonly queued: number; readonly sent: number };
}

// -----------------------------------------------------------------------------
// Parti comuni
// -----------------------------------------------------------------------------

const PAST_LIMIT = 10;

const blockSelect = {
  id: true,
  startDate: true,
  endDate: true,
  slotId: true,
  label: true,
  action: true,
  removedAt: true,
  createdAt: true,
  slot: { select: { id: true, weekday: true, startMinutes: true, endMinutes: true } },
  _count: { select: { changes: true } },
} satisfies Prisma.CareBlockSelect;

type BlockRow = Prisma.CareBlockGetPayload<{ select: typeof blockSelect }>;

function slotDto(slot: {
  readonly id: string;
  readonly weekday: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
}): CareBlockSlotDto {
  return {
    id: slot.id,
    weekday: slot.weekday,
    start: formatTimeOfDay(slot.startMinutes),
    end: formatTimeOfDay(slot.endMinutes),
  };
}

function toSummary(row: BlockRow): CareBlockSummaryDto {
  return {
    id: row.id,
    startDate: isoOf(row.startDate) ?? '',
    endDate: isoOf(row.endDate) ?? '',
    slot: row.slot ? slotDto(row.slot) : null,
    label: row.label,
    action: row.action,
    changes: row._count.changes,
    removedAt: row.removedAt ? row.removedAt.toISOString() : null,
  };
}

/** Un blocco comincia da oggi ed entro un anno (la lunghezza la controlla lo schema). */
function checkWindow(input: CareBlockInput, today: CalendarDate): void {
  if (compareDates(input.startDate, today) < 0) {
    throw new ValidationError({ startDate: 'care_block_past' });
  }
  if (daysBetween(today, input.startDate) > CARE_BLOCK_LIMITS.horizonDays) {
    throw new ValidationError({ startDate: 'care_block_too_far' });
  }
}

function firstOfMonth(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: 1 };
}

function lastOfMonth(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: daysInMonth(date.year, date.month) };
}

/**
 * Il libro delle fasce sui mesi del blocco (dove le visite possono andare), con le fasce
 * bloccate se `lock` (il salvataggio) e il blocco nuovo aggiunto in memoria.
 */
async function openBlockBook(
  tx: TransactionClient,
  ctx: TenantContext,
  input: CareBlockInput,
  lock: boolean,
): Promise<SlotBook> {
  const book = await openSlotBook(
    tx,
    ctx.tenantId,
    { from: firstOfMonth(input.startDate), until: lastOfMonth(input.endDate) },
    { lock },
  );
  if (input.slotId) {
    const slot = book.slot(input.slotId);
    if (!slot?.active) throw new ValidationError({ slotId: 'invalid_option' });
  }
  return book;
}

const affectedSelect = {
  id: true,
  subscriptionId: true,
  scheduledDate: true,
  slotId: true,
  startMinutes: true,
  endMinutes: true,
  seats: true,
  isExtra: true,
  subscription: {
    select: {
      number: true,
      startDate: true,
      endDate: true,
      customer: { select: { displayName: true, email: true } },
    },
  },
} satisfies Prisma.CareVisitSelect;

type AffectedVisit = Prisma.CareVisitGetPayload<{ select: typeof affectedSelect }>;

/**
 * Le visite programmate nei giorni del blocco (della sua fascia, o tutte con un blocco di tutto il
 * giorno, anche quelle a un'ora libera), in ordine di giorno e di ora. Con `lock` le blocca in
 * ordine di id, come gli altri cambi di massa.
 */
async function loadAffected(
  tx: TransactionClient,
  ctx: TenantContext,
  input: CareBlockInput,
  lock: boolean,
): Promise<AffectedVisit[]> {
  const from = toIsoDate(input.startDate);
  const until = toIsoDate(input.endDate);
  if (lock) {
    await tx.$queryRaw`SELECT "id" FROM "CareVisit"
      WHERE "tenantId" = ${ctx.tenantId}::uuid
        AND "status" = 'SCHEDULED'
        AND "scheduledDate" BETWEEN ${from}::date AND ${until}::date
        ${input.slotId ? Prisma.sql`AND "slotId" = ${input.slotId}::uuid` : Prisma.empty}
      ORDER BY "id"
      FOR UPDATE`;
  }
  return tx.careVisit.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: 'SCHEDULED',
      scheduledDate: { gte: dbDate(input.startDate), lte: dbDate(input.endDate) },
      ...(input.slotId ? { slotId: input.slotId } : {}),
    },
    orderBy: [
      { scheduledDate: 'asc' },
      { startMinutes: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: affectedSelect,
  });
}

/** Blocca i contratti indicati, in ordine di id, fino alla fine della transazione. */
async function lockContracts(
  tx: TransactionClient,
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const list = Prisma.join([...ids].sort().map((id) => Prisma.sql`${id}::uuid`));
  await tx.$queryRaw`SELECT "id" FROM "CustomerSubscription"
    WHERE "tenantId" = ${tenantId}::uuid AND "id" IN (${list})
    ORDER BY "id"
    FOR UPDATE`;
}

interface PlannedChange {
  readonly visit: AffectedVisit;
  readonly outcome: CareBlockOutcome;
  readonly to: {
    readonly date: CalendarDate;
    readonly slotId: string;
    readonly startMinutes: number;
    readonly endMinutes: number;
  } | null;
}

/**
 * Dove va ogni visita toccata: con «Cancelar» tutte cancellate; con «Mover» il giorno libero più
 * vicino dello stesso mese (da domani, dentro il contratto, mai due visite dello stesso contratto
 * lo stesso giorno), altrimenti "Por reprogramar". Una visita extra a un'ora libera non ha fascia:
 * resta da riprogrammare a mano. Il libro deve già avere il blocco nuovo.
 */
async function planChanges(
  tx: TransactionClient,
  ctx: TenantContext,
  input: CareBlockInput,
  visits: readonly AffectedVisit[],
  book: SlotBook,
  today: CalendarDate,
): Promise<PlannedChange[]> {
  if (input.action === 'CANCEL') {
    return visits.map((visit) => ({ visit, outcome: 'CANCELLED', to: null }));
  }
  const tomorrow = addDays(today, 1);
  const busy = await busyDays(
    tx,
    ctx.tenantId,
    [...new Set(visits.map((visit) => visit.subscriptionId))],
    { from: firstOfMonth(input.startDate), until: lastOfMonth(input.endDate) },
  );
  const changes: PlannedChange[] = [];
  for (const visit of visits) {
    const date = requiredParts(visit.scheduledDate ?? new Date(0));
    if (visit.slotId === null) {
      changes.push({ visit, outcome: 'TO_RESCHEDULE', to: null });
      continue;
    }
    book.release(visit.slotId, date, visit.seats);
    const avoid = busy.get(visit.subscriptionId) ?? new Set<string>();
    avoid.delete(toIsoDate(date));
    const placement = book.placeInMonth({
      date,
      preferredSlotId: visit.slotId,
      seats: visit.seats,
      bounds: {
        from: laterDate(tomorrow, requiredParts(visit.subscription.startDate)),
        until: dateToParts(visit.subscription.endDate),
        avoid,
      },
    });
    if (!placement) {
      changes.push({ visit, outcome: 'TO_RESCHEDULE', to: null });
      busy.set(visit.subscriptionId, avoid);
      continue;
    }
    book.take(placement.slot.id, placement.date, visit.seats);
    avoid.add(toIsoDate(placement.date));
    busy.set(visit.subscriptionId, avoid);
    changes.push({
      visit,
      outcome: 'MOVED',
      to: {
        date: placement.date,
        slotId: placement.slot.id,
        startMinutes: placement.slot.startMinutes,
        endMinutes: placement.slot.endMinutes,
      },
    });
  }
  return changes;
}

function fingerprintOf(changes: readonly PlannedChange[]): string {
  return careBlockPlanFingerprint(
    changes.map((change) => ({
      visitId: change.visit.id,
      outcome: change.outcome,
      toDate: change.to ? toIsoDate(change.to.date) : null,
      toSlotId: change.to?.slotId ?? null,
    })),
  );
}

function countsOf(changes: readonly { readonly outcome: CareBlockOutcome }[]): CareBlockCounts {
  return {
    moved: changes.filter((change) => change.outcome === 'MOVED').length,
    toReschedule: changes.filter((change) => change.outcome === 'TO_RESCHEDULE').length,
    cancelled: changes.filter((change) => change.outcome === 'CANCELLED').length,
  };
}

function time(minutes: number | null): string | null {
  return minutes === null ? null : formatTimeOfDay(minutes);
}

/** Le visite toccate raggruppate per contratto, in ordine di cliente. */
function groupByContract(
  changes: readonly (CareBlockChangeDto & {
    readonly subscriptionId: string;
    readonly number: number;
    readonly customerName: string;
    readonly customerEmail: string | null;
  })[],
  emails: ReadonlyMap<string, CareBlockContractDto['email']> = new Map(),
): CareBlockContractDto[] {
  const groups = new Map<string, CareBlockContractDto & { changes: CareBlockChangeDto[] }>();
  for (const change of changes) {
    let group = groups.get(change.subscriptionId);
    if (!group) {
      group = {
        subscriptionId: change.subscriptionId,
        numberLabel: formatSubscriptionNumber(change.number),
        customerName: change.customerName,
        hasEmail:
          careReportRecipient({
            requested: true,
            allowed: true,
            customerEmail: change.customerEmail,
          }) !== null,
        changes: [],
        email: emails.get(change.subscriptionId) ?? null,
      };
      groups.set(change.subscriptionId, group);
    }
    group.changes.push({
      visitId: change.visitId,
      isExtra: change.isExtra,
      outcome: change.outcome,
      from: change.from,
      to: change.to,
    });
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.customerName.localeCompare(b.customerName, 'es') ||
      a.numberLabel.localeCompare(b.numberLabel),
  );
}

function plannedToDto(change: PlannedChange) {
  const date = requiredParts(change.visit.scheduledDate ?? new Date(0));
  return {
    subscriptionId: change.visit.subscriptionId,
    number: change.visit.subscription.number,
    customerName: change.visit.subscription.customer.displayName,
    customerEmail: change.visit.subscription.customer.email,
    visitId: change.visit.id,
    isExtra: change.visit.isExtra,
    outcome: change.outcome,
    from: {
      date: toIsoDate(date),
      start: time(change.visit.startMinutes),
      end: time(change.visit.endMinutes),
    },
    to: change.to
      ? {
          date: toIsoDate(change.to.date),
          start: formatTimeOfDay(change.to.startMinutes),
          end: formatTimeOfDay(change.to.endMinutes),
        }
      : null,
  };
}

async function overlappingBlocks(
  tx: TransactionClient,
  ctx: TenantContext,
  input: CareBlockInput,
): Promise<CareBlockSummaryDto[]> {
  const rows = await tx.careBlock.findMany({
    where: {
      tenantId: ctx.tenantId,
      removedAt: null,
      startDate: { lte: dbDate(input.endDate) },
      endDate: { gte: dbDate(input.startDate) },
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    select: blockSelect,
  });
  return rows.map(toSummary);
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

/** Agenda → Bloqueos: i blocchi di oggi in poi, gli ultimi passati, i giorni di punta proposti. */
export async function listCareBlocks(ctx: TenantContext): Promise<CareBlocksDto> {
  requirePermission(ctx, 'subscriptions:read');
  const today = todayInTimeZone(ctx.timezone);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const [current, past, slots] = await Promise.all([
      tx.careBlock.findMany({
        where: { tenantId: ctx.tenantId, removedAt: null, endDate: { gte: dbDate(today) } },
        orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
        select: blockSelect,
      }),
      tx.careBlock.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [{ removedAt: { not: null } }, { endDate: { lt: dbDate(today) } }],
        },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        take: PAST_LIMIT,
        select: blockSelect,
      }),
      tx.careSlot.findMany({
        where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
        orderBy: [{ weekday: 'asc' }, { startMinutes: 'asc' }],
        select: { id: true, weekday: true, startMinutes: true, endMinutes: true },
      }),
    ]);
    return { current, past, slots };
  });
  // Un giorno di punta già bloccato per tutto il giorno non si propone più.
  const covered = (start: CalendarDate, end: CalendarDate) =>
    result.current.some((block) => {
      const blockStart = dateToParts(block.startDate);
      const blockEnd = dateToParts(block.endDate);
      return (
        block.slotId === null &&
        blockStart !== null &&
        blockEnd !== null &&
        compareDates(blockStart, start) <= 0 &&
        compareDates(blockEnd, end) >= 0
      );
    });
  return {
    current: result.current.map(toSummary),
    past: result.past.map(toSummary),
    peakDays: upcomingCarePeakDays(ctx.country, today)
      .filter((peak) => !covered(peak.startDate, peak.endDate))
      .map((peak) => ({
        key: peak.key,
        startDate: toIsoDate(peak.startDate),
        endDate: toIsoDate(peak.endDate),
      })),
    slots: result.slots.map(slotDto),
    canWrite: hasPermission(ctx, 'subscriptions:write'),
  };
}

/**
 * L'anteprima di un blocco: le visite toccate, contratto per contratto, con dove vanno. Non
 * scrive nulla e non blocca le fasce; il salvataggio rifà il piano e confronta l'impronta.
 */
export async function previewCareBlock(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<CareBlockPreviewDto> {
  requirePermission(ctx, 'subscriptions:write');
  const parsed = careBlockSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  checkWindow(input, today);
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const book = await openBlockBook(tx, ctx, input, false);
    const visits = await loadAffected(tx, ctx, input, false);
    if (visits.length > CARE_BLOCK_LIMITS.affectedVisits) {
      throw new ConflictError('care_block_too_many_visits');
    }
    book.addBlock({ id: 'new', ...input });
    const changes = await planChanges(tx, ctx, input, visits, book, today);
    const slot = input.slotId ? book.slot(input.slotId) : undefined;
    return {
      startDate: toIsoDate(input.startDate),
      endDate: toIsoDate(input.endDate),
      slot: slot ? slotDto(slot) : null,
      label: input.label,
      action: input.action,
      contracts: groupByContract(changes.map(plannedToDto)),
      counts: countsOf(changes),
      plan: fingerprintOf(changes),
      emailsAllowed: careEmailsAllowed({ mode: ctx.mode, status: 'ACTIVE' }),
      overlapping: await overlappingBlocks(tx, ctx, input),
    };
  });
}

/** Un blocco con le visite che ha spostato o cancellato e lo stato degli avvisi per email. */
export async function getCareBlock(
  ctx: TenantContext,
  blockId: string,
): Promise<CareBlockDetailDto> {
  requirePermission(ctx, 'subscriptions:read');
  if (!isUuid(blockId)) throw new NotFoundError('CareBlock');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const block = await tx.careBlock.findFirst({
      where: { tenantId: ctx.tenantId, id: blockId },
      select: blockSelect,
    });
    if (!block) return null;
    const [changes, emails] = await Promise.all([
      tx.careBlockVisit.findMany({
        where: { tenantId: ctx.tenantId, blockId },
        orderBy: [{ fromDate: 'asc' }, { fromStartMinutes: 'asc' }, { id: 'asc' }],
        select: {
          visitId: true,
          subscriptionId: true,
          outcome: true,
          fromDate: true,
          fromStartMinutes: true,
          fromEndMinutes: true,
          toDate: true,
          toStartMinutes: true,
          toEndMinutes: true,
          visit: { select: { isExtra: true } },
          subscription: {
            select: { number: true, customer: { select: { displayName: true, email: true } } },
          },
        },
      }),
      tx.careEmail.findMany({
        where: { tenantId: ctx.tenantId, blockId },
        select: { subscriptionId: true, status: true, attempts: true },
      }),
    ]);
    return { block, changes, emails };
  });
  if (!found) return notFound(ctx, 'CareBlock', blockId);
  const { block, changes, emails } = found;
  const canWrite = hasPermission(ctx, 'subscriptions:write');
  const emailsAllowed = careEmailsAllowed({ mode: ctx.mode, status: 'ACTIVE' });
  const emailBySubscription = new Map(
    emails.map((email) => [
      email.subscriptionId,
      {
        status: email.status,
        retryable:
          canWrite &&
          emailsAllowed &&
          (email.status === 'PENDING' || email.status === 'FAILED') &&
          email.attempts < CARE_EMAIL_RETRY.maxAttempts,
      },
    ]),
  );
  const dtoChanges = changes.map((change) => ({
    subscriptionId: change.subscriptionId,
    number: change.subscription.number,
    customerName: change.subscription.customer.displayName,
    customerEmail: change.subscription.customer.email,
    visitId: change.visitId,
    isExtra: change.visit.isExtra,
    outcome: change.outcome,
    from: {
      date: isoOf(change.fromDate) ?? '',
      start: time(change.fromStartMinutes),
      end: time(change.fromEndMinutes),
    },
    to:
      change.toDate && change.toStartMinutes !== null && change.toEndMinutes !== null
        ? {
            date: isoOf(change.toDate) ?? '',
            start: formatTimeOfDay(change.toStartMinutes),
            end: formatTimeOfDay(change.toEndMinutes),
          }
        : null,
  }));
  return {
    ...toSummary(block),
    contracts: groupByContract(dtoChanges, emailBySubscription),
    counts: countsOf(dtoChanges),
    createdAt: block.createdAt.toISOString(),
    emailsAllowed,
    canWrite: canWrite && block.removedAt === null,
  };
}

// -----------------------------------------------------------------------------
// Scritture
// -----------------------------------------------------------------------------

/** Gli avvisi dopo il commit, con il tetto di tempo comune delle email di Floral Care. */
function deliverNotices(
  ctx: TenantContext,
  emailIds: readonly string[],
  mail: CareMailDeps | null,
): Promise<number> {
  return deliverCareEmailsWithin({ tenantId: ctx.tenantId, userId: ctx.userId }, emailIds, mail);
}

/**
 * "Bloquear días": salva il blocco e sposta o cancella insieme le visite toccate, come
 * nell'anteprima (stessa impronta), con "Sí, avisé al cliente" se ce n'è almeno una. L'email ai
 * clienti, se chiesta e possibile, è una per contratto.
 */
export async function createCareBlock(
  ctx: TenantContext,
  rawInput: unknown,
  mail: CareMailDeps | null,
): Promise<CareBlockCreateResult> {
  requirePermission(ctx, 'subscriptions:write');
  const parsed = careBlockConfirmSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  checkWindow(input, today);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    // Ordine dei blocchi come chi cambia le visite di un contratto: i contratti toccati (in ordine
    // di id), le fasce (dentro il libro), poi le visite in ordine di id. Le righe nuove (le visite
    // cambiate, gli avvisi) puntano ai contratti: tenerli già bloccati evita di fermarsi con chi
    // ha un contratto e aspetta le fasce (uno spostamento, la generazione).
    const candidates = await loadAffected(tx, ctx, input, false);
    if (candidates.length > CARE_BLOCK_LIMITS.affectedVisits) {
      throw new ConflictError('care_block_too_many_visits');
    }
    const contracts = new Set(candidates.map((visit) => visit.subscriptionId));
    await lockContracts(tx, ctx.tenantId, [...contracts]);
    const book = await openBlockBook(tx, ctx, input, true);
    const active = await tx.careBlock.count({
      where: { tenantId: ctx.tenantId, removedAt: null, endDate: { gte: dbDate(today) } },
    });
    if (active >= CARE_BLOCK_LIMITS.active) throw new ConflictError('care_block_limit');
    const visits = await loadAffected(tx, ctx, input, true);
    // Una visita nata nel frattempo in un altro contratto: il piano è cambiato, si rivede.
    if (visits.some((visit) => !contracts.has(visit.subscriptionId))) {
      throw new ConflictError('care_block_changed');
    }
    book.addBlock({ id: 'new', ...input });
    const changes = await planChanges(tx, ctx, input, visits, book, today);
    if (fingerprintOf(changes) !== input.plan) throw new ConflictError('care_block_changed');
    if (changes.length > 0 && !input.customerNotified) {
      throw new ValidationError({ customerNotified: 'care_notice_required' });
    }
    const block = await tx.careBlock.create({
      data: {
        tenantId: ctx.tenantId,
        startDate: dbDate(input.startDate),
        endDate: dbDate(input.endDate),
        slotId: input.slotId,
        label: input.label,
        action: input.action,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    for (const change of changes) {
      const where = { id: change.visit.id, tenantId: ctx.tenantId, status: 'SCHEDULED' as const };
      if (change.outcome === 'MOVED' && change.to) {
        await tx.careVisit.updateMany({
          where,
          data: {
            scheduledDate: dbDate(change.to.date),
            slotId: change.to.slotId,
            startMinutes: change.to.startMinutes,
            endMinutes: change.to.endMinutes,
          },
        });
      } else if (change.outcome === 'TO_RESCHEDULE') {
        await tx.careVisit.updateMany({
          where,
          data: {
            status: 'TO_RESCHEDULE',
            scheduledDate: null,
            slotId: null,
            startMinutes: null,
            endMinutes: null,
          },
        });
      } else {
        await tx.careVisit.updateMany({
          where,
          data: {
            status: 'CANCELLED',
            cancelReason: 'SHOP',
            outcomeNote: input.label,
            closedById: ctx.userId,
          },
        });
      }
    }
    if (changes.length > 0) {
      await tx.careBlockVisit.createMany({
        data: changes.map((change) => ({
          tenantId: ctx.tenantId,
          blockId: block.id,
          visitId: change.visit.id,
          subscriptionId: change.visit.subscriptionId,
          outcome: change.outcome,
          fromDate: change.visit.scheduledDate ?? dbDate(input.startDate),
          fromStartMinutes: change.visit.startMinutes,
          fromEndMinutes: change.visit.endMinutes,
          toDate: change.to ? dbDate(change.to.date) : null,
          toStartMinutes: change.to?.startMinutes ?? null,
          toEndMinutes: change.to?.endMinutes ?? null,
        })),
      });
    }
    // L'avviso per email: uno per contratto toccato, se chiesto, possibile e il cliente ha l'email.
    let emailIds: string[] = [];
    if (input.sendEmail && careEmailsAllowed({ mode: ctx.mode, status: 'ACTIVE' })) {
      const contracts = new Map<string, string | null>();
      for (const change of changes) {
        contracts.set(change.visit.subscriptionId, change.visit.subscription.customer.email);
      }
      const recipients = [...contracts].filter(
        ([, email]) =>
          careReportRecipient({ requested: true, allowed: true, customerEmail: email }) !== null,
      );
      if (recipients.length > 0) {
        const created = await tx.careEmail.createManyAndReturn({
          data: recipients.map(([subscriptionId]) => ({
            tenantId: ctx.tenantId,
            kind: 'BLOCK_NOTICE' as const,
            subscriptionId,
            blockId: block.id,
            requestedById: ctx.userId,
          })),
          skipDuplicates: true,
          select: { id: true },
        });
        emailIds = created.map((row) => row.id);
      }
    }
    const counts = countsOf(changes);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careBlockCreated,
      entityType: 'CareBlock',
      entityId: block.id,
      metadata: {
        startDate: toIsoDate(input.startDate),
        endDate: toIsoDate(input.endDate),
        slotId: input.slotId,
        action: input.action,
        ...counts,
        contracts: new Set(changes.map((change) => change.visit.subscriptionId)).size,
        emails: emailIds.length,
        customerNotified: changes.length > 0,
      },
    });
    return { blockId: block.id, counts, emailIds };
  });
  const sent = await deliverNotices(ctx, result.emailIds, mail);
  return {
    blockId: result.blockId,
    counts: result.counts,
    emails: { queued: result.emailIds.length, sent },
  };
}

/** "Quitar bloqueo": i giorni tornano liberi; le visite già spostate restano dove sono. */
export async function removeCareBlock(ctx: TenantContext, blockId: string): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(blockId)) throw new NotFoundError('CareBlock');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    // Come chi prenota: in fila dietro le prenotazioni in corso.
    await lockCareSlots(tx, ctx.tenantId);
    const block = await tx.careBlock.findFirst({
      where: { tenantId: ctx.tenantId, id: blockId },
      select: { id: true, startDate: true, endDate: true, slotId: true, removedAt: true },
    });
    if (!block) return false;
    if (block.removedAt) return true;
    await tx.careBlock.update({
      where: { id: block.id, tenantId: ctx.tenantId },
      data: { removedAt: new Date(), removedById: ctx.userId },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careBlockRemoved,
      entityType: 'CareBlock',
      entityId: block.id,
      metadata: {
        startDate: isoOf(block.startDate),
        endDate: isoOf(block.endDate),
        slotId: block.slotId,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CareBlock', blockId);
}

/**
 * "Enviar aviso" / "Reintentar" dalla pagina del blocco: l'avviso di un contratto toccato. Crea la
 * riga d'uscita se all'inizio non era stato chiesto; rimette in fila quella fallita (fino a 3
 * tentativi). Dopo un invio riuscito non si rimanda.
 */
export async function sendCareBlockNotice(
  ctx: TenantContext,
  blockId: string,
  subscriptionId: string,
  mail: CareMailDeps,
): Promise<'sent' | 'failed'> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(blockId)) throw new NotFoundError('CareBlock');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const block = await tx.careBlock.findFirst({
      where: { tenantId: ctx.tenantId, id: blockId },
      select: { id: true, removedAt: true },
    });
    if (!block) return { missing: 'CareBlock' as const };
    const change = await tx.careBlockVisit.findFirst({
      where: { tenantId: ctx.tenantId, blockId, subscriptionId },
      select: { subscription: { select: { customer: { select: { email: true } } } } },
    });
    if (!change) return { missing: 'CustomerSubscription' as const };
    if (
      block.removedAt ||
      !careEmailsAllowed({ mode: ctx.mode, status: 'ACTIVE' }) ||
      careReportRecipient({
        requested: true,
        allowed: true,
        customerEmail: change.subscription.customer.email,
      }) === null
    ) {
      throw new ConflictError('care_email_not_retryable');
    }
    const existing = await tx.careEmail.findFirst({
      where: { tenantId: ctx.tenantId, blockId, subscriptionId },
      select: { id: true, status: true, attempts: true },
    });
    if (existing) {
      const retryable =
        (existing.status === 'PENDING' || existing.status === 'FAILED') &&
        existing.attempts < CARE_EMAIL_RETRY.maxAttempts;
      if (!retryable) throw new ConflictError('care_email_not_retryable');
      return { emailId: existing.id };
    }
    const created = await tx.careEmail.create({
      data: {
        tenantId: ctx.tenantId,
        kind: 'BLOCK_NOTICE',
        subscriptionId,
        blockId,
        requestedById: ctx.userId,
      },
      select: { id: true },
    });
    return { emailId: created.id };
  });
  if ('missing' in found) {
    return found.missing === 'CareBlock'
      ? notFound(ctx, 'CareBlock', blockId)
      : notFound(ctx, 'CustomerSubscription', subscriptionId);
  }
  const outcome = await deliverCareEmail(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    found.emailId,
    mail,
  );
  return outcome === 'sent' ? 'sent' : 'failed';
}

/**
 * "Alguien no puede ir": le visite programmate di una persona nei giorni scelti passano a un'altra
 * (o a nessuno). Cambia solo chi va, non l'ora: niente avviso al cliente.
 */
export async function reassignCareVisits(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ readonly count: number }> {
  requirePermission(ctx, 'subscriptions:write');
  const parsed = careReassignSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  if (compareDates(input.startDate, today) < 0) {
    throw new ValidationError({ startDate: 'care_block_past' });
  }
  if (daysBetween(today, input.startDate) > CARE_BLOCK_LIMITS.horizonDays) {
    throw new ValidationError({ startDate: 'care_block_too_far' });
  }
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    // Chi non può andare può anche non essere più nella squadra: le sue visite restano da dare.
    const from = await tx.membership.findFirst({
      where: { tenantId: ctx.tenantId, id: input.fromMembershipId },
      select: { id: true },
    });
    if (!from) throw new ValidationError({ fromMembershipId: 'invalid_option' });
    if (input.toMembershipId) {
      const to = await tx.membership.findFirst({
        where: { tenantId: ctx.tenantId, id: input.toMembershipId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!to) throw new ValidationError({ toMembershipId: 'invalid_option' });
    }
    const fromIso = toIsoDate(input.startDate);
    const untilIso = toIsoDate(input.endDate);
    // Le visite in ordine di id, come gli altri cambi di massa.
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CareVisit"
      WHERE "tenantId" = ${ctx.tenantId}::uuid
        AND "assignedMembershipId" = ${input.fromMembershipId}::uuid
        AND "status" = 'SCHEDULED'
        AND "scheduledDate" BETWEEN ${fromIso}::date AND ${untilIso}::date
      ORDER BY "id"
      FOR UPDATE`;
    if (rows.length === 0) return { count: 0 };
    const updated = await tx.careVisit.updateMany({
      where: {
        tenantId: ctx.tenantId,
        id: { in: rows.map((row) => row.id) },
        status: 'SCHEDULED',
        assignedMembershipId: input.fromMembershipId,
      },
      data: { assignedMembershipId: input.toMembershipId },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careVisitsReassigned,
      entityType: 'Membership',
      entityId: input.fromMembershipId,
      metadata: {
        from: input.fromMembershipId,
        to: input.toMembershipId,
        startDate: fromIso,
        endDate: untilIso,
        count: updated.count,
      },
    });
    return { count: updated.count };
  });
}
