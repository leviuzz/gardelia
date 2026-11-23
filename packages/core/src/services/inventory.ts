/**
 * Inventario [INV-01] (ADR-060): giacenze dei prodotti del catalogo, registri di magazzino e
 * avvisi di scorta.
 *
 *  - Piano Plus (`inventory`); vedere: tutti i ruoli (`inventory:read`), lo staff senza costi;
 *    registrare e scegliere i prodotti: proprietario e manager (`inventory:write`).
 *  - La giacenza cambia solo con un registro (existencia inicial, uso, merma, conteggio,
 *    anulación), con la riga del prodotto bloccata (`inventory-internals.ts`).
 *  - Uno sbaglio non si cancella: si annulla con un registro opposto, una volta sola.
 *  - Se la merce non basta serve una conferma esplicita; la giacenza può scendere sotto zero.
 *  - Per gli ordini (chi li collega): `checkStock`/`checkStockTx` e `consumeStockTx`. Prodotti
 *    non controllati e fiorerie senza inventario passano senza avvisi né registri.
 */
import { getDb, isUniqueViolation, withTenantContext, type Prisma } from '@floral/db';
import type { TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  INVENTORY_ITEM_TYPES,
  INVENTORY_LIMITS,
  INVENTORY_PAGE_SIZE,
  availableQuantity,
  averageCostAfterRemoval,
  inventoryItemSettingsSchema,
  inventoryListFiltersSchema,
  inventoryMovementFiltersSchema,
  inventoryStartFiltersSchema,
  isReversibleEntryKind,
  isStockOutKind,
  isUuid,
  reverseEntrySchema,
  startInventorySchema,
  stockCountSchema,
  stockOutSchema,
  stockStatus,
  stockValue,
  sumKnown,
  toFieldErrors,
  type Availability,
  type CatalogItemType,
  type InventoryEntryKind,
  type RecordStatus,
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
  type StockCheckResult,
  type StockRequestLine,
} from './inventory-internals';

function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

export interface InventoryItemDto {
  readonly id: string;
  readonly catalogItemId: string;
  readonly name: string;
  readonly variety: string | null;
  readonly type: CatalogItemType;
  readonly saleUnit: SaleUnit;
  readonly coverPhotoId: string | null;
  /** Stato del prodotto nel catalogo (un prodotto archiviato resta nell'inventario). */
  readonly catalogStatus: RecordStatus;
  /** Disponibilità scritta nel catalogo: la giacenza non la cambia da sola. */
  readonly catalogAvailability: Availability;
  /** ARCHIVED = la fioreria non lo controlla più. */
  readonly tracking: RecordStatus;
  readonly onHand: number;
  /** Merce apartada che vale oggi (ADR-062): non si può usare per altro. */
  readonly reserved: number;
  readonly available: number;
  readonly minQuantity: number | null;
  readonly status: StockStatus;
  /** Costo reale medio per unità: null per chi non vede i costi o se non è noto. */
  readonly avgUnitCostMinor: number | null;
  /** Costo del catalogo (costo previsto): null per chi non vede i costi o se non compilato. */
  readonly catalogCostMinor: number | null;
  /** Valore della giacenza al costo reale (0 se non ce n'è): null senza costi. */
  readonly valueMinor: number | null;
  readonly currency: string;
  readonly updatedAt: Date;
}

const itemSelect = {
  id: true,
  catalogItemId: true,
  onHand: true,
  avgUnitCostMinor: true,
  minQuantity: true,
  status: true,
  currency: true,
  updatedAt: true,
  catalogItem: {
    select: {
      name: true,
      variety: true,
      type: true,
      saleUnit: true,
      costMinor: true,
      status: true,
      availability: true,
      photos: {
        where: { status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 1,
        select: { id: true },
      },
    },
  },
} satisfies Prisma.InventoryItemSelect;

type ItemRow = Prisma.InventoryItemGetPayload<{ select: typeof itemSelect }>;

function canSeeCosts(ctx: TenantContext): boolean {
  return hasPermission(ctx, 'catalog:costs:read');
}

function valueOf(onHand: number, avgUnitCostMinor: number | null): number | null {
  return onHand > 0 ? stockValue(onHand, avgUnitCostMinor) : 0;
}

function toItemDto(row: ItemRow, ctx: TenantContext, reserved: number): InventoryItemDto {
  const costs = canSeeCosts(ctx);
  const level = { onHand: row.onHand, reserved, minQuantity: row.minQuantity };
  return {
    id: row.id,
    catalogItemId: row.catalogItemId,
    name: row.catalogItem.name,
    variety: row.catalogItem.variety,
    type: row.catalogItem.type,
    saleUnit: row.catalogItem.saleUnit,
    coverPhotoId: row.catalogItem.photos[0]?.id ?? null,
    catalogStatus: row.catalogItem.status,
    catalogAvailability: row.catalogItem.availability,
    tracking: row.status,
    onHand: row.onHand,
    reserved: level.reserved,
    available: availableQuantity(level),
    minQuantity: row.minQuantity,
    status: stockStatus(level),
    avgUnitCostMinor: costs ? row.avgUnitCostMinor : null,
    catalogCostMinor: costs ? row.catalogItem.costMinor : null,
    valueMinor: costs ? valueOf(row.onHand, row.avgUnitCostMinor) : null,
    currency: row.currency,
    updatedAt: row.updatedAt,
  };
}

export interface InventorySummaryDto {
  /** Prodotti controllati. */
  readonly tracked: number;
  /** Prodotti che stanno per finire (al minimo o sotto). */
  readonly low: number;
  /** Prodotti finiti o in negativo. */
  readonly out: number;
  /** Valore della merce al costo reale: null senza costi o se un prodotto non ha costo. */
  readonly valueMinor: number | null;
}

export interface InventoryListResult {
  readonly items: readonly InventoryItemDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly summary: InventorySummaryDto;
  /** Prodotti che non si controllano più (per il link "Ver archivados"). */
  readonly archivedCount: number;
  readonly canWrite: boolean;
  readonly canViewCosts: boolean;
}

/** Existencias: prodotti controllati con stato, ricerca, filtro sugli avvisi e riepilogo. */
export async function listInventory(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<InventoryListResult> {
  requirePermission(ctx, 'inventory:read');
  const filters = inventoryListFiltersSchema.parse(rawFilters ?? {});
  const costs = canSeeCosts(ctx);
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const active = await tx.inventoryItem.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, onHand: true, minQuantity: true, avgUnitCostMinor: true },
    });
    const reserved = await reservedQuantities(tx, ctx);
    const statuses = active.map((row) =>
      stockStatus({ ...row, reserved: reserved.get(row.id) ?? 0 }),
    );
    const summary: InventorySummaryDto = {
      tracked: active.length,
      low: statuses.filter((status) => status === 'LOW').length,
      out: statuses.filter((status) => status === 'OUT').length,
      valueMinor: costs
        ? sumKnown(active.map((row) => valueOf(row.onHand, row.avgUnitCostMinor)))
        : null,
    };
    const archivedCount = await tx.inventoryItem.count({
      where: { tenantId: ctx.tenantId, status: 'ARCHIVED' },
    });

    const rows = await tx.inventoryItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: filters.archived ? 'ARCHIVED' : 'ACTIVE',
        ...(filters.q
          ? {
              catalogItem: {
                OR: [
                  { name: { contains: filters.q, mode: 'insensitive' } },
                  { variety: { contains: filters.q, mode: 'insensitive' } },
                  { sku: { contains: filters.q, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      select: itemSelect,
      orderBy: [{ catalogItem: { type: 'asc' } }, { catalogItem: { name: 'asc' } }, { id: 'asc' }],
    });
    // Lo stato dipende da giacenza, apartados e minimo: si filtra qui (pochi prodotti per fioreria).
    const items = rows
      .map((row) => toItemDto(row, ctx, reserved.get(row.id) ?? 0))
      .filter((item) => filters.archived || !filters.status || item.status === filters.status);
    const pageCount = Math.max(1, Math.ceil(items.length / INVENTORY_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    return {
      items: items.slice((page - 1) * INVENTORY_PAGE_SIZE, page * INVENTORY_PAGE_SIZE),
      total: items.length,
      page,
      pageCount,
      summary,
      archivedCount,
      canWrite: hasPermission(ctx, 'inventory:write'),
      canViewCosts: costs,
    };
  });
}

/** Un apartado che tiene merce di questo prodotto (ADR-062). */
export interface ItemReservationDto {
  readonly id: string;
  readonly label: string;
  /** "AAAA-MM-GG": ultimo giorno in cui vale. */
  readonly expiresOn: string;
  readonly quantity: number;
}

export interface InventoryItemDetailDto extends InventoryItemDto {
  /** C'è almeno una compra (non annullata o no): il costo reale viene dalle compras (ADR-061). */
  readonly hasPurchases: boolean;
  /** Apartados che valgono oggi, dal primo che scade. */
  readonly reservations: readonly ItemReservationDto[];
}

export async function getInventoryItem(
  ctx: TenantContext,
  inventoryItemId: string,
): Promise<InventoryItemDetailDto> {
  requirePermission(ctx, 'inventory:read');
  if (!isUuid(inventoryItemId)) throw new NotFoundError('InventoryItem');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const row = await tx.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId: ctx.tenantId },
      select: itemSelect,
    });
    if (!row) return null;
    const purchases = await tx.inventoryMovement.count({
      where: { tenantId: ctx.tenantId, inventoryItemId: row.id, kind: 'PURCHASE' },
    });
    const holds = await tx.inventoryReservationLine.findMany({
      where: {
        tenantId: ctx.tenantId,
        inventoryItemId: row.id,
        reservation: {
          tenantId: ctx.tenantId,
          status: 'ACTIVE',
          expiresOn: { gte: shopToday(ctx) },
        },
      },
      select: {
        quantity: true,
        reservation: { select: { id: true, label: true, expiresOn: true } },
      },
      orderBy: [{ reservation: { expiresOn: 'asc' } }, { createdAt: 'asc' }],
    });
    return { row, hasPurchases: purchases > 0, holds };
  });
  if (!found) return notFound(ctx, 'InventoryItem', inventoryItemId);
  const reserved = found.holds.reduce((total, hold) => total + hold.quantity, 0);
  return {
    ...toItemDto(found.row, ctx, reserved),
    hasPurchases: found.hasPurchases,
    reservations: found.holds.map((hold) => ({
      id: hold.reservation.id,
      label: hold.reservation.label,
      expiresOn: hold.reservation.expiresOn.toISOString().slice(0, 10),
      quantity: hold.quantity,
    })),
  };
}

/**
 * Riquadro dell'inventario nella scheda di un prodotto del catalogo: null se la fioreria non ha
 * l'inventario nel piano (il riquadro non c'è), `item: null` se il prodotto non si controlla.
 */
export async function getCatalogItemInventory(
  ctx: TenantContext,
  catalogItemId: string,
): Promise<{ readonly item: InventoryItemDto | null; readonly canWrite: boolean } | null> {
  requirePermission(ctx, 'inventory:read');
  if (!isUuid(catalogItemId)) throw new NotFoundError('CatalogItem');
  return withTenantContext(getDb(), ctx, async (tx) => {
    if (!(await getEntitlements(ctx, tx)).inventory) return null;
    const row = await tx.inventoryItem.findFirst({
      where: { catalogItemId, tenantId: ctx.tenantId },
      select: itemSelect,
    });
    const reserved = row ? await reservedQuantities(tx, ctx, { inventoryItemIds: [row.id] }) : null;
    return {
      item: row ? toItemDto(row, ctx, reserved?.get(row.id) ?? 0) : null,
      canWrite: hasPermission(ctx, 'inventory:write'),
    };
  });
}

export interface InventoryMovementDto {
  readonly id: string;
  readonly entryId: string;
  readonly kind: InventoryEntryKind;
  /** Per un'anulación: il tipo del registro annullato. */
  readonly reversesKind: InventoryEntryKind | null;
  readonly quantity: number;
  readonly balanceAfter: number;
  /** Costo reale per unità e valore del movimento: null per chi non vede i costi. */
  readonly unitCostMinor: number | null;
  readonly valueMinor: number | null;
  readonly currency: string;
  readonly note: string | null;
  readonly occurredAt: Date;
  readonly actorName: string | null;
  readonly item: {
    readonly id: string;
    readonly name: string;
    readonly variety: string | null;
    readonly saleUnit: SaleUnit;
  };
  /** Quanti prodotti ha il registro (un'anulación annulla tutto il registro). */
  readonly entryLines: number;
  /** Il registro è già stato annullato. */
  readonly reversed: boolean;
  /** Chi guarda può annullarlo adesso. */
  readonly canReverse: boolean;
}

export interface InventoryMovementListResult {
  readonly movements: readonly InventoryMovementDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

/** Movimenti, i più recenti per primi; di tutti i prodotti o di uno solo. */
export async function listInventoryMovements(
  ctx: TenantContext,
  rawFilters: unknown,
  options: { readonly inventoryItemId?: string } = {},
): Promise<InventoryMovementListResult> {
  requirePermission(ctx, 'inventory:read');
  const filters = inventoryMovementFiltersSchema.parse(rawFilters ?? {});
  if (options.inventoryItemId !== undefined && !isUuid(options.inventoryItemId)) {
    throw new NotFoundError('InventoryItem');
  }
  const costs = canSeeCosts(ctx);
  const canWrite = hasPermission(ctx, 'inventory:write');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const where: Prisma.InventoryMovementWhereInput = {
      tenantId: ctx.tenantId,
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(options.inventoryItemId ? { inventoryItemId: options.inventoryItemId } : {}),
    };
    const total = await tx.inventoryMovement.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const rows = await tx.inventoryMovement.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * INVENTORY_PAGE_SIZE,
      take: INVENTORY_PAGE_SIZE,
      select: {
        id: true,
        entryId: true,
        kind: true,
        quantity: true,
        balanceAfter: true,
        unitCostMinor: true,
        currency: true,
        entry: {
          select: {
            note: true,
            occurredAt: true,
            createdById: true,
            reverses: { select: { kind: true } },
            reversedBy: { select: { id: true } },
            _count: { select: { movements: true } },
          },
        },
        inventoryItem: {
          select: {
            id: true,
            catalogItem: { select: { name: true, variety: true, saleUnit: true } },
          },
        },
      },
    });
    const actorIds = [
      ...new Set(rows.flatMap((row) => (row.entry.createdById ? [row.entry.createdById] : []))),
    ];
    const actors = actorIds.length
      ? await tx.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
    return {
      movements: rows.map((row) => {
        const reversed = row.entry.reversedBy !== null;
        return {
          id: row.id,
          entryId: row.entryId,
          kind: row.kind,
          reversesKind: row.entry.reverses?.kind ?? null,
          quantity: row.quantity,
          balanceAfter: row.balanceAfter,
          unitCostMinor: costs ? row.unitCostMinor : null,
          valueMinor: costs ? stockValue(row.quantity, row.unitCostMinor) : null,
          currency: row.currency,
          note: row.entry.note,
          occurredAt: row.entry.occurredAt,
          actorName: row.entry.createdById ? (actorNames.get(row.entry.createdById) ?? null) : null,
          item: {
            id: row.inventoryItem.id,
            name: row.inventoryItem.catalogItem.name,
            variety: row.inventoryItem.catalogItem.variety,
            saleUnit: row.inventoryItem.catalogItem.saleUnit,
          },
          entryLines: row.entry._count.movements,
          reversed,
          canReverse: canWrite && !reversed && isReversibleEntryKind(row.kind),
        };
      }),
      total,
      page,
      pageCount,
    };
  });
}

export interface ProductToTrackDto {
  readonly catalogItemId: string;
  readonly name: string;
  readonly variety: string | null;
  readonly type: CatalogItemType;
  readonly saleUnit: SaleUnit;
  readonly coverPhotoId: string | null;
  /** Se si controllava prima: la giacenza rimasta (si riparte con un conteggio). */
  readonly previousOnHand: number | null;
}

/** "Elegir productos": prodotti fisici attivi del catalogo che oggi non si controllano. */
export async function listProductsToTrack(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<readonly ProductToTrackDto[]> {
  requirePermission(ctx, 'inventory:write');
  const filters = inventoryStartFiltersSchema.parse(rawFilters ?? {});
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const rows = await tx.catalogItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        type: { in: [...INVENTORY_ITEM_TYPES] },
        OR: [{ inventoryItem: { is: null } }, { inventoryItem: { is: { status: 'ARCHIVED' } } }],
        ...(filters.q
          ? {
              AND: [
                {
                  OR: [
                    { name: { contains: filters.q, mode: 'insensitive' } },
                    { variety: { contains: filters.q, mode: 'insensitive' } },
                    { sku: { contains: filters.q, mode: 'insensitive' } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        variety: true,
        type: true,
        saleUnit: true,
        inventoryItem: { select: { onHand: true } },
        photos: {
          where: { status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          take: 1,
          select: { id: true },
        },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: INVENTORY_LIMITS.startRows,
    });
    return rows.map((row) => ({
      catalogItemId: row.id,
      name: row.name,
      variety: row.variety,
      type: row.type,
      saleUnit: row.saleUnit,
      coverPhotoId: row.photos[0]?.id ?? null,
      previousOnHand: row.inventoryItem?.onHand ?? null,
    }));
  });
}

// -----------------------------------------------------------------------------
// Prodotti controllati
// -----------------------------------------------------------------------------

export interface StartedTracking {
  /** Prodotti che ora si controllano (nuovi o ripresi). */
  readonly started: number;
}

/**
 * Comincia a controllare i prodotti con la quantità scritta: existencia inicial (un registro per
 * tutti, al costo del catalogo, che resta il costo medio fino alla prima compra) e minimo. Un
 * prodotto che si controllava prima riparte dalla giacenza rimasta, con un ajuste se il
 * conteggio è diverso. Quelli già controllati si ignorano (doppio invio).
 */
export async function startInventoryTracking(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<StartedTracking> {
  requirePermission(ctx, 'inventory:write');
  const rows = parse(startInventorySchema, rawInput);
  // Lo stesso prodotto due volte: vale l'ultima riga.
  const byItem = new Map(rows.map((row) => [row.catalogItemId, row]));
  const ids = [...byItem.keys()];

  let result: StartedTracking | { readonly missing: string };
  try {
    result = await withTenantContext(getDb(), ctx, async (tx) => {
      await requireEntitlement(ctx, 'inventory', tx);
      const products = await tx.catalogItem.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ids } },
        select: {
          id: true,
          name: true,
          variety: true,
          type: true,
          status: true,
          saleUnit: true,
          costMinor: true,
          inventoryItem: { select: { id: true, status: true } },
        },
      });
      const found = new Map(products.map((product) => [product.id, product]));
      const missing = ids.find((id) => !found.has(id));
      if (missing) return { missing };

      const fieldErrors: Record<string, 'item_unavailable'> = {};
      rows.forEach((row, index) => {
        const product = found.get(row.catalogItemId);
        if (
          product &&
          (product.status !== 'ACTIVE' ||
            !(INVENTORY_ITEM_TYPES as readonly string[]).includes(product.type))
        ) {
          fieldErrors[`rows.${index}.quantity`] = 'item_unavailable';
        }
      });
      if (Object.keys(fieldErrors).length > 0) throw new ValidationError(fieldErrors);

      const fresh = products.filter((product) => !product.inventoryItem);
      const restarted = products.filter((product) => product.inventoryItem?.status === 'ARCHIVED');

      // Prodotti nuovi: si creano con giacenza zero, poi l'existencia inicial la porta al conteggio.
      const opening: MovementLine[] = [];
      for (const product of fresh) {
        const row = byItem.get(product.id);
        if (!row) continue;
        const created = await tx.inventoryItem.create({
          data: {
            tenantId: ctx.tenantId,
            catalogItemId: product.id,
            currency: ctx.currency,
            avgUnitCostMinor: product.costMinor,
            minQuantity: row.minQuantity,
          },
          select: { id: true },
        });
        if (row.quantity > 0) {
          opening.push({
            item: {
              id: created.id,
              catalogItemId: product.id,
              onHand: 0,
              avgUnitCostMinor: product.costMinor,
              minQuantity: row.minQuantity,
              status: 'ACTIVE',
              currency: ctx.currency,
              name: product.name,
              variety: product.variety,
              saleUnit: product.saleUnit,
              catalogCostMinor: product.costMinor,
            },
            quantity: row.quantity,
            unitCostMinor: product.costMinor,
          });
        }
      }
      if (opening.length > 0) {
        await writeInventoryEntry(tx, ctx, { kind: 'OPENING', lines: opening });
      }

      // Prodotti ripresi: tornano attivi con il nuovo minimo; il conteggio diverso è un ajuste.
      const restartedIds = restarted.flatMap((product) =>
        product.inventoryItem ? [product.inventoryItem.id] : [],
      );
      const locked = await lockInventoryItems(tx, ctx, { ids: restartedIds });
      const adjustments: MovementLine[] = [];
      for (const item of locked.values()) {
        const row = byItem.get(item.catalogItemId);
        if (!row) continue;
        await tx.inventoryItem.update({
          where: { id: item.id, tenantId: ctx.tenantId },
          data: { status: 'ACTIVE', archivedAt: null, minQuantity: row.minQuantity },
        });
        if (row.quantity !== item.onHand) {
          adjustments.push({
            item,
            quantity: row.quantity - item.onHand,
            unitCostMinor: item.avgUnitCostMinor,
          });
        }
      }
      if (adjustments.length > 0) {
        await writeInventoryEntry(tx, ctx, { kind: 'ADJUSTMENT', lines: adjustments });
      }

      const started = fresh.length + restarted.length;
      if (started > 0) {
        const single = started === 1 ? (fresh[0] ?? restarted[0]) : undefined;
        await recordAudit(tx, ctx, {
          action: AUDIT_ACTIONS.inventoryTrackingStarted,
          entityType: 'InventoryItem',
          entityId: null,
          metadata: { units: started, ...(single ? { name: single.name } : {}) },
        });
      }
      return { started };
    });
  } catch (error) {
    // Due persone che avviano lo stesso prodotto nello stesso istante: il secondo invio si ferma.
    if (isUniqueViolation(error, 'catalogItemId')) {
      throw new ConflictError('inventory_already_tracked');
    }
    throw error;
  }
  if ('missing' in result) return notFound(ctx, 'CatalogItem', result.missing);
  return result;
}

/** Minimo ("Avísame cuando queden") di un prodotto controllato. */
export async function updateInventoryItemSettings(
  ctx: TenantContext,
  inventoryItemId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(inventoryItemId)) throw new NotFoundError('InventoryItem');
  const input = parse(inventoryItemSettingsSchema, rawInput);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const existing = await tx.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId: ctx.tenantId },
      select: { id: true, minQuantity: true, catalogItem: { select: { name: true } } },
    });
    if (!existing) return false;
    if (existing.minQuantity === input.minQuantity) return true;
    await tx.inventoryItem.update({
      where: { id: existing.id, tenantId: ctx.tenantId },
      data: { minQuantity: input.minQuantity },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.inventoryItemUpdated,
      entityType: 'InventoryItem',
      entityId: existing.id,
      metadata: {
        name: existing.catalogItem.name,
        changes: { minQuantity: { from: existing.minQuantity, to: input.minQuantity } },
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'InventoryItem', inventoryItemId);
}

/**
 * Smettere di controllare un prodotto: si archivia, giacenza e storico restano. Si riprende da
 * "Elegir productos" con un conteggio.
 */
export async function stopInventoryTracking(
  ctx: TenantContext,
  inventoryItemId: string,
): Promise<void> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(inventoryItemId)) throw new NotFoundError('InventoryItem');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const item = (await lockInventoryItems(tx, ctx, { ids: [inventoryItemId] })).get(
      inventoryItemId,
    );
    if (!item) return false;
    if (item.status === 'ARCHIVED') return true;
    await tx.inventoryItem.update({
      where: { id: item.id, tenantId: ctx.tenantId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.inventoryTrackingStopped,
      entityType: 'InventoryItem',
      entityId: item.id,
      metadata: { name: item.name },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'InventoryItem', inventoryItemId);
}

// -----------------------------------------------------------------------------
// Movimenti registrati a mano
// -----------------------------------------------------------------------------

/** Prodotto controllato e attivo, bloccato; null se non è della fioreria. */
async function lockActiveItem(
  tx: TransactionClient,
  ctx: TenantContext,
  inventoryItemId: string,
): Promise<LockedInventoryItem | null> {
  const item = (await lockInventoryItems(tx, ctx, { ids: [inventoryItemId] })).get(inventoryItemId);
  if (!item) return null;
  if (item.status !== 'ACTIVE') throw new ConflictError('inventory_item_archived');
  return item;
}

export interface StockOutResult {
  readonly onHand: number;
  readonly saleUnit: SaleUnit;
  /** Quanto mancava (registrato con conferma): 0 se la merce bastava. */
  readonly missing: number;
}

/**
 * Uso (ramo fatto, venduta) o merma (buttata) di un prodotto. Se la merce non basta serve
 * `confirmShortage`: la giacenza scende sotto zero. Il costo è il costo medio del momento.
 */
export async function recordStockOut(
  ctx: TenantContext,
  inventoryItemId: string,
  kind: unknown,
  rawInput: unknown,
): Promise<StockOutResult> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(inventoryItemId)) throw new NotFoundError('InventoryItem');
  if (!isStockOutKind(kind)) throw new ValidationError({ kind: 'invalid_option' });
  const input = parse(stockOutSchema, rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const item = await lockActiveItem(tx, ctx, inventoryItemId);
    if (!item) return null;
    const reserved = await reservedQuantities(tx, ctx, { inventoryItemIds: [item.id] });
    const missing = missingFor(item, input.quantity, reserved.get(item.id) ?? 0);
    if (missing > 0 && !input.confirmShortage) {
      throw new ConflictError('inventory_insufficient_stock');
    }
    const written = await writeInventoryEntry(tx, ctx, {
      kind,
      note: input.note,
      lines: [{ item, quantity: -input.quantity, unitCostMinor: item.avgUnitCostMinor }],
    });
    await recordAudit(tx, ctx, {
      action:
        kind === 'USE' ? AUDIT_ACTIONS.inventoryStockUsed : AUDIT_ACTIONS.inventoryStockWasted,
      entityType: 'InventoryItem',
      entityId: item.id,
      metadata: { name: item.name, units: input.quantity, missing },
    });
    return {
      onHand: written.balances.get(item.id) ?? item.onHand - input.quantity,
      saleUnit: item.saleUnit,
      missing,
    };
  });
  if (!result) return notFound(ctx, 'InventoryItem', inventoryItemId);
  return result;
}

export interface StockCountResult {
  readonly onHand: number;
  readonly saleUnit: SaleUnit;
  /** Differenza registrata (0 = il conteggio coincideva, nessun registro). */
  readonly delta: number;
}

/** Conteggio fisico: si scrive quanti ce ne sono e si registra la differenza come ajuste. */
export async function recordStockCount(
  ctx: TenantContext,
  inventoryItemId: string,
  rawInput: unknown,
): Promise<StockCountResult> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(inventoryItemId)) throw new NotFoundError('InventoryItem');
  const input = parse(stockCountSchema, rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const item = await lockActiveItem(tx, ctx, inventoryItemId);
    if (!item) return null;
    const delta = input.countedQuantity - item.onHand;
    if (delta === 0) return { onHand: item.onHand, saleUnit: item.saleUnit, delta };
    await writeInventoryEntry(tx, ctx, {
      kind: 'ADJUSTMENT',
      note: input.note,
      lines: [{ item, quantity: delta, unitCostMinor: item.avgUnitCostMinor }],
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.inventoryStockCounted,
      entityType: 'InventoryItem',
      entityId: item.id,
      metadata: { name: item.name, from: item.onHand, units: input.countedQuantity },
    });
    return { onHand: input.countedQuantity, saleUnit: item.saleUnit, delta };
  });
  if (!result) return notFound(ctx, 'InventoryItem', inventoryItemId);
  return result;
}

/**
 * Annulla un registro sbagliato con un registro opposto (mai una cancellazione), una volta sola.
 * Se così la merce non basta (es. un ajuste che aveva aggiunto merce già usata) serve
 * `confirmShortage`: nella UI la finestra di conferma vale come conferma.
 */
export async function reverseInventoryEntry(
  ctx: TenantContext,
  entryId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(entryId)) throw new NotFoundError('InventoryEntry');
  const input = parse(reverseEntrySchema, rawInput);
  let found: boolean;
  try {
    found = await withTenantContext(getDb(), ctx, async (tx) => {
      await requireEntitlement(ctx, 'inventory', tx);
      const entry = await tx.inventoryEntry.findFirst({
        where: { id: entryId, tenantId: ctx.tenantId },
        select: {
          id: true,
          kind: true,
          reversedBy: { select: { id: true } },
          movements: {
            select: {
              inventoryItemId: true,
              quantity: true,
              unitCostMinor: true,
              totalCostMinor: true,
            },
          },
        },
      });
      if (!entry) return false;
      if (!isReversibleEntryKind(entry.kind)) {
        throw new ConflictError('inventory_entry_not_reversible');
      }
      if (entry.reversedBy) throw new ConflictError('inventory_entry_already_reversed');

      const locked = await lockInventoryItems(tx, ctx, {
        ids: entry.movements.map((movement) => movement.inventoryItemId),
      });
      const reserved = await reservedQuantities(tx, ctx, { inventoryItemIds: [...locked.keys()] });
      const lines: MovementLine[] = entry.movements.map((movement) => {
        const item = locked.get(movement.inventoryItemId);
        if (!item) throw new Error('movimento senza prodotto controllato');
        const quantity = -movement.quantity;
        const shortage = missingFor(item, -quantity, reserved.get(item.id) ?? 0) > 0;
        if (quantity < 0 && shortage && !input.confirmShortage) {
          throw new ConflictError('inventory_insufficient_stock');
        }
        // Una compra annullata esce dal costo medio, al prezzo pagato (ADR-061).
        const removedCost =
          entry.kind === 'PURCHASE'
            ? (movement.totalCostMinor ?? stockValue(movement.quantity, movement.unitCostMinor))
            : null;
        return {
          item,
          quantity,
          unitCostMinor: movement.unitCostMinor,
          ...(removedCost !== null
            ? {
                newAvgUnitCostMinor: averageCostAfterRemoval(item, {
                  quantity: movement.quantity,
                  totalCostMinor: removedCost,
                }),
              }
            : {}),
        };
      });
      await writeInventoryEntry(tx, ctx, { kind: 'REVERSAL', reversesEntryId: entry.id, lines });
      const single = lines.length === 1 ? lines[0] : undefined;
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.inventoryEntryReversed,
        entityType: 'InventoryEntry',
        entityId: entry.id,
        metadata: {
          kind: entry.kind,
          lines: lines.length,
          ...(single ? { name: single.item.name, units: Math.abs(single.quantity) } : {}),
        },
      });
      return true;
    });
  } catch (error) {
    // Due anulaciones dello stesso registro nello stesso istante: vince la prima.
    if (isUniqueViolation(error, 'reversesEntryId')) {
      throw new ConflictError('inventory_entry_already_reversed');
    }
    throw error;
  }
  if (!found) await notFound(ctx, 'InventoryEntry', entryId);
}

// -----------------------------------------------------------------------------
// Per gli ordini (chi li collega): verifica e consumo riusabili nella sua transazione
// -----------------------------------------------------------------------------

export type { StockCheckLine, StockCheckResult, StockRequestLine } from './inventory-internals';

/** Basta la merce? Dentro la transazione di chi chiama, che ha già controllato i suoi permessi. */
export async function checkStockTx(
  tx: TransactionClient,
  ctx: TenantContext,
  lines: readonly StockRequestLine[],
): Promise<StockCheckResult> {
  const requested = aggregateRequest(lines);
  if (requested.size === 0 || !(await getEntitlements(ctx, tx)).inventory) {
    return checkLines(requested, new Map());
  }
  const items = await tx.inventoryItem.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: 'ACTIVE',
      catalogItemId: { in: [...requested.keys()] },
    },
    select: { id: true, catalogItemId: true, onHand: true },
  });
  const reserved = await reservedQuantities(tx, ctx, {
    inventoryItemIds: items.map((item) => item.id),
  });
  return checkLines(requested, new Map(items.map((item) => [item.catalogItemId, item])), reserved);
}

/** Basta la merce? Per mostrare l'avviso prima di confermare (es. un ordine). */
export async function checkStock(
  ctx: TenantContext,
  lines: readonly StockRequestLine[],
): Promise<StockCheckResult> {
  requirePermission(ctx, 'inventory:read');
  return withTenantContext(getDb(), ctx, (tx) => checkStockTx(tx, ctx, lines));
}

export interface ConsumeStockInput {
  readonly lines: readonly StockRequestLine[];
  readonly note?: string | null;
  /** Registrare anche se la merce non basta: la giacenza scende sotto zero. */
  readonly confirmShortage: boolean;
}

export interface ConsumeStockResult {
  /** Registro di uso creato; null se nessun prodotto si controlla (niente da registrare). */
  readonly entryId: string | null;
  readonly lines: readonly StockCheckLine[];
  /** Costo dei materiali dei prodotti controllati: previsto (catalogo) e reale (costo medio). */
  readonly expectedCostMinor: number | null;
  readonly actualCostMinor: number | null;
}

/**
 * Scarica dall'inventario quanto usato (es. i materiali di un ordine), nella transazione di chi
 * chiama. NON controlla permessi né piano dell'inventario: li ha controllati chi chiama (es.
 * `orders:fulfill`, che ha anche lo staff); senza il piano, o per i prodotti non controllati, non
 * registra nulla. Se la merce non basta e manca `confirmShortage`: `inventory_insufficient_stock`.
 */
export async function consumeStockTx(
  tx: TransactionClient,
  ctx: TenantContext,
  input: ConsumeStockInput,
): Promise<ConsumeStockResult> {
  const requested = aggregateRequest(input.lines);
  const note = input.note?.trim().slice(0, INVENTORY_LIMITS.note) || null;
  if (requested.size === 0 || !(await getEntitlements(ctx, tx)).inventory) {
    return {
      entryId: null,
      lines: checkLines(requested, new Map()).lines,
      expectedCostMinor: null,
      actualCostMinor: null,
    };
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
  if (lines.length === 0) {
    return { entryId: null, lines: check.lines, expectedCostMinor: null, actualCostMinor: null };
  }
  const written = await writeInventoryEntry(tx, ctx, { kind: 'USE', note, lines });
  const single = lines.length === 1 ? lines[0] : undefined;
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.inventoryStockUsed,
    entityType: 'InventoryEntry',
    entityId: written.entryId,
    metadata: {
      lines: lines.length,
      units: lines.reduce((total, line) => total - line.quantity, 0),
      ...(single ? { name: single.item.name } : {}),
    },
  });
  return {
    entryId: written.entryId,
    lines: check.lines,
    expectedCostMinor: sumKnown(
      lines.map((line) => stockValue(line.quantity, line.item.catalogCostMinor)),
    ),
    actualCostMinor: sumKnown(lines.map((line) => stockValue(line.quantity, line.unitCostMinor))),
  };
}
