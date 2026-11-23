/**
 * Mattoni dell'inventario dentro una transazione (ADR-060), condivisi dai servizi dell'inventario
 * e da chi registra il consumo di un ordine.
 *
 *  - La giacenza di un prodotto cambia SOLO qui, insieme al suo movimento, con la riga bloccata
 *    (`FOR UPDATE`, in ordine di id: due operazioni sugli stessi prodotti non si incrociano e non
 *    perdono aggiornamenti).
 *  - Ogni movimento salva la giacenza dopo di sé, il costo reale del momento (costo medio, o il
 *    prezzo della compra) e il costo del catalogo (costo previsto).
 *  - Chi chiama ha già controllato permessi e piano.
 */
import { Prisma, type TransactionClient } from '@floral/db';
import {
  INVENTORY_LIMITS,
  availableQuantity,
  missingQuantity,
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
  /** Nuovo costo medio del prodotto dopo il movimento (solo per gli ingressi con costo). */
  readonly newAvgUnitCostMinor?: number | null;
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
