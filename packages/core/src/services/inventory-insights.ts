/**
 * Inventario: avvisi, ramos del catálogo e riepilogo del mese [INV-01] (ADR-063).
 *
 *  - Avvisi per il pannello: prodotti por agotarse o agotados (sul disponibile) e apartados che
 *    scadono oggi o domani o sono già vencidos.
 *  - Un ramo del catálogo con ricetta: quanti se ne possono fare con la merce disponibile, cosa
 *    manca, costo dei materiali previsto (catalogo) e reale (costo medio), e "Registrar ramos
 *    hechos" (la ricetta × N esce con un registro di uso). Gli ingredienti non controllati non
 *    limitano i ramos e non si scaricano: chi compra a richiesta non vede numeri inventati.
 *  - Riepilogo del mese per chi vede i costi: compras, usato e mermas al costo reale, e l'usato ai
 *    costi del catalogo (costo previsto e reale dell'intera fioreria).
 */
import { getDb, withTenantContext, type Prisma } from '@floral/db';
import {
  AUDIT_ACTIONS,
  INVENTORY_LIMITS,
  addDays,
  bouquetMaterialCost,
  bouquetsMadeSchema,
  bouquetsPossible,
  isUuid,
  monthParam,
  nextMonth,
  stockStatus,
  stockValue,
  summaryMonth,
  sumKnown,
  toFieldErrors,
  toIsoDate,
  todayInTimeZone,
  type BouquetMaterialCost,
  type SaleUnit,
  type StockStatus,
} from '@floral/domain';
import type { ZodType } from 'zod';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getEntitlements, requireEntitlement } from './billing';
import {
  checkLines,
  lockInventoryItems,
  reservedQuantities,
  shopToday,
  writeInventoryEntry,
  type MovementLine,
} from './inventory-internals';

function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

// -----------------------------------------------------------------------------
// Avvisi per il pannello
// -----------------------------------------------------------------------------

export interface InventoryAlertItemDto {
  readonly id: string;
  readonly name: string;
  readonly variety: string | null;
  readonly saleUnit: SaleUnit;
  readonly available: number;
  readonly status: Exclude<StockStatus, 'OK'>;
}

export interface InventoryAlertsDto {
  readonly low: number;
  readonly out: number;
  /** I prodotti da guardare per primi (agotados, poi por agotarse), al massimo 5. */
  readonly items: readonly InventoryAlertItemDto[];
  /** Apartados che scadono oggi o domani. */
  readonly reservationsDueSoon: number;
  /** Apartados vencidos ancora aperti (da usare, extender o liberar). */
  readonly reservationsExpired: number;
}

/** Quanti prodotti mostrare nel riquadro del pannello. */
const ALERT_ITEMS = 5;

/** Avvisi dell'inventario per il pannello: null senza il piano (il riquadro non compare). */
export async function getInventoryAlerts(ctx: TenantContext): Promise<InventoryAlertsDto | null> {
  requirePermission(ctx, 'inventory:read');
  const today = shopToday(ctx);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return withTenantContext(getDb(), ctx, async (tx) => {
    if (!(await getEntitlements(ctx, tx)).inventory) return null;
    const rows = await tx.inventoryItem.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: {
        id: true,
        onHand: true,
        minQuantity: true,
        catalogItem: { select: { name: true, variety: true, saleUnit: true } },
      },
    });
    const reserved = await reservedQuantities(tx, ctx);
    const flagged: InventoryAlertItemDto[] = [];
    for (const row of rows) {
      const level = {
        onHand: row.onHand,
        reserved: reserved.get(row.id) ?? 0,
        minQuantity: row.minQuantity,
      };
      const status = stockStatus(level);
      if (status === 'OK') continue;
      flagged.push({
        id: row.id,
        name: row.catalogItem.name,
        variety: row.catalogItem.variety,
        saleUnit: row.catalogItem.saleUnit,
        available: level.onHand - level.reserved,
        status,
      });
    }
    flagged.sort(
      (a, b) =>
        (a.status === b.status ? 0 : a.status === 'OUT' ? -1 : 1) || a.name.localeCompare(b.name),
    );
    // Gli apartados degli ordini li governa l'ordine (ADR-072): niente avvisi qui.
    const open = { tenantId: ctx.tenantId, status: 'ACTIVE', order: { is: null } } as const;
    return {
      low: flagged.filter((item) => item.status === 'LOW').length,
      out: flagged.filter((item) => item.status === 'OUT').length,
      items: flagged.slice(0, ALERT_ITEMS),
      reservationsDueSoon: await tx.inventoryReservation.count({
        where: { ...open, expiresOn: { gte: today, lte: tomorrow } },
      }),
      reservationsExpired: await tx.inventoryReservation.count({
        where: { ...open, expiresOn: { lt: today } },
      }),
    };
  });
}

// -----------------------------------------------------------------------------
// Ramos del catálogo
// -----------------------------------------------------------------------------

export interface BouquetInventoryLineDto {
  readonly catalogItemId: string;
  readonly name: string;
  readonly variety: string | null;
  readonly saleUnit: SaleUnit;
  /** Quantità per un ramo. */
  readonly quantity: number;
  /** Prodotto controllato e attivo: null se non si controlla (non limita i ramos). */
  readonly inventoryItemId: string | null;
  /** Disponibile oggi (giacenza meno apartados); null se non si controlla. */
  readonly available: number | null;
}

export interface BouquetInventoryDto {
  readonly bouquetId: string;
  readonly name: string;
  readonly lines: readonly BouquetInventoryLineDto[];
  /** Quanti ramos si possono fare; null se nessun ingrediente si controlla. */
  readonly possible: number | null;
  /** Costo dei materiali di un ramo: null per chi non vede i costi. */
  readonly cost: BouquetMaterialCost | null;
  readonly currency: string;
  readonly canRecord: boolean;
}

const bouquetSelect = {
  id: true,
  name: true,
  type: true,
  currency: true,
  recipe: {
    select: {
      lines: {
        select: {
          quantity: true,
          ingredient: {
            select: {
              id: true,
              name: true,
              variety: true,
              saleUnit: true,
              costMinor: true,
              inventoryItem: {
                select: { id: true, status: true, onHand: true, avgUnitCostMinor: true },
              },
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  },
} satisfies Prisma.CatalogItemSelect;

/**
 * Il ramo visto dall'inventario (riquadro nella sua scheda del catalogo): null senza il piano, se
 * non è un ramo o se la ricetta è vuota (non c'è nulla da contare).
 */
export async function getBouquetInventory(
  ctx: TenantContext,
  bouquetId: string,
): Promise<BouquetInventoryDto | null> {
  requirePermission(ctx, 'inventory:read');
  if (!isUuid(bouquetId)) throw new NotFoundError('CatalogItem');
  const costs = hasPermission(ctx, 'catalog:costs:read');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    if (!(await getEntitlements(ctx, tx)).inventory) return { bouquet: null, reserved: null };
    const bouquet = await tx.catalogItem.findFirst({
      where: { id: bouquetId, tenantId: ctx.tenantId },
      select: bouquetSelect,
    });
    if (!bouquet) return null;
    const ids = (bouquet.recipe?.lines ?? [])
      .map((line) => line.ingredient.inventoryItem)
      .filter((item) => item?.status === 'ACTIVE')
      .map((item) => item?.id ?? '');
    const reserved = await reservedQuantities(tx, ctx, { inventoryItemIds: ids });
    return { bouquet, reserved };
  });
  if (!found) return notFound(ctx, 'CatalogItem', bouquetId);
  const { bouquet, reserved } = found;
  if (!bouquet || !reserved || bouquet.type !== 'BOUQUET') return null;
  const recipeLines = bouquet.recipe?.lines ?? [];
  if (recipeLines.length === 0) return null;

  const lines = recipeLines.map((line) => {
    const item =
      line.ingredient.inventoryItem?.status === 'ACTIVE' ? line.ingredient.inventoryItem : null;
    return {
      dto: {
        catalogItemId: line.ingredient.id,
        name: line.ingredient.name,
        variety: line.ingredient.variety,
        saleUnit: line.ingredient.saleUnit,
        quantity: line.quantity,
        inventoryItemId: item?.id ?? null,
        available: item ? item.onHand - (reserved.get(item.id) ?? 0) : null,
      } satisfies BouquetInventoryLineDto,
      realUnitCostMinor: item?.avgUnitCostMinor ?? null,
      catalogUnitCostMinor: line.ingredient.costMinor,
    };
  });
  return {
    bouquetId: bouquet.id,
    name: bouquet.name,
    lines: lines.map((line) => line.dto),
    possible: bouquetsPossible(lines.map((line) => line.dto)),
    cost: costs
      ? bouquetMaterialCost(
          lines.map((line) => ({
            quantity: line.dto.quantity,
            realUnitCostMinor: line.realUnitCostMinor,
            catalogUnitCostMinor: line.catalogUnitCostMinor,
          })),
        )
      : null,
    currency: bouquet.currency,
    canRecord: hasPermission(ctx, 'inventory:write'),
  };
}

export interface BouquetsMadeResult {
  /** Registro di uso; null se nessun ingrediente si controlla (niente da scaricare). */
  readonly entryId: string | null;
  readonly count: number;
  /** Quanto mancava in tutto (registrato con conferma): 0 se la merce bastava. */
  readonly missing: number;
}

/**
 * "Registrar ramos hechos": la ricetta × N esce dall'inventario con un registro di uso ("3 ×
 * Ramo Clásico"), al costo medio del momento. Solo gli ingredienti controllati; se la merce non
 * basta serve `confirmShortage`.
 */
export async function recordBouquetsMade(
  ctx: TenantContext,
  bouquetId: string,
  rawInput: unknown,
): Promise<BouquetsMadeResult> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(bouquetId)) throw new NotFoundError('CatalogItem');
  const input = parse(bouquetsMadeSchema, rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const bouquet = await tx.catalogItem.findFirst({
      where: { id: bouquetId, tenantId: ctx.tenantId },
      select: {
        id: true,
        name: true,
        type: true,
        recipe: { select: { lines: { select: { ingredientItemId: true, quantity: true } } } },
      },
    });
    if (!bouquet) return null;
    const recipeLines = bouquet.recipe?.lines ?? [];
    if (bouquet.type !== 'BOUQUET' || recipeLines.length === 0) {
      throw new ConflictError('inventory_bouquet_without_recipe');
    }
    const requested = new Map<string, number>();
    for (const line of recipeLines) {
      const quantity = line.quantity * input.count;
      if (quantity > INVENTORY_LIMITS.quantity)
        throw new ValidationError({ count: 'out_of_range' });
      requested.set(line.ingredientItemId, quantity);
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
    if (check.shortages.length > 0 && !input.confirmShortage) {
      throw new ConflictError('inventory_insufficient_stock');
    }
    const lines: MovementLine[] = [];
    for (const [catalogItemId, quantity] of requested) {
      const item = active.get(catalogItemId);
      if (item) lines.push({ item, quantity: -quantity, unitCostMinor: item.avgUnitCostMinor });
    }
    if (lines.length === 0) return { entryId: null, count: input.count, missing: 0 };
    const written = await writeInventoryEntry(tx, ctx, {
      kind: 'USE',
      note: `${input.count} × ${bouquet.name}`.slice(0, INVENTORY_LIMITS.note),
      lines,
    });
    const missing = check.shortages.reduce((total, line) => total + line.missing, 0);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.inventoryBouquetsMade,
      entityType: 'CatalogItem',
      entityId: bouquet.id,
      metadata: {
        name: bouquet.name,
        units: input.count,
        lines: lines.length,
        missing,
        expectedCostMinor: sumKnown(
          lines.map((line) => stockValue(line.quantity, line.item.catalogCostMinor)),
        ),
        actualCostMinor: sumKnown(
          lines.map((line) => stockValue(line.quantity, line.unitCostMinor)),
        ),
      },
    });
    return { entryId: written.entryId, count: input.count, missing };
  });
  if (!result) return notFound(ctx, 'CatalogItem', bouquetId);
  return result;
}

// -----------------------------------------------------------------------------
// Riepilogo del mese (chi vede i costi)
// -----------------------------------------------------------------------------

export interface MonthValueDto {
  /** Valore al costo reale; null se a qualche riga manca il costo. */
  readonly realMinor: number | null;
  /** Valore ai costi del catalogo del momento (costo previsto); null se ne manca uno. */
  readonly expectedMinor: number | null;
  /** Registri (operazioni) del mese. */
  readonly entries: number;
}

export interface InventoryMonthSummaryDto {
  /** "AAAA-MM" del mese mostrato, del precedente e del successivo (null se è il mese di oggi). */
  readonly month: string;
  readonly previousMonth: string;
  readonly nextMonth: string | null;
  /** Primo giorno del mese, "AAAA-MM-GG" (per scriverne il nome). */
  readonly monthStart: string;
  readonly purchases: { readonly totalMinor: number; readonly entries: number };
  readonly used: MonthValueDto;
  readonly waste: MonthValueDto;
  readonly currency: string;
}

interface MonthRow {
  readonly kind: string;
  readonly entries: number;
  readonly paid: bigint;
  readonly real: bigint;
  readonly realMissing: number;
  readonly expected: bigint;
  readonly expectedMissing: number;
}

function valueOf(row: MonthRow | undefined): MonthValueDto {
  if (!row) return { realMinor: 0, expectedMinor: 0, entries: 0 };
  return {
    realMinor: row.realMissing > 0 ? null : Number(row.real),
    expectedMinor: row.expectedMissing > 0 ? null : Number(row.expected),
    entries: row.entries,
  };
}

/**
 * Riepilogo del mese nel calendario della fioreria: compras (per giorno della compra), usato e
 * mermas (per quando sono successi). I registri annullati e le anulaciones non contano: il
 * riepilogo mostra ciò che resta valido. `month`: "AAAA-MM", passato o di oggi.
 */
export async function getInventoryMonthSummary(
  ctx: TenantContext,
  rawMonth: unknown,
): Promise<InventoryMonthSummaryDto> {
  requirePermission(ctx, 'inventory:read');
  requirePermission(ctx, 'catalog:costs:read');
  const today = todayInTimeZone(ctx.timezone);
  const start = summaryMonth(rawMonth, today);
  const end = nextMonth(start);
  const startIso = toIsoDate(start);
  const endIso = toIsoDate(end);
  const rows = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    return tx.$queryRaw<MonthRow[]>`
      SELECT m."kind"::text AS "kind",
        COUNT(DISTINCT m."entryId")::int AS "entries",
        COALESCE(SUM(m."totalCostMinor"), 0)::bigint AS "paid",
        COALESCE(SUM(ABS(m."quantity")::bigint * m."unitCostMinor"), 0)::bigint AS "real",
        (COUNT(*) FILTER (WHERE m."unitCostMinor" IS NULL))::int AS "realMissing",
        COALESCE(SUM(ABS(m."quantity")::bigint * m."expectedUnitCostMinor"), 0)::bigint AS "expected",
        (COUNT(*) FILTER (WHERE m."expectedUnitCostMinor" IS NULL))::int AS "expectedMissing"
      FROM "InventoryMovement" m
      JOIN "InventoryEntry" e ON e."tenantId" = m."tenantId" AND e."id" = m."entryId"
      WHERE m."tenantId" = ${ctx.tenantId}::uuid
        AND m."kind" IN ('PURCHASE', 'USE', 'WASTE')
        AND NOT EXISTS (
          SELECT 1 FROM "InventoryEntry" r
          WHERE r."tenantId" = e."tenantId" AND r."reversesEntryId" = e."id"
        )
        AND (
          (e."kind" = 'PURCHASE'
            AND e."purchasedOn" >= ${startIso}::date AND e."purchasedOn" < ${endIso}::date)
          OR (e."kind" <> 'PURCHASE'
            AND e."occurredAt" >= ((${startIso}::date)::timestamp AT TIME ZONE ${ctx.timezone}) AT TIME ZONE 'UTC'
            AND e."occurredAt" < ((${endIso}::date)::timestamp AT TIME ZONE ${ctx.timezone}) AT TIME ZONE 'UTC')
        )
      GROUP BY m."kind"`;
  });
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  const purchases = byKind.get('PURCHASE');
  const current = summaryMonth(undefined, today);
  return {
    month: monthParam(start),
    previousMonth: monthParam(addDays(start, -1)),
    nextMonth:
      start.year === current.year && start.month === current.month ? null : monthParam(end),
    monthStart: startIso,
    purchases: {
      totalMinor: purchases ? Number(purchases.paid) : 0,
      entries: purchases?.entries ?? 0,
    },
    used: valueOf(byKind.get('USE')),
    waste: valueOf(byKind.get('WASTE')),
    currency: ctx.currency,
  };
}
