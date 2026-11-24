/**
 * Agenda degli ordini (ADR-057, blocco B1): il giorno ("Hoy salen", raggruppato per fascia, con la
 * Producción del día sommata dalle distinte) e il mese (quanti ordini per giorno). Lo vede tutta la
 * squadra (`orders:read`); i passi rapidi seguono i permessi di chi guarda. Niente costi.
 */
import { getDb, withTenantContext, type Prisma } from '@floral/db';
import {
  aggregateProduction,
  daysInMonth,
  formatOrderNumber,
  formatTimeOfDay,
  orderBalanceMinor,
  parseIsoDate,
  todayInTimeZone,
  type FulfillmentMode,
  type OrderPaymentStatus,
  type OrderStatus,
  type ProductionLineInput,
  type ProductionRecipeItem,
  type ProductionSummary,
  type SaleUnit,
} from '@floral/domain';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { allowedOrderSteps } from './orders';
import { formatDateParts, partsToDate, type DateParts } from './quote-internals';

/** Stati che contano nell'agenda: niente borradores né annullati. */
const SCHEDULED: readonly OrderStatus[] = [
  'PENDING_ACCEPTANCE',
  'CONFIRMED',
  'IN_PREPARATION',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PICKED_UP',
];

/** Da preparare: entra nella Producción del día (un ordine da accettare non ancora). */
const TO_PRODUCE: readonly OrderStatus[] = ['CONFIRMED', 'IN_PREPARATION', 'READY'];

export interface DayOrderDto {
  readonly id: string;
  readonly numberLabel: string;
  readonly status: OrderStatus;
  readonly fulfillmentMode: FulfillmentMode;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly customerName: string;
  readonly recipientName: string | null;
  /** "Av. Madero 120, Centro": solo a domicilio. */
  readonly addressLine: string | null;
  readonly lines: readonly { readonly description: string; readonly quantity: number }[];
  readonly hasCard: boolean;
  readonly balanceMinor: number;
  readonly paymentStatus: OrderPaymentStatus;
  readonly currency: string;
  /** Passi che chi guarda può fare adesso (il servizio li riverifica). */
  readonly nextSteps: readonly OrderStatus[];
}

export interface DayWindowGroup {
  /** null = in giornata. */
  readonly start: string | null;
  readonly end: string | null;
  readonly orders: readonly DayOrderDto[];
}

export interface OrdersDayDto {
  /** "AAAA-MM-GG" nel calendario della fioreria. */
  readonly date: string;
  readonly isToday: boolean;
  readonly groups: readonly DayWindowGroup[];
  readonly counts: {
    readonly total: number;
    readonly deliveries: number;
    readonly pickups: number;
    /** Ancora da consegnare o ritirare. */
    readonly pending: number;
  };
  /** Solo ordini confermati, in preparazione o pronti. */
  readonly production: ProductionSummary;
  readonly productionOrders: number;
}

interface LineSnapshotView {
  readonly item?: {
    readonly name: string;
    readonly variety: string | null;
    readonly saleUnit: SaleUnit;
  };
  readonly recipe?: readonly ProductionRecipeItem[];
}

function readSnapshot(value: Prisma.JsonValue | null): LineSnapshotView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as LineSnapshotView;
}

function parseDay(ctx: TenantContext, raw: unknown): DateParts {
  return parseIsoDate(raw) ?? todayInTimeZone(ctx.timezone);
}

export async function getOrdersDay(ctx: TenantContext, rawDate: unknown): Promise<OrdersDayDto> {
  requirePermission(ctx, 'orders:read');
  const day = parseDay(ctx, rawDate);
  const today = todayInTimeZone(ctx.timezone);
  const rows = await withTenantContext(getDb(), ctx, async (tx) => {
    const orders = await tx.order.findMany({
      where: {
        tenantId: ctx.tenantId,
        scheduledDate: partsToDate(day),
        status: { in: [...SCHEDULED] },
      },
      include: { customer: { select: { displayName: true } } },
      orderBy: [{ windowStartMinutes: { sort: 'asc', nulls: 'first' } }, { number: 'asc' }],
    });
    // In fila: una transazione usa una sola connessione (ADR-053).
    const lines = await tx.orderLine.findMany({
      where: { tenantId: ctx.tenantId, orderId: { in: orders.map((order) => order.id) } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        orderId: true,
        kind: true,
        catalogItemId: true,
        description: true,
        quantity: true,
        snapshot: true,
      },
    });
    // Tempo di armado (ADR-081): quello attuale del catalogo, è una stima per organizzare il giorno.
    const itemIds = [
      ...new Set(lines.map((line) => line.catalogItemId).filter((id): id is string => !!id)),
    ];
    const prepTimes = await tx.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, id: { in: itemIds }, prepMinutes: { not: null } },
      select: { id: true, prepMinutes: true },
    });
    return { orders, lines, prepTimes };
  });

  const linesByOrder = new Map<string, typeof rows.lines>();
  for (const line of rows.lines) {
    linesByOrder.set(line.orderId, [...(linesByOrder.get(line.orderId) ?? []), line]);
  }

  const groups: { start: string | null; end: string | null; orders: DayOrderDto[] }[] = [];
  for (const order of rows.orders) {
    const start =
      order.windowStartMinutes === null ? null : formatTimeOfDay(order.windowStartMinutes);
    const end = order.windowEndMinutes === null ? null : formatTimeOfDay(order.windowEndMinutes);
    let group = groups.find((candidate) => candidate.start === start && candidate.end === end);
    if (!group) {
      group = { start, end, orders: [] };
      groups.push(group);
    }
    group.orders.push({
      id: order.id,
      numberLabel: formatOrderNumber(order.number),
      status: order.status,
      fulfillmentMode: order.fulfillmentMode,
      windowStart: start,
      windowEnd: end,
      customerName: order.customer.displayName,
      recipientName: order.recipientName,
      addressLine:
        order.fulfillmentMode === 'DELIVERY' && order.deliveryAddressLine1
          ? [order.deliveryAddressLine1, order.deliveryNeighborhood].filter(Boolean).join(', ')
          : null,
      lines: (linesByOrder.get(order.id) ?? []).map((line) => ({
        description: line.description,
        quantity: line.quantity,
      })),
      hasCard: Boolean(order.cardMessage),
      balanceMinor: orderBalanceMinor(order.paidMinor, order.totalMinor),
      paymentStatus: order.paymentStatus,
      currency: order.currency,
      nextSteps: allowedOrderSteps(ctx, order.status, order.fulfillmentMode),
    });
  }

  const producing = new Set(
    rows.orders.filter((order) => TO_PRODUCE.includes(order.status)).map((order) => order.id),
  );
  const prepByItem = new Map(rows.prepTimes.map((item) => [item.id, item.prepMinutes]));
  const productionLines: ProductionLineInput[] = rows.lines
    .filter((line) => producing.has(line.orderId))
    .map((line) => {
      const snapshot = readSnapshot(line.snapshot);
      return {
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        prepMinutes: line.catalogItemId ? (prepByItem.get(line.catalogItemId) ?? null) : null,
        recipe: snapshot?.recipe ?? null,
        item:
          line.kind === 'CATALOG_ITEM' && snapshot?.item
            ? {
                name: snapshot.item.name,
                variety: snapshot.item.variety,
                saleUnit: snapshot.item.saleUnit,
              }
            : null,
      };
    });

  const done = (status: OrderStatus) => status === 'DELIVERED' || status === 'PICKED_UP';
  return {
    date: formatDateParts(day) ?? '',
    isToday: formatDateParts(day) === formatDateParts(today),
    groups,
    counts: {
      total: rows.orders.length,
      deliveries: rows.orders.filter((order) => order.fulfillmentMode === 'DELIVERY').length,
      pickups: rows.orders.filter((order) => order.fulfillmentMode === 'PICKUP').length,
      pending: rows.orders.filter((order) => !done(order.status)).length,
    },
    production: aggregateProduction(productionLines),
    productionOrders: producing.size,
  };
}

export interface OrdersMonthDto {
  readonly year: number;
  readonly month: number;
  /** Solo i giorni con ordini. */
  readonly days: readonly {
    readonly date: string;
    readonly deliveries: number;
    readonly pickups: number;
  }[];
}

/** `rawMonth` = "AAAA-MM"; senza (o non valido) il mese di oggi. */
export async function getOrdersMonth(
  ctx: TenantContext,
  rawMonth: unknown,
): Promise<OrdersMonthDto> {
  requirePermission(ctx, 'orders:read');
  const today = todayInTimeZone(ctx.timezone);
  const match = typeof rawMonth === 'string' ? /^(\d{4})-(\d{2})$/.exec(rawMonth) : null;
  const year = match ? Number(match[1]) : today.year;
  const month = match ? Number(match[2]) : today.month;
  const valid = year >= 1900 && year <= 2200 && month >= 1 && month <= 12;
  const target = valid ? { year, month } : { year: today.year, month: today.month };
  const first = partsToDate({ ...target, day: 1 });
  const last = partsToDate({ ...target, day: daysInMonth(target.year, target.month) });

  const grouped = await withTenantContext(getDb(), ctx, (tx) =>
    tx.order.groupBy({
      by: ['scheduledDate', 'fulfillmentMode'],
      where: {
        tenantId: ctx.tenantId,
        scheduledDate: { gte: first, lte: last },
        status: { in: [...SCHEDULED] },
      },
      _count: { _all: true },
    }),
  );
  const days = new Map<string, { date: string; deliveries: number; pickups: number }>();
  for (const row of grouped) {
    if (!row.scheduledDate) continue;
    const date = row.scheduledDate.toISOString().slice(0, 10);
    const entry = days.get(date) ?? { date, deliveries: 0, pickups: 0 };
    if (row.fulfillmentMode === 'DELIVERY') entry.deliveries += row._count._all;
    else entry.pickups += row._count._all;
    days.set(date, entry);
  }
  return {
    year: target.year,
    month: target.month,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
