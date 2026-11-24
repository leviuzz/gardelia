/**
 * Reportes [BI-01] (ADR-080): vendite del periodo, confronto con il periodo prima, prodotti più
 * venduti, margine dove i costi ci sono, mermas, ricavi ricorrenti stimati di Floral Care e il
 * lavoro dei prossimi 7 giorni. Solo chi gestisce (`reports:read`). Regole pure in
 * `@floral/domain` (reports); qui le letture, tutte nel contesto della fioreria.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  addDays,
  bucketOf,
  changePercent,
  estimateCareMonth,
  marginSummary,
  reportBuckets,
  reportPeriod,
  summarizeSales,
  toIsoDate,
  todayInTimeZone,
  topProducts,
  type CalendarDate,
  type MarginSummary,
  type ProductSales,
  type ReportPeriod,
  type SalesSummary,
} from '@floral/domain';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { getEntitlements } from './billing';
import { dateToParts, partsToDate } from './quote-internals';

/** Pedidos chiusi bene: contano nelle vendite. */
const COMPLETED = ['DELIVERED', 'PICKED_UP'] as const;
/** Pedidos confermati ma non ancora consegnati. */
const TO_DELIVER = ['CONFIRMED', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY'] as const;
const TOP_PRODUCTS = 10;
const UPCOMING_DAYS = 7;

export interface SalesReportDto {
  readonly period: ReportPeriod;
  readonly currency: string;
  readonly sales: SalesSummary & {
    readonly previous: SalesSummary;
    readonly totalChange: number | null;
    readonly ordersChange: number | null;
  };
  /** Confermati nel periodo ma non ancora consegnati. */
  readonly toDeliver: { readonly totalMinor: number; readonly orders: number };
  /** Pagamenti registrati con data nel periodo (le anulaciones sottraggono). */
  readonly collectedMinor: number;
  /** Una barra per giorno (mese) o per mese (anno). */
  readonly chart: readonly { readonly key: string; readonly totalMinor: number }[];
  readonly topProducts: readonly ProductSales[];
  readonly margin: MarginSummary;
  /** null se il piano non include l'inventario. */
  readonly waste: {
    /** Costo delle mermas con il costo noto. */
    readonly costMinor: number;
    readonly withoutCost: number;
    readonly items: readonly {
      readonly name: string;
      readonly quantity: number;
      readonly costMinor: number | null;
    }[];
  } | null;
  /** null se il piano non include Floral Care. */
  readonly recurring: {
    readonly contracts: number;
    readonly minMinor: number;
    readonly maxMinor: number;
  } | null;
  readonly upcoming: {
    readonly from: string;
    readonly to: string;
    readonly orders: number;
    /** null senza Floral Care. */
    readonly visits: number | null;
  };
}

interface WasteRow {
  readonly catalogItemId: string;
  readonly name: string;
  readonly quantity: bigint;
  readonly cost: bigint;
  readonly missing: number;
}

export async function getSalesReport(
  ctx: TenantContext,
  input: { readonly mes?: unknown; readonly ano?: unknown } = {},
): Promise<SalesReportDto> {
  requirePermission(ctx, 'reports:read');
  const today = todayInTimeZone(ctx.timezone);
  const period = reportPeriod(input, today);
  const range = (from: CalendarDate, to: CalendarDate) => ({
    gte: partsToDate(from),
    lt: partsToDate(to),
  });
  const tenantId = ctx.tenantId;
  const entitlements = await getEntitlements(ctx);
  const upcomingTo = addDays(today, UPCOMING_DAYS);

  const data = await withTenantContext(getDb(), ctx, async (tx) => {
    const [orders, previous, toDeliver, payments, upcomingOrders] = await Promise.all([
      tx.order.findMany({
        where: {
          tenantId,
          status: { in: [...COMPLETED] },
          scheduledDate: range(period.from, period.to),
        },
        select: {
          id: true,
          scheduledDate: true,
          totalMinor: true,
          subtotalMinor: true,
          discountMinor: true,
        },
      }),
      tx.order.aggregate({
        where: {
          tenantId,
          status: { in: [...COMPLETED] },
          scheduledDate: range(period.previous.from, period.previous.to),
        },
        _sum: { totalMinor: true },
        _count: true,
      }),
      tx.order.aggregate({
        where: {
          tenantId,
          status: { in: [...TO_DELIVER] },
          scheduledDate: range(period.from, period.to),
        },
        _sum: { totalMinor: true },
        _count: true,
      }),
      tx.orderPayment.groupBy({
        by: ['kind'],
        where: { tenantId, paidOn: range(period.from, period.to) },
        _sum: { amountMinor: true },
      }),
      tx.order.count({
        where: {
          tenantId,
          status: { in: [...TO_DELIVER] },
          scheduledDate: range(today, upcomingTo),
        },
      }),
    ]);
    const lines = await tx.orderLine.findMany({
      where: { tenantId, orderId: { in: orders.map((order) => order.id) } },
      select: {
        orderId: true,
        catalogItemId: true,
        kind: true,
        description: true,
        quantity: true,
        lineTotalMinor: true,
        unitCostMinor: true,
      },
    });
    const itemIds = [
      ...new Set(lines.map((line) => line.catalogItemId).filter((id): id is string => !!id)),
    ];
    const items = await tx.catalogItem.findMany({
      where: { tenantId, id: { in: itemIds } },
      select: { id: true, name: true },
    });

    const fromIso = toIsoDate(period.from);
    const toIso = toIsoDate(period.to);
    // Mermas nel periodo (giorno della fioreria), senza i registri annullati: come il riepilogo
    // del mese dell'inventario (ADR-063).
    const waste = entitlements.inventory
      ? await tx.$queryRaw<WasteRow[]>`
          SELECT i."catalogItemId" AS "catalogItemId", c."name" AS "name",
            SUM(ABS(m."quantity"))::bigint AS "quantity",
            COALESCE(SUM(ABS(m."quantity")::bigint * m."unitCostMinor"), 0)::bigint AS "cost",
            (COUNT(*) FILTER (WHERE m."unitCostMinor" IS NULL))::int AS "missing"
          FROM "InventoryMovement" m
          JOIN "InventoryEntry" e ON e."tenantId" = m."tenantId" AND e."id" = m."entryId"
          JOIN "InventoryItem" i ON i."tenantId" = m."tenantId" AND i."id" = m."inventoryItemId"
          JOIN "CatalogItem" c ON c."tenantId" = i."tenantId" AND c."id" = i."catalogItemId"
          WHERE m."tenantId" = ${tenantId}::uuid
            AND m."kind" = 'WASTE'
            AND NOT EXISTS (
              SELECT 1 FROM "InventoryEntry" r
              WHERE r."tenantId" = e."tenantId" AND r."reversesEntryId" = e."id"
            )
            AND e."occurredAt" >= ((${fromIso}::date)::timestamp AT TIME ZONE ${ctx.timezone}) AT TIME ZONE 'UTC'
            AND e."occurredAt" < ((${toIso}::date)::timestamp AT TIME ZONE ${ctx.timezone}) AT TIME ZONE 'UTC'
          GROUP BY i."catalogItemId", c."name"
          ORDER BY "cost" DESC, "quantity" DESC`
      : null;

    const care = entitlements.floralCare
      ? await Promise.all([
          tx.customerSubscription.findMany({
            where: { tenantId, kind: 'CARE', status: 'ACTIVE' },
            select: { perVisitMinor: true, frequency: true, _count: { select: { slots: true } } },
          }),
          tx.careVisit.count({
            where: {
              tenantId,
              status: 'SCHEDULED',
              scheduledDate: range(today, upcomingTo),
            },
          }),
        ])
      : null;
    return { orders, previous, toDeliver, payments, upcomingOrders, lines, items, waste, care };
  });

  const salesOrders = data.orders.map((order) => ({
    // I pedidos chiusi hanno sempre il giorno (si chiede alla conferma).
    date: toIsoDate(dateToParts(order.scheduledDate) ?? today),
    totalMinor: order.totalMinor,
  }));
  const sales = summarizeSales(salesOrders);
  const previous = {
    totalMinor: data.previous._sum.totalMinor ?? 0,
    orders: data.previous._count,
    averageMinor:
      data.previous._count > 0
        ? Math.round((data.previous._sum.totalMinor ?? 0) / data.previous._count)
        : null,
  };

  const buckets = new Map(reportBuckets(period).map((key) => [key, 0]));
  for (const order of salesOrders) {
    const key = bucketOf(period, order.date);
    buckets.set(key, (buckets.get(key) ?? 0) + order.totalMinor);
  }

  const names = new Map(data.items.map((item) => [item.id, item.name]));
  const reportLines = data.lines.map((line) => ({
    ...line,
    // Il nome attuale del prodotto; per i concetti liberi e i disegni, la descrizione della riga.
    description: (line.catalogItemId && names.get(line.catalogItemId)) || line.description,
  }));
  const orderTotals = new Map(
    data.orders.map((order) => [
      order.id,
      { subtotalMinor: order.subtotalMinor, discountMinor: order.discountMinor },
    ]),
  );

  const collectedMinor = data.payments.reduce(
    (sum, row) => sum + (row.kind === 'REVERSAL' ? -1 : 1) * Number(row._sum.amountMinor ?? 0),
    0,
  );

  return {
    period,
    currency: ctx.currency,
    sales: {
      ...sales,
      previous,
      totalChange: changePercent(sales.totalMinor, previous.totalMinor),
      ordersChange: changePercent(sales.orders, previous.orders),
    },
    toDeliver: { totalMinor: data.toDeliver._sum.totalMinor ?? 0, orders: data.toDeliver._count },
    collectedMinor,
    chart: [...buckets].map(([key, totalMinor]) => ({ key, totalMinor })),
    topProducts: topProducts(reportLines, TOP_PRODUCTS),
    margin: marginSummary(reportLines, orderTotals),
    waste: data.waste
      ? {
          costMinor: data.waste.reduce((sum, row) => sum + Number(row.cost), 0),
          withoutCost: data.waste.reduce((sum, row) => sum + row.missing, 0),
          items: data.waste.slice(0, TOP_PRODUCTS).map((row) => ({
            name: row.name,
            quantity: Number(row.quantity),
            costMinor: row.missing > 0 ? null : Number(row.cost),
          })),
        }
      : null,
    recurring: data.care
      ? data.care[0].reduce(
          (acc, contract) => {
            if (!contract.frequency) return acc;
            const month = estimateCareMonth(
              contract.perVisitMinor,
              contract.frequency,
              Math.max(1, contract._count.slots),
            );
            return {
              contracts: acc.contracts + 1,
              minMinor: acc.minMinor + month.minMinor,
              maxMinor: acc.maxMinor + month.maxMinor,
            };
          },
          { contracts: 0, minMinor: 0, maxMinor: 0 },
        )
      : null,
    upcoming: {
      from: toIsoDate(today),
      to: toIsoDate(addDays(upcomingTo, -1)),
      orders: data.upcomingOrders,
      visits: data.care ? data.care[1] : null,
    },
  };
}
