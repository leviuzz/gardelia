/**
 * Apartados con vencimiento [INV-01] (ADR-062): merce messa da parte per un evento o un cliente
 * fino a una data, nel calendario della fioreria.
 *
 *  - Un apartado non cambia la giacenza: toglie merce dal disponibile finché vale, cioè fino alla
 *    fine del giorno di scadenza. Il giorno dopo è vencido e non tiene più nulla, senza job.
 *  - "Usar": la merce esce con un registro di uso, per quanto si è usato davvero; "Liberar": torna
 *    disponibile; "Extender": nuova scadenza, anche per un apartado vencido. Niente si cancella.
 *  - Se la merce disponibile non basta si avvisa e si chiede conferma, come per gli usi (ADR-060).
 *  - Vedere: tutti i ruoli (`inventory:read`); apartar, usare, liberare, extender: proprietario e
 *    manager (`inventory:write`). Piano: `inventory`.
 *  - Per gli ordini (chi li collega): `reserveStockTx`, `consumeReservationTx` e
 *    `releaseReservationTx` nella sua transazione, senza controllare i permessi dell'inventario
 *    (come `consumeStockTx`).
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  INVENTORY_LIMITS,
  INVENTORY_PAGE_SIZE,
  RESERVATION_LIMITS,
  compareDates,
  daysBetween,
  formatOrderNumber,
  isUuid,
  reservationDaysLeft,
  reservationExpiryRange,
  reservationExtendSchema,
  reservationInputSchema,
  reservationListFiltersSchema,
  reservationState,
  reservationUseSchema,
  stockValue,
  sumKnown,
  toFieldErrors,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
  type RecordStatus,
  type ReservationState,
  type ReservationStatus,
  type ReservationView,
  type SaleUnit,
} from '@floral/domain';
import type { ZodType } from 'zod';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getEntitlements, requireEntitlement } from './billing';
import {
  aggregateRequest,
  checkLines,
  lockInventoryItems,
  missingFor,
  reservedQuantities,
  shopToday,
  writeInventoryEntry,
  type LockedInventoryItem,
  type MovementLine,
  type StockCheckLine,
  type StockRequestLine,
} from './inventory-internals';

function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

function todayOf(ctx: TenantContext): CalendarDate {
  return todayInTimeZone(ctx.timezone);
}

/** Le colonne `@db.Date` arrivano e partono come mezzanotte UTC. */
function toDateColumn(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function fromDateColumn(date: Date): CalendarDate {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

export interface ReservationLineDto {
  readonly id: string;
  readonly inventoryItemId: string;
  readonly name: string;
  readonly variety: string | null;
  readonly saleUnit: SaleUnit;
  readonly quantity: number;
  /** Quanto si è usato davvero (solo per un apartado usato). */
  readonly usedQuantity: number | null;
  /** ARCHIVED: il prodotto non si controlla più; la riga non tiene merce e non si usa. */
  readonly tracking: RecordStatus;
}

export interface ReservationSummaryDto {
  readonly id: string;
  readonly label: string;
  readonly note: string | null;
  /** "AAAA-MM-GG": ultimo giorno in cui vale. */
  readonly expiresOn: string;
  /**
   * "AAAA-MM-GG" da cui toglie merce dal disponibile; null = da subito. Gli apartados degli ordini
   * tengono solo negli ultimi giorni prima della consegna (ADR-072).
   */
  readonly holdsFrom: string | null;
  /** Comincia più avanti: per ora non toglie merce. */
  readonly scheduled: boolean;
  /** L'ordine che lo governa (ADR-072): si usa e si libera solo dall'ordine. */
  readonly order: {
    readonly id: string;
    readonly numberLabel: string;
    readonly customerName: string;
  } | null;
  readonly status: ReservationStatus;
  readonly state: ReservationState;
  /** Giorni alla scadenza: 0 = scade oggi, negativo = vencido. */
  readonly daysLeft: number;
  readonly lines: readonly ReservationLineDto[];
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

export interface ReservationListResult {
  readonly items: readonly ReservationSummaryDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly view: ReservationView;
  /** Quanti apartados per vista (senza la ricerca), per le schede. */
  readonly counts: Readonly<Record<ReservationView, number>>;
  readonly canWrite: boolean;
}

export interface ReservationLineDetailDto extends ReservationLineDto {
  readonly onHand: number;
  /** Quanto c'è per questo apartado: giacenza meno gli altri apartados che valgono. */
  readonly availableForThis: number;
}

export interface ReservationDetailDto extends ReservationSummaryDto {
  readonly lines: readonly ReservationLineDetailDto[];
  readonly createdByName: string | null;
  readonly closedByName: string | null;
  /** Il registro di uso, per chi lo cerca fra i movimenti. */
  readonly usedEntryId: string | null;
  readonly canWrite: boolean;
}

const lineSelect = {
  id: true,
  inventoryItemId: true,
  quantity: true,
  usedQuantity: true,
  item: {
    select: {
      status: true,
      onHand: true,
      catalogItemId: true,
      catalogItem: { select: { name: true, variety: true, saleUnit: true } },
    },
  },
} satisfies Prisma.InventoryReservationLineSelect;

const reservationSelect = {
  id: true,
  label: true,
  note: true,
  expiresOn: true,
  holdsFrom: true,
  status: true,
  usedEntryId: true,
  createdById: true,
  closedById: true,
  createdAt: true,
  closedAt: true,
  order: { select: { id: true, number: true, customer: { select: { displayName: true } } } },
  lines: {
    select: lineSelect,
    orderBy: [{ item: { catalogItem: { name: 'asc' } } }, { id: 'asc' }],
  },
} satisfies Prisma.InventoryReservationSelect;

type ReservationRow = Prisma.InventoryReservationGetPayload<{ select: typeof reservationSelect }>;
type LineRow = ReservationRow['lines'][number];

function toLineDto(line: LineRow): ReservationLineDto {
  return {
    id: line.id,
    inventoryItemId: line.inventoryItemId,
    name: line.item.catalogItem.name,
    variety: line.item.catalogItem.variety,
    saleUnit: line.item.catalogItem.saleUnit,
    quantity: line.quantity,
    usedQuantity: line.usedQuantity,
    tracking: line.item.status,
  };
}

function toSummaryDto(row: ReservationRow, today: CalendarDate): ReservationSummaryDto {
  const expiresOn = fromDateColumn(row.expiresOn);
  const holdsFrom = row.holdsFrom ? fromDateColumn(row.holdsFrom) : null;
  return {
    id: row.id,
    label: row.label,
    note: row.note,
    expiresOn: toIsoDate(expiresOn),
    holdsFrom: holdsFrom ? toIsoDate(holdsFrom) : null,
    scheduled: row.status === 'ACTIVE' && holdsFrom !== null && compareDates(holdsFrom, today) > 0,
    order: row.order
      ? {
          id: row.order.id,
          numberLabel: formatOrderNumber(row.order.number),
          customerName: row.order.customer.displayName,
        }
      : null,
    status: row.status,
    state: reservationState(row.status, expiresOn, today),
    daysLeft: reservationDaysLeft(expiresOn, today),
    lines: row.lines.map(toLineDto),
    createdAt: row.createdAt,
    closedAt: row.closedAt,
  };
}

function viewWhere(view: ReservationView, today: Date): Prisma.InventoryReservationWhereInput {
  switch (view) {
    case 'current':
      return { status: 'ACTIVE', expiresOn: { gte: today } };
    case 'expired':
      // Un ordine in ritardo lo chiude l'ordine stesso (ADR-072): qui solo quelli fatti a mano.
      return { status: 'ACTIVE', expiresOn: { lt: today }, order: { is: null } };
    case 'closed':
      return { status: { in: ['USED', 'RELEASED'] } };
  }
}

function viewOrder(view: ReservationView): Prisma.InventoryReservationOrderByWithRelationInput[] {
  switch (view) {
    case 'current':
      return [{ expiresOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];
    case 'expired':
      return [{ expiresOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
    case 'closed':
      return [{ closedAt: 'desc' }, { id: 'desc' }];
  }
}

/** Apartados: vigentes (dal primo che scade), vencidos o cerrados, con ricerca per "Para" o cliente. */
export async function listReservations(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<ReservationListResult> {
  requirePermission(ctx, 'inventory:read');
  const filters = reservationListFiltersSchema.parse(rawFilters ?? {});
  const todayDate = shopToday(ctx);
  const today = todayOf(ctx);
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const count = (view: ReservationView) =>
      tx.inventoryReservation.count({
        where: { tenantId: ctx.tenantId, ...viewWhere(view, todayDate) },
      });
    const counts = {
      current: await count('current'),
      expired: await count('expired'),
      closed: await count('closed'),
    };
    const where: Prisma.InventoryReservationWhereInput = {
      tenantId: ctx.tenantId,
      ...viewWhere(filters.view, todayDate),
      // "Para", o il cliente dell'ordine per gli apartados degli ordini (si chiamano col numero).
      ...(filters.q
        ? {
            OR: [
              { label: { contains: filters.q, mode: 'insensitive' } },
              {
                order: {
                  is: { customer: { displayName: { contains: filters.q, mode: 'insensitive' } } },
                },
              },
            ],
          }
        : {}),
    };
    const total = filters.q ? await tx.inventoryReservation.count({ where }) : counts[filters.view];
    const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const rows = await tx.inventoryReservation.findMany({
      where,
      select: reservationSelect,
      orderBy: viewOrder(filters.view),
      skip: (page - 1) * INVENTORY_PAGE_SIZE,
      take: INVENTORY_PAGE_SIZE,
    });
    return {
      items: rows.map((row) => toSummaryDto(row, today)),
      total,
      page,
      pageCount,
      view: filters.view,
      counts,
      canWrite: hasPermission(ctx, 'inventory:write'),
    };
  });
}

/** Scheda di un apartado, con quanto c'è oggi per ogni riga. */
export async function getReservation(
  ctx: TenantContext,
  reservationId: string,
): Promise<ReservationDetailDto> {
  requirePermission(ctx, 'inventory:read');
  if (!isUuid(reservationId)) throw new NotFoundError('InventoryReservation');
  const today = todayOf(ctx);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const row = await tx.inventoryReservation.findFirst({
      where: { id: reservationId, tenantId: ctx.tenantId },
      select: reservationSelect,
    });
    if (!row) return null;
    const others = await reservedQuantities(tx, ctx, {
      inventoryItemIds: row.lines.map((line) => line.inventoryItemId),
      excludeReservationId: row.id,
    });
    const userIds = [row.createdById, row.closedById].filter((id): id is string => id !== null);
    const users =
      userIds.length > 0
        ? await tx.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
    return { row, others, names: new Map(users.map((user) => [user.id, user.name])) };
  });
  if (!found) return notFound(ctx, 'InventoryReservation', reservationId);
  const { row, others, names } = found;
  return {
    ...toSummaryDto(row, today),
    lines: row.lines.map((line) => ({
      ...toLineDto(line),
      onHand: line.item.onHand,
      availableForThis: line.item.onHand - (others.get(line.inventoryItemId) ?? 0),
    })),
    createdByName: row.createdById ? (names.get(row.createdById) ?? null) : null,
    closedByName: row.closedById ? (names.get(row.closedById) ?? null) : null,
    usedEntryId: row.usedEntryId,
    canWrite: hasPermission(ctx, 'inventory:write'),
  };
}

// -----------------------------------------------------------------------------
// Mattoni nella transazione (UI e ordini)
// -----------------------------------------------------------------------------

interface HoldLine {
  readonly item: LockedInventoryItem;
  readonly quantity: number;
}

/** Scrive un apartado ACTIVE con le sue righe (prodotti bloccati, attivi e diversi fra loro). */
async function writeReservation(
  tx: TransactionClient,
  ctx: TenantContext,
  input: {
    readonly label: string;
    readonly note: string | null;
    readonly expiresOn: CalendarDate;
    readonly holdsFrom?: CalendarDate | null;
    readonly lines: readonly HoldLine[];
    readonly confirmShortage: boolean;
  },
): Promise<{ readonly reservationId: string; readonly missing: number }> {
  const reserved = await reservedQuantities(tx, ctx, {
    inventoryItemIds: input.lines.map((line) => line.item.id),
  });
  const missing = input.lines.reduce(
    (total, line) => total + missingFor(line.item, line.quantity, reserved.get(line.item.id) ?? 0),
    0,
  );
  if (missing > 0 && !input.confirmShortage) {
    throw new ConflictError('inventory_insufficient_stock');
  }
  const created = await tx.inventoryReservation.create({
    data: {
      tenantId: ctx.tenantId,
      label: input.label,
      note: input.note,
      expiresOn: toDateColumn(input.expiresOn),
      holdsFrom: input.holdsFrom ? toDateColumn(input.holdsFrom) : null,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await tx.inventoryReservationLine.createMany({
    data: input.lines.map((line) => ({
      tenantId: ctx.tenantId,
      reservationId: created.id,
      inventoryItemId: line.item.id,
      quantity: line.quantity,
    })),
  });
  const single = input.lines.length === 1 ? input.lines[0] : undefined;
  // Nei metadati niente "Para" né nota: possono contenere il nome del cliente.
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.inventoryReservationCreated,
    entityType: 'InventoryReservation',
    entityId: created.id,
    metadata: {
      lines: input.lines.length,
      units: input.lines.reduce((total, line) => total + line.quantity, 0),
      missing,
      expiresOn: toIsoDate(input.expiresOn),
      ...(single ? { name: single.item.name } : {}),
    },
  });
  return { reservationId: created.id, missing };
}

/** Blocca la riga dell'apartado fino alla fine della transazione e la legge; null se non c'è. */
async function lockReservation(
  tx: TransactionClient,
  ctx: TenantContext,
  reservationId: string,
): Promise<ReservationRow | null> {
  await tx.$queryRaw`SELECT "id" FROM "InventoryReservation" WHERE "id" = ${reservationId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  return tx.inventoryReservation.findFirst({
    where: { id: reservationId, tenantId: ctx.tenantId },
    select: reservationSelect,
  });
}

function requireActive(row: ReservationRow): void {
  if (row.status !== 'ACTIVE') throw new ConflictError('inventory_reservation_closed');
}

/** Le azioni della scheda (Usar, Extender, Liberar) valgono solo per gli apartados fatti a mano. */
function requireManual(row: ReservationRow): void {
  requireActive(row);
  if (row.order) throw new ConflictError('inventory_reservation_order');
}

async function closeAsReleased(
  tx: TransactionClient,
  ctx: TenantContext,
  row: ReservationRow,
): Promise<void> {
  await tx.inventoryReservation.update({
    where: { id: row.id, tenantId: ctx.tenantId },
    data: { status: 'RELEASED', closedAt: new Date(), closedById: ctx.userId },
  });
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.inventoryReservationReleased,
    entityType: 'InventoryReservation',
    entityId: row.id,
    metadata: { lines: row.lines.length },
  });
}

export interface ConsumeReservationResult {
  /** Registro di uso; null se non restava nulla da registrare (prodotti non più controllati). */
  readonly entryId: string | null;
  /** Quanto mancava (registrato con conferma): 0 se la merce bastava. */
  readonly missing: number;
  /** Costo dei materiali usati: previsto (catalogo) e reale (costo medio). */
  readonly expectedCostMinor: number | null;
  readonly actualCostMinor: number | null;
}

/**
 * Usa un apartado: un registro di uso con le quantità indicate per prodotto (anche prodotti fuori
 * dall'apartado, es. i materiali di un ordine), poi l'apartado diventa USED con quanto si è usato
 * di ogni riga. La merce di questo apartado è sua: si controlla solo contro gli altri apartados.
 * `locked` contiene tutti i prodotti dell'apartado e delle quantità, già bloccati.
 */
async function closeAsUsed(
  tx: TransactionClient,
  ctx: TenantContext,
  row: ReservationRow,
  locked: ReadonlyMap<string, LockedInventoryItem>,
  quantities: ReadonlyMap<string, number>,
  confirmShortage: boolean,
): Promise<ConsumeReservationResult> {
  const others = await reservedQuantities(tx, ctx, {
    inventoryItemIds: [...locked.keys()],
    excludeReservationId: row.id,
  });
  const lines: MovementLine[] = [];
  let missing = 0;
  for (const [inventoryItemId, quantity] of quantities) {
    const item = locked.get(inventoryItemId);
    if (!item || item.status !== 'ACTIVE' || quantity <= 0) continue;
    missing += missingFor(item, quantity, others.get(item.id) ?? 0);
    lines.push({ item, quantity: -quantity, unitCostMinor: item.avgUnitCostMinor });
  }
  if (missing > 0 && !confirmShortage) throw new ConflictError('inventory_insufficient_stock');

  const written =
    lines.length > 0
      ? await writeInventoryEntry(tx, ctx, {
          kind: 'USE',
          note: row.label.slice(0, INVENTORY_LIMITS.note),
          lines,
        })
      : null;
  for (const line of row.lines) {
    const recorded = lines.some((movement) => movement.item.id === line.inventoryItemId);
    await tx.inventoryReservationLine.update({
      where: { id: line.id, tenantId: ctx.tenantId },
      data: { usedQuantity: recorded ? (quantities.get(line.inventoryItemId) ?? 0) : 0 },
    });
  }
  await tx.inventoryReservation.update({
    where: { id: row.id, tenantId: ctx.tenantId },
    data: {
      status: 'USED',
      closedAt: new Date(),
      closedById: ctx.userId,
      usedEntryId: written?.entryId ?? null,
    },
  });
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.inventoryReservationUsed,
    entityType: 'InventoryReservation',
    entityId: row.id,
    metadata: {
      lines: lines.length,
      units: lines.reduce((total, line) => total - line.quantity, 0),
      missing,
    },
  });
  return {
    entryId: written?.entryId ?? null,
    missing,
    expectedCostMinor:
      lines.length > 0
        ? sumKnown(lines.map((line) => stockValue(line.quantity, line.item.catalogCostMinor)))
        : null,
    actualCostMinor:
      lines.length > 0
        ? sumKnown(lines.map((line) => stockValue(line.quantity, line.unitCostMinor)))
        : null,
  };
}

// -----------------------------------------------------------------------------
// Operazioni della UI
// -----------------------------------------------------------------------------

export interface CreatedReservation {
  readonly reservationId: string;
  /** Quanto mancava (apartado con conferma): 0 se la merce bastava. */
  readonly missing: number;
}

/** "Nuevo apartado": per chi, fino a quando e quali prodotti. */
export async function createReservation(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<CreatedReservation> {
  requirePermission(ctx, 'inventory:write');
  const input = parse(reservationInputSchema(todayOf(ctx)), rawInput);
  // Lo stesso prodotto in più righe si somma.
  const byItem = new Map<string, number>();
  for (const line of input.lines) {
    byItem.set(line.inventoryItemId, (byItem.get(line.inventoryItemId) ?? 0) + line.quantity);
  }
  if ([...byItem.values()].some((quantity) => quantity > INVENTORY_LIMITS.quantity)) {
    throw new ValidationError({ lines: 'out_of_range' });
  }
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const locked = await lockInventoryItems(tx, ctx, { ids: [...byItem.keys()] });
    const missingId = [...byItem.keys()].find((id) => !locked.has(id));
    if (missingId) return { missingId };
    const lines: HoldLine[] = [];
    for (const [id, quantity] of byItem) {
      const item = locked.get(id);
      if (!item) continue;
      if (item.status !== 'ACTIVE') throw new ConflictError('inventory_item_archived');
      lines.push({ item, quantity });
    }
    return writeReservation(tx, ctx, {
      label: input.label,
      note: input.note,
      expiresOn: input.expiresOn,
      lines,
      confirmShortage: input.confirmShortage,
    });
  });
  if ('missingId' in result) return notFound(ctx, 'InventoryItem', result.missingId);
  return result;
}

/** "Extender": nuova scadenza, anche per un apartado vencido (torna a tenere la merce). */
export async function extendReservation(
  ctx: TenantContext,
  reservationId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(reservationId)) throw new NotFoundError('InventoryReservation');
  const input = parse(reservationExtendSchema(todayOf(ctx)), rawInput);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const row = await lockReservation(tx, ctx, reservationId);
    if (!row) return false;
    requireManual(row);
    const from = toIsoDate(fromDateColumn(row.expiresOn));
    const to = toIsoDate(input.expiresOn);
    if (from === to) return true;
    await tx.inventoryReservation.update({
      where: { id: row.id, tenantId: ctx.tenantId },
      data: { expiresOn: toDateColumn(input.expiresOn) },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.inventoryReservationExtended,
      entityType: 'InventoryReservation',
      entityId: row.id,
      metadata: { from, to },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'InventoryReservation', reservationId);
}

/** "Liberar": l'apartado si chiude e la merce torna disponibile. */
export async function releaseReservation(ctx: TenantContext, reservationId: string): Promise<void> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(reservationId)) throw new NotFoundError('InventoryReservation');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const row = await lockReservation(tx, ctx, reservationId);
    if (!row) return false;
    requireManual(row);
    await closeAsReleased(tx, ctx, row);
    return true;
  });
  if (!found) await notFound(ctx, 'InventoryReservation', reservationId);
}

/**
 * "Usar apartado": quanto si è usato davvero di ogni riga (0 = resta in giacenza). Se la merce non
 * basta, considerando gli altri apartados, serve `confirmShortage`.
 */
export async function consumeReservation(
  ctx: TenantContext,
  reservationId: string,
  rawInput: unknown,
): Promise<ConsumeReservationResult> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(reservationId)) throw new NotFoundError('InventoryReservation');
  const input = parse(reservationUseSchema, rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const row = await lockReservation(tx, ctx, reservationId);
    if (!row) return null;
    requireManual(row);
    const byLine = new Map(row.lines.map((line) => [line.id, line]));
    const quantities = new Map<string, number>();
    for (const used of input.lines) {
      const line = byLine.get(used.lineId);
      // Gli id delle righe arrivano dal browser: una riga di un altro apartado non vale.
      if (!line) throw new ValidationError({ lines: 'invalid' });
      quantities.set(line.inventoryItemId, used.quantity);
    }
    const locked = await lockInventoryItems(tx, ctx, {
      ids: row.lines.map((line) => line.inventoryItemId),
    });
    return closeAsUsed(tx, ctx, row, locked, quantities, input.confirmShortage);
  });
  if (!result) return notFound(ctx, 'InventoryReservation', reservationId);
  return result;
}

// -----------------------------------------------------------------------------
// Per gli ordini (chi li collega): apartar, usare e liberare nella sua transazione
// -----------------------------------------------------------------------------

export interface ReserveStockInput {
  /** "Para": es. il numero dell'ordine e il cliente; breve, mai vuoto. */
  readonly label: string;
  readonly note?: string | null;
  /** Ultimo giorno in cui vale (da oggi a 90 giorni, nel calendario della fioreria). */
  readonly expiresOn: CalendarDate;
  /**
   * Da quando toglie merce (es. pochi giorni prima della consegna di un ordine, ADR-072). Con
   * questa data la scadenza può essere più in là di 90 giorni: conta la durata, al massimo 90.
   */
  readonly holdsFrom?: CalendarDate | null;
  readonly lines: readonly StockRequestLine[];
  /** Apartar anche se la merce disponibile non basta. */
  readonly confirmShortage: boolean;
}

export interface ReserveStockResult {
  /** null: nessun prodotto controllato, o fioreria senza il piano: niente da apartar. */
  readonly reservationId: string | null;
  readonly lines: readonly StockCheckLine[];
}

/**
 * Mette da parte la merce (es. i materiali di un ordine confermato), nella transazione di chi
 * chiama. NON controlla permessi né piano dell'inventario: li ha controllati chi chiama. Senza il
 * piano, o per i prodotti non controllati, non apparta nulla. Se la merce non basta e manca
 * `confirmShortage`: `inventory_insufficient_stock`.
 */
export async function reserveStockTx(
  tx: TransactionClient,
  ctx: TenantContext,
  input: ReserveStockInput,
): Promise<ReserveStockResult> {
  const requested = aggregateRequest(input.lines);
  const label = input.label.trim();
  if (label === '') throw new ValidationError({ label: 'required' });
  if (label.length > RESERVATION_LIMITS.label) throw new ValidationError({ label: 'too_long' });
  const range = reservationExpiryRange(todayOf(ctx));
  const holdsFrom = input.holdsFrom ?? null;
  if (compareDates(input.expiresOn, range.min) < 0) {
    throw new ValidationError({ expiresOn: 'inventory_expiry_past' });
  }
  const tooLong = holdsFrom
    ? compareDates(holdsFrom, input.expiresOn) > 0 ||
      daysBetween(holdsFrom, input.expiresOn) > RESERVATION_LIMITS.maxDays
    : compareDates(input.expiresOn, range.max) > 0;
  if (tooLong) throw new ValidationError({ expiresOn: 'inventory_expiry_too_far' });
  if (requested.size === 0 || !(await getEntitlements(ctx, tx)).inventory) {
    return { reservationId: null, lines: checkLines(requested, new Map()).lines };
  }
  const locked = await lockInventoryItems(tx, ctx, { catalogItemIds: [...requested.keys()] });
  const active = new Map(
    [...locked.values()]
      .filter((item) => item.status === 'ACTIVE')
      .map((item) => [item.catalogItemId, item]),
  );
  const reserved = await reservedQuantities(tx, ctx, {
    inventoryItemIds: [...active.values()].map((item) => item.id),
  });
  const check = checkLines(requested, active, reserved);
  const lines: HoldLine[] = [];
  for (const [catalogItemId, quantity] of requested) {
    const item = active.get(catalogItemId);
    if (item) lines.push({ item, quantity });
  }
  if (lines.length === 0) return { reservationId: null, lines: check.lines };
  const note = input.note?.trim().slice(0, RESERVATION_LIMITS.note) || null;
  const written = await writeReservation(tx, ctx, {
    label,
    note,
    expiresOn: input.expiresOn,
    holdsFrom,
    lines,
    confirmShortage: input.confirmShortage,
  });
  return { reservationId: written.reservationId, lines: check.lines };
}

/**
 * Usa un apartado nella transazione di chi chiama (es. l'ordine è pronto). `lines`: quanto si è
 * usato per prodotto del catalogo, anche prodotti fuori dall'apartado (si scaricano insieme);
 * senza `lines` si usa esattamente quanto era apartado. I prodotti non controllati si ignorano.
 * Senza il piano l'apartado si chiude senza registri. Non controlla i permessi dell'inventario.
 */
export async function consumeReservationTx(
  tx: TransactionClient,
  ctx: TenantContext,
  reservationId: string,
  input: { readonly lines?: readonly StockRequestLine[]; readonly confirmShortage: boolean },
): Promise<ConsumeReservationResult> {
  if (!isUuid(reservationId)) throw new NotFoundError('InventoryReservation');
  const requested = input.lines ? aggregateRequest(input.lines) : null;
  const row = await lockReservation(tx, ctx, reservationId);
  if (!row) throw new NotFoundError('InventoryReservation');
  requireActive(row);
  const enabled = (await getEntitlements(ctx, tx)).inventory;
  const catalogItemIds = new Set(row.lines.map((line) => line.item.catalogItemId));
  for (const catalogItemId of requested?.keys() ?? []) catalogItemIds.add(catalogItemId);
  const locked = enabled
    ? await lockInventoryItems(tx, ctx, { catalogItemIds: [...catalogItemIds] })
    : new Map<string, LockedInventoryItem>();
  const quantities = new Map<string, number>();
  if (requested) {
    const byCatalog = new Map([...locked.values()].map((item) => [item.catalogItemId, item]));
    for (const [catalogItemId, quantity] of requested) {
      const item = byCatalog.get(catalogItemId);
      if (item) quantities.set(item.id, quantity);
    }
  } else {
    for (const line of row.lines) quantities.set(line.inventoryItemId, line.quantity);
  }
  return closeAsUsed(tx, ctx, row, locked, quantities, input.confirmShortage);
}

/**
 * Libera un apartado nella transazione di chi chiama (es. l'ordine è stato annullato). Restituisce
 * false se era già usato o liberato, così chi annulla due volte non sbaglia.
 */
export async function releaseReservationTx(
  tx: TransactionClient,
  ctx: TenantContext,
  reservationId: string,
): Promise<boolean> {
  if (!isUuid(reservationId)) throw new NotFoundError('InventoryReservation');
  const row = await lockReservation(tx, ctx, reservationId);
  if (!row) throw new NotFoundError('InventoryReservation');
  if (row.status !== 'ACTIVE') return false;
  await closeAsReleased(tx, ctx, row);
  return true;
}

/**
 * L'ordine è cambiato (righe o giorno, ADR-072): l'apartado si aggiorna sul posto con le nuove
 * quantità per prodotto e le nuove date, invece di chiuderne uno e aprirne un altro. Senza più
 * prodotti controllati (o senza il piano) si libera. Nella transazione di chi chiama, che ha già
 * bloccato l'ordine; non controlla i permessi dell'inventario. Non chiede conferme per la merce che
 * manca: un ordine non si blocca mai per l'inventario (si vede nel disponibile e negli avvisi).
 */
export async function updateReservationHoldTx(
  tx: TransactionClient,
  ctx: TenantContext,
  reservationId: string,
  input: {
    readonly lines: readonly StockRequestLine[];
    readonly expiresOn: CalendarDate;
    readonly holdsFrom: CalendarDate | null;
  },
): Promise<'unchanged' | 'updated' | 'released'> {
  if (!isUuid(reservationId)) throw new NotFoundError('InventoryReservation');
  const requested = aggregateRequest(input.lines);
  const row = await lockReservation(tx, ctx, reservationId);
  if (!row) throw new NotFoundError('InventoryReservation');
  requireActive(row);
  const enabled = requested.size > 0 && (await getEntitlements(ctx, tx)).inventory;
  const locked = enabled
    ? await lockInventoryItems(tx, ctx, { catalogItemIds: [...requested.keys()] })
    : new Map<string, LockedInventoryItem>();
  /** Quantità voluta per prodotto dell'inventario (solo quelli ancora controllati). */
  const wanted = new Map<string, number>();
  for (const item of locked.values()) {
    const quantity = requested.get(item.catalogItemId);
    if (item.status === 'ACTIVE' && quantity) wanted.set(item.id, quantity);
  }
  if (wanted.size === 0) {
    await closeAsReleased(tx, ctx, row);
    return 'released';
  }

  let changed = false;
  const expiresOn = toDateColumn(input.expiresOn);
  const holdsFrom = input.holdsFrom ? toDateColumn(input.holdsFrom) : null;
  if (
    row.expiresOn.getTime() !== expiresOn.getTime() ||
    (row.holdsFrom?.getTime() ?? null) !== (holdsFrom?.getTime() ?? null)
  ) {
    await tx.inventoryReservation.update({
      where: { id: row.id, tenantId: ctx.tenantId },
      data: { expiresOn, holdsFrom },
    });
    changed = true;
  }
  const current = new Map(row.lines.map((line) => [line.inventoryItemId, line]));
  for (const [inventoryItemId, quantity] of wanted) {
    const line = current.get(inventoryItemId);
    if (!line) {
      await tx.inventoryReservationLine.create({
        data: { tenantId: ctx.tenantId, reservationId: row.id, inventoryItemId, quantity },
      });
      changed = true;
    } else if (line.quantity !== quantity) {
      await tx.inventoryReservationLine.update({
        where: { id: line.id, tenantId: ctx.tenantId },
        data: { quantity },
      });
      changed = true;
    }
  }
  // Un prodotto tolto dall'ordine: la riga dell'apartado (merce tenuta, non un movimento) sparisce,
  // come la riga dell'ordine da cui veniva.
  const removed = row.lines.filter((line) => !wanted.has(line.inventoryItemId));
  if (removed.length > 0) {
    await tx.inventoryReservationLine.deleteMany({
      where: { tenantId: ctx.tenantId, id: { in: removed.map((line) => line.id) } },
    });
    changed = true;
  }
  if (!changed) return 'unchanged';
  // Nei metadati niente "Para" né nota (ADR-062).
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.inventoryReservationUpdated,
    entityType: 'InventoryReservation',
    entityId: row.id,
    metadata: {
      lines: wanted.size,
      units: [...wanted.values()].reduce((total, quantity) => total + quantity, 0),
      expiresOn: toIsoDate(input.expiresOn),
    },
  });
  return 'updated';
}
