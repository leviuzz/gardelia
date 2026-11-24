/**
 * Mattoni dell'inventario dentro una transazione (ADR-060), condivisi dai servizi dell'inventario
 * e da chi registra il consumo di un ordine.
 *
 *  - La giacenza di un prodotto cambia SOLO qui, insieme al suo movimento, con la riga bloccata
 *    (`FOR UPDATE`, in ordine di id: due operazioni sugli stessi prodotti non si incrociano e non
 *    perdono aggiornamenti).
 *  - Ogni movimento salva la giacenza dopo di sé, il costo reale del momento (costo medio, o il
 *    prezzo della compra) e il costo del catalogo (costo previsto).
 *  - La merce apartada (ADR-062) non cambia la giacenza: si toglie dal disponibile finché
 *    l'apartado vale (`reservedQuantities`).
 *  - Chi chiama ha già controllato permessi e piano.
 */
import { Prisma, type TransactionClient } from '@floral/db';
import {
  INVENTORY_LIMITS,
  availableQuantity,
  isUuid,
  missingQuantity,
  todayInTimeZone,
  type InventoryEntryKind,
  type RecordStatus,
  type SaleUnit,
} from '@floral/domain';
import type { TenantContext } from '../context';
import { ValidationError } from '../errors';

/** Prodotto controllato letto con la riga bloccata, con i dati del catalogo che servono. */
export interface LockedInventoryItem {
  readonly id: string;
  readonly catalogItemId: string;
  readonly onHand: number;
  readonly avgUnitCostMinor: number | null;
  readonly minQuantity: number | null;
  readonly status: RecordStatus;
  readonly currency: string;
  readonly name: string;
  readonly variety: string | null;
  readonly saleUnit: SaleUnit;
  /** Costo del catalogo (costo previsto); null se non compilato. */
  readonly catalogCostMinor: number | null;
}

const lockedSelect = {
  id: true,
  catalogItemId: true,
  onHand: true,
  avgUnitCostMinor: true,
  minQuantity: true,
  status: true,
  currency: true,
  catalogItem: { select: { name: true, variety: true, saleUnit: true, costMinor: true } },
} satisfies Prisma.InventoryItemSelect;

type LockedRow = Prisma.InventoryItemGetPayload<{ select: typeof lockedSelect }>;

function toLocked(row: LockedRow): LockedInventoryItem {
  return {
    id: row.id,
    catalogItemId: row.catalogItemId,
    onHand: row.onHand,
    avgUnitCostMinor: row.avgUnitCostMinor,
    minQuantity: row.minQuantity,
    status: row.status,
    currency: row.currency,
    name: row.catalogItem.name,
    variety: row.catalogItem.variety,
    saleUnit: row.catalogItem.saleUnit,
    catalogCostMinor: row.catalogItem.costMinor,
  };
}

/**
 * Blocca e legge i prodotti controllati indicati (per id o per prodotto del catalogo), solo della
 * fioreria del contesto. Restituisce una mappa per id; chi manca non è nella mappa.
 */
export async function lockInventoryItems(
  tx: TransactionClient,
  ctx: TenantContext,
  by: { readonly ids: readonly string[] } | { readonly catalogItemIds: readonly string[] },
): Promise<Map<string, LockedInventoryItem>> {
  const values = 'ids' in by ? by.ids : by.catalogItemIds;
  if (values.length === 0) return new Map();
  const list = Prisma.join(values.map((value) => Prisma.sql`${value}::uuid`));
  const column = 'ids' in by ? Prisma.sql`"id"` : Prisma.sql`"catalogItemId"`;
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "InventoryItem"
    WHERE "tenantId" = ${ctx.tenantId}::uuid AND ${column} IN (${list})
    ORDER BY "id"
    FOR UPDATE`;
  if (locked.length === 0) return new Map();
  const rows = await tx.inventoryItem.findMany({
    where: { tenantId: ctx.tenantId, id: { in: locked.map((row) => row.id) } },
    select: lockedSelect,
  });
  return new Map(rows.map((row) => [row.id, toLocked(row)]));
}

/** Una riga da registrare: prodotto (bloccato), variazione con segno e costi del momento. */
export interface MovementLine {
  readonly item: LockedInventoryItem;
  readonly quantity: number;
  /** Costo reale per unità di questo movimento (prezzo della compra o costo medio). */
  readonly unitCostMinor: number | null;
  /** Nuovo costo medio del prodotto dopo il movimento (ingressi con costo, anulación di compras). */
  readonly newAvgUnitCostMinor?: number | null;
  /** Solo per le righe di una compra: il totale pagato (ADR-061). */
  readonly totalCostMinor?: number;
}

export interface WrittenEntry {
  readonly entryId: string;
  /** Giacenza di ogni prodotto dopo il registro, per id. */
  readonly balances: ReadonlyMap<string, number>;
}

/**
 * Scrive un registro con le sue righe e aggiorna giacenza (e costo medio) di ogni prodotto, nella
 * transazione di chi chiama. Le righe devono riferirsi a prodotti bloccati con
 * `lockInventoryItems` e diversi fra loro. Una giacenza fuori dai limiti è un errore sulla
 * quantità (il database ha comunque il suo CHECK).
 */
export async function writeInventoryEntry(
  tx: TransactionClient,
  ctx: TenantContext,
  entry: {
    readonly kind: InventoryEntryKind;
    readonly note?: string | null;
    readonly occurredAt?: Date;
    readonly reversesEntryId?: string;
    /** Solo per le compras (ADR-061): proveedor, factura e giorno della compra. */
    readonly purchase?: {
      readonly supplierId: string | null;
      readonly reference: string | null;
      readonly purchasedOn: Date;
    };
    readonly lines: readonly MovementLine[];
  },
): Promise<WrittenEntry> {
  if (entry.lines.length === 0) throw new Error('registro di magazzino senza righe');
  const balances = new Map<string, number>();
  for (const line of entry.lines) {
    const after = line.item.onHand + line.quantity;
    if (Math.abs(after) > INVENTORY_LIMITS.onHand) {
      throw new ValidationError({ quantity: 'out_of_range' });
    }
    balances.set(line.item.id, after);
  }

  const created = await tx.inventoryEntry.create({
    data: {
      tenantId: ctx.tenantId,
      kind: entry.kind,
      note: entry.note ?? null,
      reversesEntryId: entry.reversesEntryId ?? null,
      ...(entry.purchase
        ? {
            supplierId: entry.purchase.supplierId,
            reference: entry.purchase.reference,
            purchasedOn: entry.purchase.purchasedOn,
          }
        : {}),
      createdById: ctx.userId,
      ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
    },
    select: { id: true },
  });
  await tx.inventoryMovement.createMany({
    data: entry.lines.map((line) => ({
      tenantId: ctx.tenantId,
      entryId: created.id,
      kind: entry.kind,
      inventoryItemId: line.item.id,
      quantity: line.quantity,
      balanceAfter: balances.get(line.item.id) ?? line.item.onHand + line.quantity,
      unitCostMinor: line.unitCostMinor,
      expectedUnitCostMinor: line.item.catalogCostMinor,
      totalCostMinor: line.totalCostMinor ?? null,
      currency: line.item.currency,
    })),
  });
  for (const line of entry.lines) {
    await tx.inventoryItem.update({
      where: { id: line.item.id, tenantId: ctx.tenantId },
      data: {
        onHand: balances.get(line.item.id) ?? line.item.onHand + line.quantity,
        ...(line.newAvgUnitCostMinor !== undefined
          ? { avgUnitCostMinor: line.newAvgUnitCostMinor }
          : {}),
      },
    });
  }
  return { entryId: created.id, balances };
}

/** Quanto manca, per un prodotto bloccato, per togliere `quantity` (0 se basta). */
export function missingFor(item: LockedInventoryItem, quantity: number, reserved = 0): number {
  return missingQuantity(quantity, availableQuantity({ onHand: item.onHand, reserved }));
}

/** Oggi nel calendario della fioreria, come una colonna `@db.Date` (mezzanotte UTC). */
export function shopToday(ctx: TenantContext): Date {
  const today = todayInTimeZone(ctx.timezone);
  return new Date(Date.UTC(today.year, today.month - 1, today.day));
}

/**
 * Merce apartada per prodotto (ADR-062): le righe degli apartados ACTIVE che valgono ancora oggi,
 * cioè con la scadenza da oggi in poi nel calendario della fioreria. Un apartado vencido non tiene
 * più merce, senza bisogno di job. `excludeReservationId`: senza l'apartado che si sta usando.
 */
/**
 * Gli apartados che tolgono merce dal disponibile oggi: attivi, non vencidos e già cominciati
 * (`holdsFrom`, per quelli degli ordini: ADR-072).
 */
export function holdingReservationWhere(ctx: TenantContext) {
  const today = shopToday(ctx);
  return {
    tenantId: ctx.tenantId,
    status: 'ACTIVE' as const,
    expiresOn: { gte: today },
    OR: [{ holdsFrom: null }, { holdsFrom: { lte: today } }],
  };
}

export async function reservedQuantities(
  tx: TransactionClient,
  ctx: TenantContext,
  options: {
    readonly inventoryItemIds?: readonly string[];
    readonly excludeReservationId?: string;
  } = {},
): Promise<Map<string, number>> {
  if (options.inventoryItemIds?.length === 0) return new Map();
  const rows = await tx.inventoryReservationLine.groupBy({
    by: ['inventoryItemId'],
    where: {
      tenantId: ctx.tenantId,
      ...(options.inventoryItemIds
        ? { inventoryItemId: { in: [...options.inventoryItemIds] } }
        : {}),
      reservation: {
        ...holdingReservationWhere(ctx),
        ...(options.excludeReservationId ? { id: { not: options.excludeReservationId } } : {}),
      },
    },
    _sum: { quantity: true },
  });
  return new Map(rows.map((row) => [row.inventoryItemId, row._sum.quantity ?? 0]));
}

// -----------------------------------------------------------------------------
// Richieste per prodotto del catalogo (ordini e apartados)
// -----------------------------------------------------------------------------

/** Una riga di richiesta: prodotto del catalogo e quantità nella sua unità di vendita. */
export interface StockRequestLine {
  readonly catalogItemId: string;
  readonly quantity: number;
}

export interface StockCheckLine {
  readonly catalogItemId: string;
  /**
   * false: il prodotto non si controlla, o la fioreria non ha l'inventario nel piano. Nessun
   * avviso: chi compra la merce dopo l'ordine lavora come sempre.
   */
  readonly tracked: boolean;
  readonly inventoryItemId: string | null;
  readonly requested: number;
  readonly onHand: number | null;
  readonly available: number | null;
  /** Quanto manca: sempre 0 per i prodotti non controllati. */
  readonly missing: number;
}

export interface StockCheckResult {
  readonly lines: readonly StockCheckLine[];
  /** Solo i prodotti controllati per cui la merce non basta. */
  readonly shortages: readonly StockCheckLine[];
}

/** Somma le quantità per prodotto (una ricetta può citare lo stesso fiore in più righe). */
export function aggregateRequest(lines: readonly StockRequestLine[]): Map<string, number> {
  const requested = new Map<string, number>();
  for (const line of lines) {
    if (
      !isUuid(line.catalogItemId) ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > INVENTORY_LIMITS.quantity
    ) {
      throw new ValidationError({ lines: 'invalid' });
    }
    requested.set(line.catalogItemId, (requested.get(line.catalogItemId) ?? 0) + line.quantity);
  }
  if (requested.size > INVENTORY_LIMITS.entryLines) {
    throw new ValidationError({ lines: 'too_many_items' });
  }
  return requested;
}

export function checkLines(
  requested: ReadonlyMap<string, number>,
  items: ReadonlyMap<string, { readonly id: string; readonly onHand: number }>,
  reserved: ReadonlyMap<string, number> = new Map(),
): StockCheckResult {
  const lines: StockCheckLine[] = [...requested].map(([catalogItemId, quantity]) => {
    const item = items.get(catalogItemId);
    if (!item) {
      return {
        catalogItemId,
        tracked: false,
        inventoryItemId: null,
        requested: quantity,
        onHand: null,
        available: null,
        missing: 0,
      };
    }
    const available = availableQuantity({
      onHand: item.onHand,
      reserved: reserved.get(item.id) ?? 0,
    });
    return {
      catalogItemId,
      tracked: true,
      inventoryItemId: item.id,
      requested: quantity,
      onHand: item.onHand,
      available,
      missing: missingQuantity(quantity, available),
    };
  });
  return { lines, shortages: lines.filter((line) => line.missing > 0) };
}
