/**
 * Compras al mayorista e proveedores (ADR-061), secondo blocco dell'inventario (ADR-060).
 *
 *  - Solo proprietario e manager (`inventory:write`): le compras hanno i prezzi, che lo staff non vede.
 *  - Una compra è un registro PURCHASE: proveedor facoltativo (anche nuovo, creato nella stessa
 *    transazione), giorno (mai nel futuro, nel calendario della fioreria), factura o nota e una riga
 *    per prodotto con quantità e totale pagato. Lo stesso prodotto in più righe si somma.
 *  - Ogni riga aggiorna il costo medio del prodotto (costo reale); annullare la compra lo toglie
 *    di nuovo (`reverseInventoryEntry`).
 *  - "Usar este costo": il costo reale diventa il costo del catalogo con un clic, mai da solo.
 *  - I proveedores si archiviano, non si cancellano.
 */
import { getDb, withTenantContext, type Prisma } from '@floral/db';
import {
  AUDIT_ACTIONS,
  INVENTORY_PAGE_SIZE,
  averageCostAfterReceipt,
  isUuid,
  purchaseInputSchema,
  purchaseListFiltersSchema,
  supplierInputSchema,
  todayInTimeZone,
  toFieldErrors,
  unitCostOf,
  type CatalogItemType,
  type RecordStatus,
  type SaleUnit,
} from '@floral/domain';
import type { ZodType } from 'zod';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { requireEntitlement } from './billing';
import { lockInventoryItems, writeInventoryEntry, type MovementLine } from './inventory-internals';
import { dateToParts, formatDateParts, partsToDate } from './quote-internals';

function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

// -----------------------------------------------------------------------------
// Proveedores
// -----------------------------------------------------------------------------

export interface SupplierDto {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly status: RecordStatus;
  /** Compras registrate con questo proveedor. */
  readonly purchases: number;
}

const supplierSelect = {
  id: true,
  name: true,
  phone: true,
  notes: true,
  status: true,
  _count: { select: { purchases: true } },
} satisfies Prisma.SupplierSelect;

function toSupplierDto(row: Prisma.SupplierGetPayload<{ select: typeof supplierSelect }>) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    status: row.status,
    purchases: row._count.purchases,
  } satisfies SupplierDto;
}

export async function listSuppliers(
  ctx: TenantContext,
  options: { readonly includeArchived?: boolean } = {},
): Promise<readonly SupplierDto[]> {
  requirePermission(ctx, 'inventory:write');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const rows = await tx.supplier.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(options.includeArchived ? {} : { status: 'ACTIVE' }),
      },
      select: supplierSelect,
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toSupplierDto);
  });
}

export async function createSupplier(ctx: TenantContext, rawInput: unknown): Promise<SupplierDto> {
  requirePermission(ctx, 'inventory:write');
  const input = parse(supplierInputSchema(ctx.country), rawInput);
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const created = await tx.supplier.create({
      data: { tenantId: ctx.tenantId, ...input },
      select: supplierSelect,
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.inventorySupplierCreated,
      entityType: 'Supplier',
      entityId: created.id,
      metadata: { name: created.name },
    });
    return toSupplierDto(created);
  });
}

export async function updateSupplier(
  ctx: TenantContext,
  supplierId: string,
  rawInput: unknown,
): Promise<SupplierDto> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(supplierId)) throw new NotFoundError('Supplier');
  const input = parse(supplierInputSchema(ctx.country), rawInput);
  const updated = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const existing = await tx.supplier.findFirst({
      where: { id: supplierId, tenantId: ctx.tenantId },
      select: { id: true, name: true, phone: true, notes: true },
    });
    if (!existing) return null;
    const row = await tx.supplier.update({
      where: { id: existing.id, tenantId: ctx.tenantId },
      data: input,
      select: supplierSelect,
    });
    // Solo i nomi dei campi cambiati: il telefono non va nei metadati.
    const changedFields = (['name', 'phone', 'notes'] as const).filter(
      (field) => existing[field] !== input[field],
    );
    if (changedFields.length > 0) {
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.inventorySupplierUpdated,
        entityType: 'Supplier',
        entityId: existing.id,
        metadata: { name: row.name, changedFields },
      });
    }
    return toSupplierDto(row);
  });
  if (!updated) return notFound(ctx, 'Supplier', supplierId);
  return updated;
}

export async function setSupplierArchived(
  ctx: TenantContext,
  supplierId: string,
  archived: boolean,
): Promise<void> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(supplierId)) throw new NotFoundError('Supplier');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const existing = await tx.supplier.findFirst({
      where: { id: supplierId, tenantId: ctx.tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!existing) return false;
    const status: RecordStatus = archived ? 'ARCHIVED' : 'ACTIVE';
    if (existing.status === status) return true;
    await tx.supplier.update({
      where: { id: existing.id, tenantId: ctx.tenantId },
      data: { status, archivedAt: archived ? new Date() : null },
    });
    await recordAudit(tx, ctx, {
      action: archived
        ? AUDIT_ACTIONS.inventorySupplierArchived
        : AUDIT_ACTIONS.inventorySupplierRestored,
      entityType: 'Supplier',
      entityId: existing.id,
      metadata: { name: existing.name },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Supplier', supplierId);
}

// -----------------------------------------------------------------------------
// Compras
// -----------------------------------------------------------------------------

/**
 * Registra una compra: la merce entra, il costo medio di ogni prodotto si aggiorna con quanto si
 * è pagato. Un proveedor nuovo (solo il nome) si crea nella stessa transazione.
 */
export async function recordPurchase(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ readonly entryId: string }> {
  requirePermission(ctx, 'inventory:write');
  const input = parse(purchaseInputSchema(ctx.currency), rawInput);
  const today = todayInTimeZone(ctx.timezone);
  const purchasedOn = input.purchasedOn ?? today;
  if (partsToDate(purchasedOn) > partsToDate(today)) {
    throw new ValidationError({ purchasedOn: 'out_of_range' });
  }
  // Lo stesso prodotto in più righe: quantità e totali si sommano.
  const byItem = new Map<string, { quantity: number; total: number }>();
  for (const line of input.lines) {
    const current = byItem.get(line.inventoryItemId) ?? { quantity: 0, total: 0 };
    byItem.set(line.inventoryItemId, {
      quantity: current.quantity + line.quantity,
      total: current.total + line.total,
    });
  }

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    let supplierId: string | null = null;
    if (input.supplierId) {
      const supplier = await tx.supplier.findFirst({
        where: { id: input.supplierId, tenantId: ctx.tenantId },
        select: { id: true, status: true },
      });
      if (!supplier) return { missing: { entity: 'Supplier' as const, id: input.supplierId } };
      if (supplier.status !== 'ACTIVE') throw new ValidationError({ supplierId: 'invalid_option' });
      supplierId = supplier.id;
    } else if (input.newSupplierName) {
      const created = await tx.supplier.create({
        data: { tenantId: ctx.tenantId, name: input.newSupplierName },
        select: { id: true, name: true },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.inventorySupplierCreated,
        entityType: 'Supplier',
        entityId: created.id,
        metadata: { name: created.name },
      });
      supplierId = created.id;
    }

    const locked = await lockInventoryItems(tx, ctx, { ids: [...byItem.keys()] });
    const missing = [...byItem.keys()].find((id) => !locked.has(id));
    if (missing) return { missing: { entity: 'InventoryItem' as const, id: missing } };
    const lines: MovementLine[] = [];
    for (const [id, line] of byItem) {
      const item = locked.get(id);
      if (!item) continue;
      if (item.status !== 'ACTIVE') throw new ConflictError('inventory_item_archived');
      lines.push({
        item,
        quantity: line.quantity,
        unitCostMinor: unitCostOf(line.total, line.quantity),
        totalCostMinor: line.total,
        newAvgUnitCostMinor: averageCostAfterReceipt(item, {
          quantity: line.quantity,
          totalCostMinor: line.total,
        }),
      });
    }
    const written = await writeInventoryEntry(tx, ctx, {
      kind: 'PURCHASE',
      purchase: { supplierId, reference: input.reference, purchasedOn: partsToDate(purchasedOn) },
      lines,
    });
    const single = lines.length === 1 ? lines[0] : undefined;
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.inventoryPurchaseRecorded,
      entityType: 'InventoryEntry',
      entityId: written.entryId,
      metadata: {
        lines: lines.length,
        units: lines.reduce((total, line) => total + line.quantity, 0),
        ...(single ? { name: single.item.name } : {}),
      },
    });
    return { entryId: written.entryId };
  });
  if (result.missing) return notFound(ctx, result.missing.entity, result.missing.id);
  return { entryId: result.entryId };
}

export interface PurchaseSummaryDto {
  readonly entryId: string;
  /** Giorno della compra ("AAAA-MM-GG"). */
  readonly purchasedOn: string;
  readonly supplierName: string | null;
  readonly reference: string | null;
  readonly lines: number;
  readonly totalMinor: number;
  readonly currency: string;
  /** La compra è stata annullata. */
  readonly reversed: boolean;
}

const purchaseInclude = {
  supplier: { select: { name: true } },
  reversedBy: { select: { id: true } },
  movements: {
    select: {
      quantity: true,
      unitCostMinor: true,
      totalCostMinor: true,
      currency: true,
      inventoryItemId: true,
      inventoryItem: {
        select: { catalogItem: { select: { name: true, variety: true, saleUnit: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.InventoryEntryInclude;

type PurchaseRow = Prisma.InventoryEntryGetPayload<{ include: typeof purchaseInclude }>;

function lineTotal(line: PurchaseRow['movements'][number]): number {
  return line.totalCostMinor ?? line.quantity * (line.unitCostMinor ?? 0);
}

function toSummary(row: PurchaseRow, currency: string): PurchaseSummaryDto {
  return {
    entryId: row.id,
    purchasedOn: formatDateParts(dateToParts(row.purchasedOn)) ?? '',
    supplierName: row.supplier?.name ?? null,
    reference: row.reference,
    lines: row.movements.length,
    totalMinor: row.movements.reduce((total, line) => total + lineTotal(line), 0),
    currency: row.movements[0]?.currency ?? currency,
    reversed: row.reversedBy !== null,
  };
}

export interface PurchaseListResult {
  readonly purchases: readonly PurchaseSummaryDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

/** Compras, le più recenti per prime; si cercano per proveedor o factura. */
export async function listPurchases(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<PurchaseListResult> {
  requirePermission(ctx, 'inventory:write');
  const filters = purchaseListFiltersSchema.parse(rawFilters ?? {});
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const where: Prisma.InventoryEntryWhereInput = {
      tenantId: ctx.tenantId,
      kind: 'PURCHASE',
      ...(filters.q
        ? {
            OR: [
              { reference: { contains: filters.q, mode: 'insensitive' } },
              { supplier: { name: { contains: filters.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const total = await tx.inventoryEntry.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const rows = await tx.inventoryEntry.findMany({
      where,
      include: purchaseInclude,
      orderBy: [{ purchasedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * INVENTORY_PAGE_SIZE,
      take: INVENTORY_PAGE_SIZE,
    });
    return {
      purchases: rows.map((row) => toSummary(row, ctx.currency)),
      total,
      page,
      pageCount,
    };
  });
}

export interface PurchaseLineDto {
  readonly inventoryItemId: string;
  readonly name: string;
  readonly variety: string | null;
  readonly saleUnit: SaleUnit;
  readonly quantity: number;
  readonly unitCostMinor: number | null;
  readonly totalCostMinor: number;
}

export interface PurchaseDetailDto extends PurchaseSummaryDto {
  readonly purchaseLines: readonly PurchaseLineDto[];
  readonly actorName: string | null;
  readonly canReverse: boolean;
}

export async function getPurchase(ctx: TenantContext, entryId: string): Promise<PurchaseDetailDto> {
  requirePermission(ctx, 'inventory:write');
  if (!isUuid(entryId)) throw new NotFoundError('InventoryEntry');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const row = await tx.inventoryEntry.findFirst({
      where: { id: entryId, tenantId: ctx.tenantId, kind: 'PURCHASE' },
      include: purchaseInclude,
    });
    if (!row) return null;
    const actor = row.createdById
      ? await tx.user.findUnique({ where: { id: row.createdById }, select: { name: true } })
      : null;
    return { row, actorName: actor?.name ?? null };
  });
  if (!found) return notFound(ctx, 'InventoryEntry', entryId);
  const summary = toSummary(found.row, ctx.currency);
  return {
    ...summary,
    purchaseLines: found.row.movements.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      name: line.inventoryItem.catalogItem.name,
      variety: line.inventoryItem.catalogItem.variety,
      saleUnit: line.inventoryItem.catalogItem.saleUnit,
      quantity: line.quantity,
      unitCostMinor: line.unitCostMinor,
      totalCostMinor: lineTotal(line),
    })),
    actorName: found.actorName,
    canReverse: !summary.reversed && hasPermission(ctx, 'inventory:write'),
  };
}

/**
 * "Usar este costo": il costo reale (medio) di un prodotto diventa il costo del suo catalogo. Il
 * valore lo legge il server, mai il client; serve anche `catalog:write`.
 */
export async function applyRealCostToCatalog(
  ctx: TenantContext,
  inventoryItemId: string,
): Promise<{ readonly costMinor: number }> {
  requirePermission(ctx, 'inventory:write');
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(inventoryItemId)) throw new NotFoundError('InventoryItem');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const item = await tx.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId: ctx.tenantId },
      select: {
        id: true,
        avgUnitCostMinor: true,
        catalogItem: { select: { id: true, name: true, costMinor: true } },
      },
    });
    if (!item) return null;
    if (item.avgUnitCostMinor === null) throw new ConflictError('inventory_no_real_cost');
    if (item.catalogItem.costMinor !== item.avgUnitCostMinor) {
      await tx.catalogItem.update({
        where: { id: item.catalogItem.id, tenantId: ctx.tenantId },
        data: { costMinor: item.avgUnitCostMinor },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.inventoryRealCostApplied,
        entityType: 'CatalogItem',
        entityId: item.catalogItem.id,
        metadata: {
          name: item.catalogItem.name,
          changes: { costMinor: { from: item.catalogItem.costMinor, to: item.avgUnitCostMinor } },
        },
      });
    }
    return { costMinor: item.avgUnitCostMinor };
  });
  if (!result) return notFound(ctx, 'InventoryItem', inventoryItemId);
  return result;
}

export interface TrackedProductOption {
  readonly inventoryItemId: string;
  readonly name: string;
  readonly variety: string | null;
  readonly type: CatalogItemType;
  readonly saleUnit: SaleUnit;
}

/** Prodotti controllati (attivi) da scegliere in una compra, nell'ordine del catalogo. */
export async function listTrackedProductOptions(
  ctx: TenantContext,
): Promise<readonly TrackedProductOption[]> {
  requirePermission(ctx, 'inventory:write');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'inventory', tx);
    const rows = await tx.inventoryItem.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: {
        id: true,
        catalogItem: { select: { name: true, variety: true, type: true, saleUnit: true } },
      },
      orderBy: [{ catalogItem: { type: 'asc' } }, { catalogItem: { name: 'asc' } }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      inventoryItemId: row.id,
      name: row.catalogItem.name,
      variety: row.catalogItem.variety,
      type: row.catalogItem.type,
      saleUnit: row.catalogItem.saleUnit,
    }));
  });
}
