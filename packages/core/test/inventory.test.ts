/**
 * Inventario (ADR-060): giacenze dei prodotti scelti, registri (existencia inicial, uso, merma,
 * conteggio, anulación), avvisi di scorta, permessi, piano, isolamento A↔B e le funzioni
 * riusabili per gli ordini.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  checkStock,
  consumeStockTx,
  createCatalogItem,
  getCatalogItemInventory,
  getInventoryItem,
  listInventory,
  listInventoryMovements,
  listProductsToTrack,
  recordStockCount,
  recordStockOut,
  reverseInventoryEntry,
  startInventoryTracking,
  stopInventoryTracking,
  updateInventoryItemSettings,
  type CatalogItemDto,
  type TenantContext,
} from '../src/index';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
let operatorEmail: string;

async function plusShop(name?: string): Promise<TestShop> {
  const shop = await createTestShop(name);
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  return shop;
}

interface Kit {
  readonly shop: TestShop;
  readonly rose: CatalogItemDto;
  readonly paper: CatalogItemDto;
}

async function createKit(name?: string): Promise<Kit> {
  const shop = await plusShop(name);
  const rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', costMinor: 1400 }),
  );
  const paper = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'PACKAGING',
      name: 'Papel kraft',
      variety: null,
      colors: ['brown'],
      saleUnit: 'PIECE',
      costMinor: null,
      heightCm: null,
      tags: [],
    }),
  );
  return { shop, rose, paper };
}

/** Comincia a controllare un prodotto con la quantità data; restituisce l'id nell'inventario. */
async function track(
  ctx: TenantContext,
  catalogItemId: string,
  quantity: number,
  minQuantity = '',
): Promise<string> {
  await startInventoryTracking(ctx, {
    rows: { '0': { catalogItemId, quantity: String(quantity), minQuantity } },
  });
  const inventory = await getCatalogItemInventory(ctx, catalogItemId);
  if (!inventory?.item) throw new Error('prodotto non avviato');
  return inventory.item.id;
}

async function movementsOf(ctx: TenantContext, inventoryItemId: string) {
  return (await listInventoryMovements(ctx, {}, { inventoryItemId })).movements;
}

/** La giacenza è sempre la somma dei suoi movimenti e coincide con l'ultimo saldo. */
async function expectConsistent(inventoryItemId: string) {
  const { item, movements } = await withSystemContext(
    db,
    { reason: 'test: invariante' },
    async (tx) => ({
      item: await tx.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } }),
      movements: await tx.inventoryMovement.findMany({
        where: { inventoryItemId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    }),
  );
  const sum = movements.reduce((total, movement) => total + movement.quantity, 0);
  expect(item.onHand).toBe(sum);
  expect(movements.at(-1)?.balanceAfter ?? 0).toBe(item.onHand);
}

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador Inventario' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
});

afterAll(async () => {
  await disconnectDb();
});

describe('cominciare a controllare', () => {
  it('existencia inicial al costo del catalogo, minimo e solo i prodotti con la quantità', async () => {
    const kit = await createKit();
    const bouquet = await createCatalogItem(
      kit.shop.owner,
      itemInput({ type: 'BOUQUET', name: 'Ramo clásico', saleUnit: 'PIECE', colors: [], tags: [] }),
    );
    const toTrack = await listProductsToTrack(kit.shop.owner, {});
    expect(toTrack.map((product) => product.catalogItemId).sort()).toEqual(
      [kit.rose.id, kit.paper.id].sort(),
    );
    expect(toTrack.some((product) => product.catalogItemId === bouquet.id)).toBe(false);

    const started = await startInventoryTracking(kit.shop.owner, {
      rows: {
        '0': { catalogItemId: kit.rose.id, quantity: '50', minQuantity: '20' },
        '1': { catalogItemId: kit.paper.id, quantity: '', minQuantity: '' },
      },
    });
    expect(started).toEqual({ started: 1 });

    const list = await listInventory(kit.shop.owner, {});
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      catalogItemId: kit.rose.id,
      onHand: 50,
      available: 50,
      minQuantity: 20,
      status: 'OK',
      avgUnitCostMinor: 1400,
      catalogCostMinor: 1400,
      valueMinor: 70_000,
      tracking: 'ACTIVE',
    });
    expect(list.summary).toEqual({ tracked: 1, low: 0, out: 0, valueMinor: 70_000 });
    expect(list.canWrite).toBe(true);

    const itemId = list.items[0]!.id;
    const movements = await movementsOf(kit.shop.owner, itemId);
    expect(movements).toMatchObject([
      { kind: 'OPENING', quantity: 50, balanceAfter: 50, unitCostMinor: 1400, canReverse: false },
    ]);
    expect((await listProductsToTrack(kit.shop.owner, {})).map((p) => p.catalogItemId)).toEqual([
      kit.paper.id,
    ]);

    // Doppio invio: il prodotto già controllato si ignora, nessun movimento in più.
    expect(
      await startInventoryTracking(kit.shop.owner, {
        rows: { '0': { catalogItemId: kit.rose.id, quantity: '80' } },
      }),
    ).toEqual({ started: 0 });
    expect(await movementsOf(kit.shop.owner, itemId)).toHaveLength(1);
    await expectConsistent(itemId);
  });

  it('un ramo o un prodotto archiviato non si controllano; zero è una existencia valida', async () => {
    const kit = await createKit();
    const bouquet = await createCatalogItem(
      kit.shop.owner,
      itemInput({ type: 'BOUQUET', name: 'Ramo', saleUnit: 'PIECE', colors: [], tags: [] }),
    );
    await expect(
      startInventoryTracking(kit.shop.owner, {
        rows: { '0': { catalogItemId: bouquet.id, quantity: '2' } },
      }),
    ).rejects.toMatchObject({ fieldErrors: { 'rows.0.quantity': 'item_unavailable' } });

    // Senza merce oggi: si controlla da zero, senza registri.
    const paperId = await track(kit.shop.owner, kit.paper.id, 0);
    expect(await getInventoryItem(kit.shop.owner, paperId)).toMatchObject({
      onHand: 0,
      status: 'OUT',
      avgUnitCostMinor: null,
      valueMinor: 0,
    });
    expect(await movementsOf(kit.shop.owner, paperId)).toEqual([]);
  });
});

describe('uso, merma e conteggio', () => {
  it('aggiornano la giacenza con il costo medio; i conteggi registrano la differenza', async () => {
    const kit = await createKit();
    const itemId = await track(kit.shop.owner, kit.rose.id, 50);

    expect(await recordStockOut(kit.shop.manager, itemId, 'USE', { quantity: '12' })).toEqual({
      onHand: 38,
      saleUnit: 'STEM',
      missing: 0,
    });
    await recordStockOut(kit.shop.owner, itemId, 'WASTE', { quantity: '3', note: 'Marchitas' });
    expect(await recordStockCount(kit.shop.owner, itemId, { countedQuantity: '30' })).toEqual({
      onHand: 30,
      saleUnit: 'STEM',
      delta: -5,
    });
    // Il conteggio che coincide non registra nulla.
    expect(await recordStockCount(kit.shop.owner, itemId, { countedQuantity: '30' })).toEqual({
      onHand: 30,
      saleUnit: 'STEM',
      delta: 0,
    });

    const movements = await movementsOf(kit.shop.owner, itemId);
    expect(
      movements.map(({ kind, quantity, balanceAfter, note }) => ({
        kind,
        quantity,
        balanceAfter,
        note,
      })),
    ).toEqual([
      { kind: 'ADJUSTMENT', quantity: -5, balanceAfter: 30, note: null },
      { kind: 'WASTE', quantity: -3, balanceAfter: 35, note: 'Marchitas' },
      { kind: 'USE', quantity: -12, balanceAfter: 38, note: null },
      { kind: 'OPENING', quantity: 50, balanceAfter: 50, note: null },
    ]);
    // Valore del movimento al costo medio (14,00 × 12).
    expect(movements[2]).toMatchObject({ unitCostMinor: 1400, valueMinor: 16_800 });
    await expectConsistent(itemId);
  });

  it('merce insufficiente: serve la conferma, poi la giacenza scende sotto zero', async () => {
    const kit = await createKit();
    const itemId = await track(kit.shop.owner, kit.rose.id, 30, '30');
    expect((await getInventoryItem(kit.shop.owner, itemId)).status).toBe('LOW');

    await expect(
      recordStockOut(kit.shop.owner, itemId, 'USE', { quantity: '40' }),
    ).rejects.toMatchObject({ reason: 'inventory_insufficient_stock' });
    expect((await getInventoryItem(kit.shop.owner, itemId)).onHand).toBe(30);

    expect(
      await recordStockOut(kit.shop.owner, itemId, 'USE', {
        quantity: '40',
        confirmShortage: 'on',
      }),
    ).toEqual({ onHand: -10, saleUnit: 'STEM', missing: 10 });
    const item = await getInventoryItem(kit.shop.owner, itemId);
    expect(item).toMatchObject({ onHand: -10, available: -10, status: 'OUT', valueMinor: 0 });

    const out = await listInventory(kit.shop.owner, { status: 'OUT' });
    expect(out.items.map((row) => row.id)).toEqual([itemId]);
    expect((await listInventory(kit.shop.owner, { status: 'LOW' })).items).toEqual([]);
    expect(out.summary).toMatchObject({ tracked: 1, out: 1, low: 0 });
    await expectConsistent(itemId);
  });

  it('minimo modificabile, quantità e tipi validati', async () => {
    const kit = await createKit();
    const itemId = await track(kit.shop.owner, kit.rose.id, 15);
    await updateInventoryItemSettings(kit.shop.manager, itemId, { minQuantity: '20' });
    expect(await getInventoryItem(kit.shop.owner, itemId)).toMatchObject({
      minQuantity: 20,
      status: 'LOW',
    });
    await updateInventoryItemSettings(kit.shop.owner, itemId, { minQuantity: '' });
    expect((await getInventoryItem(kit.shop.owner, itemId)).status).toBe('OK');

    await expect(
      recordStockOut(kit.shop.owner, itemId, 'USE', { quantity: '0' }),
    ).rejects.toMatchObject({ fieldErrors: { quantity: 'out_of_range' } });
    await expect(
      recordStockOut(kit.shop.owner, itemId, 'GIFT', { quantity: '1' }),
    ).rejects.toMatchObject({ fieldErrors: { kind: 'invalid_option' } });
    await expect(
      recordStockCount(kit.shop.owner, itemId, { countedQuantity: '-2' }),
    ).rejects.toMatchObject({ fieldErrors: { countedQuantity: 'out_of_range' } });
  });
});

describe('anulación', () => {
  it('annulla un registro una sola volta; l’existencia inicial e le anulaciones no', async () => {
    const kit = await createKit();
    const itemId = await track(kit.shop.owner, kit.rose.id, 20);
    await recordStockOut(kit.shop.owner, itemId, 'WASTE', { quantity: '3' });
    const [waste, opening] = await movementsOf(kit.shop.owner, itemId);
    expect(waste).toMatchObject({ kind: 'WASTE', canReverse: true });

    await reverseInventoryEntry(kit.shop.owner, waste!.entryId, {});
    expect((await getInventoryItem(kit.shop.owner, itemId)).onHand).toBe(20);
    const [reversal, reversedWaste] = await movementsOf(kit.shop.owner, itemId);
    expect(reversal).toMatchObject({
      kind: 'REVERSAL',
      reversesKind: 'WASTE',
      quantity: 3,
      balanceAfter: 20,
      canReverse: false,
    });
    expect(reversedWaste).toMatchObject({ reversed: true, canReverse: false });

    await expect(reverseInventoryEntry(kit.shop.owner, waste!.entryId, {})).rejects.toMatchObject({
      reason: 'inventory_entry_already_reversed',
    });
    await expect(reverseInventoryEntry(kit.shop.owner, opening!.entryId, {})).rejects.toMatchObject(
      { reason: 'inventory_entry_not_reversible' },
    );
    await expect(
      reverseInventoryEntry(kit.shop.owner, reversal!.entryId, {}),
    ).rejects.toMatchObject({ reason: 'inventory_entry_not_reversible' });
    await expectConsistent(itemId);
  });

  it('se l’anulación toglie merce già usata serve la conferma', async () => {
    const kit = await createKit();
    const itemId = await track(kit.shop.owner, kit.rose.id, 0);
    await recordStockCount(kit.shop.owner, itemId, { countedQuantity: '10' });
    await recordStockOut(kit.shop.owner, itemId, 'USE', { quantity: '8' });
    const adjustment = (await movementsOf(kit.shop.owner, itemId)).find(
      (movement) => movement.kind === 'ADJUSTMENT',
    );
    await expect(
      reverseInventoryEntry(kit.shop.owner, adjustment!.entryId, {}),
    ).rejects.toMatchObject({ reason: 'inventory_insufficient_stock' });
    await reverseInventoryEntry(kit.shop.owner, adjustment!.entryId, { confirmShortage: 'on' });
    expect((await getInventoryItem(kit.shop.owner, itemId)).onHand).toBe(-8);
    await expectConsistent(itemId);
  });
});

describe('smettere e riprendere', () => {
  it('l’archiviato esce dall’elenco, non registra; si riprende con un conteggio', async () => {
    const kit = await createKit();
    const itemId = await track(kit.shop.owner, kit.rose.id, 12);
    await stopInventoryTracking(kit.shop.owner, itemId);
    expect((await listInventory(kit.shop.owner, {})).items).toEqual([]);
    const archived = await listInventory(kit.shop.owner, { archived: '1' });
    expect(archived.items.map((item) => item.id)).toEqual([itemId]);
    expect(archived.archivedCount).toBe(1);
    await expect(
      recordStockOut(kit.shop.owner, itemId, 'USE', { quantity: '1' }),
    ).rejects.toMatchObject({ reason: 'inventory_item_archived' });

    const toTrack = await listProductsToTrack(kit.shop.owner, { q: 'rosa' });
    expect(toTrack).toEqual([
      expect.objectContaining({ catalogItemId: kit.rose.id, previousOnHand: 12 }),
    ]);
    await startInventoryTracking(kit.shop.owner, {
      rows: { '0': { catalogItemId: kit.rose.id, quantity: '9', minQuantity: '4' } },
    });
    expect(await getInventoryItem(kit.shop.owner, itemId)).toMatchObject({
      tracking: 'ACTIVE',
      onHand: 9,
      minQuantity: 4,
    });
    expect((await movementsOf(kit.shop.owner, itemId))[0]).toMatchObject({
      kind: 'ADJUSTMENT',
      quantity: -3,
    });
    await expectConsistent(itemId);
  });
});

describe('ruoli e piano', () => {
  it('lo staff vede le quantità senza costi e non registra nulla', async () => {
    const kit = await createKit();
    const itemId = await track(kit.shop.owner, kit.rose.id, 10);
    const list = await listInventory(kit.shop.staff, {});
    expect(list.items[0]).toMatchObject({
      onHand: 10,
      avgUnitCostMinor: null,
      catalogCostMinor: null,
      valueMinor: null,
    });
    expect(list.summary.valueMinor).toBeNull();
    expect(list.canWrite).toBe(false);
    expect((await movementsOf(kit.shop.staff, itemId))[0]).toMatchObject({
      unitCostMinor: null,
      valueMinor: null,
      canReverse: false,
    });

    await expect(
      recordStockOut(kit.shop.staff, itemId, 'USE', { quantity: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      recordStockCount(kit.shop.staff, itemId, { countedQuantity: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listProductsToTrack(kit.shop.staff, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(stopInventoryTracking(kit.shop.staff, itemId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('fase di prova (D-29): anche senza abbonamento l’inventario si usa', async () => {
    const basic = await createTestShop('Florería Basic Inventario');
    const rose = await createCatalogItem(basic.owner, itemInput());
    // Finché la rosa non si controlla, gli ordini passano senza registri.
    expect(await getCatalogItemInventory(basic.owner, rose.id)).toMatchObject({ item: null });
    const check = await checkStock(basic.owner, [{ catalogItemId: rose.id, quantity: 3 }]);
    expect(check.shortages).toEqual([]);
    expect(check.lines[0]).toMatchObject({ tracked: false, missing: 0 });
    const consumed = await withTenantContext(db, basic.owner, (tx) =>
      consumeStockTx(tx, basic.owner, {
        lines: [{ catalogItemId: rose.id, quantity: 3 }],
        confirmShortage: false,
      }),
    );
    expect(consumed.entryId).toBeNull();

    await startInventoryTracking(basic.owner, {
      rows: { '0': { catalogItemId: rose.id, quantity: '5' } },
    });
    expect((await listInventory(basic.owner, {})).total).toBe(1);
  });
});

describe('per gli ordini: verifica e consumo nella transazione di chi chiama', () => {
  it('somma le righe dello stesso prodotto, ignora i non controllati, chiede la conferma', async () => {
    const kit = await createKit();
    const roseItemId = await track(kit.shop.owner, kit.rose.id, 10);
    const lines = [
      { catalogItemId: kit.rose.id, quantity: 8 },
      { catalogItemId: kit.paper.id, quantity: 2 },
      { catalogItemId: kit.rose.id, quantity: 4 },
    ];
    const check = await checkStock(kit.shop.staff, lines);
    expect(check.lines).toEqual([
      {
        catalogItemId: kit.rose.id,
        tracked: true,
        inventoryItemId: roseItemId,
        requested: 12,
        onHand: 10,
        available: 10,
        missing: 2,
      },
      {
        catalogItemId: kit.paper.id,
        tracked: false,
        inventoryItemId: null,
        requested: 2,
        onHand: null,
        available: null,
        missing: 0,
      },
    ]);
    expect(check.shortages.map((line) => line.catalogItemId)).toEqual([kit.rose.id]);

    // Lo staff fa avanzare gli ordini: il consumo non chiede `inventory:write`.
    const staff = kit.shop.staff;
    await expect(
      withTenantContext(db, staff, (tx) =>
        consumeStockTx(tx, staff, { lines, confirmShortage: false }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await getInventoryItem(kit.shop.owner, roseItemId)).onHand).toBe(10);

    const consumed = await withTenantContext(db, staff, (tx) =>
      consumeStockTx(tx, staff, { lines, note: 'PED-0007', confirmShortage: true }),
    );
    expect(consumed.entryId).not.toBeNull();
    expect(consumed).toMatchObject({ expectedCostMinor: 16_800, actualCostMinor: 16_800 });
    expect(await getInventoryItem(kit.shop.owner, roseItemId)).toMatchObject({ onHand: -2 });
    expect((await movementsOf(kit.shop.owner, roseItemId))[0]).toMatchObject({
      kind: 'USE',
      quantity: -12,
      note: 'PED-0007',
      actorName: expect.any(String),
    });

    // Solo prodotti non controllati: niente da registrare.
    const none = await withTenantContext(db, staff, (tx) =>
      consumeStockTx(tx, staff, {
        lines: [{ catalogItemId: kit.paper.id, quantity: 1 }],
        confirmShortage: false,
      }),
    );
    expect(none).toMatchObject({ entryId: null, expectedCostMinor: null, actualCostMinor: null });
    await expect(
      checkStock(kit.shop.owner, [{ catalogItemId: kit.rose.id, quantity: 0 }]),
    ).rejects.toMatchObject({ fieldErrors: { lines: 'invalid' } });
    await expectConsistent(roseItemId);
  });
});

describe('concorrenza e integrità', () => {
  it('usi contemporanei non perdono aggiornamenti', async () => {
    const kit = await createKit();
    const itemId = await track(kit.shop.owner, kit.rose.id, 20);
    await Promise.all(
      Array.from({ length: 6 }, () =>
        recordStockOut(kit.shop.owner, itemId, 'USE', { quantity: '2' }),
      ),
    );
    expect((await getInventoryItem(kit.shop.owner, itemId)).onHand).toBe(8);
    const balances = (await movementsOf(kit.shop.owner, itemId))
      .filter((movement) => movement.kind === 'USE')
      .map((movement) => movement.balanceAfter)
      .sort((a, b) => a - b);
    expect(balances).toEqual([8, 10, 12, 14, 16, 18]);
    await expectConsistent(itemId);
  });

  it('registri e movimenti non si modificano né si cancellano; il segno segue il tipo', async () => {
    const kit = await createKit();
    const itemId = await track(kit.shop.owner, kit.rose.id, 5);
    const [opening] = await movementsOf(kit.shop.owner, itemId);
    const ctx = kit.shop.owner;
    const changed = await withTenantContext(db, ctx, async (tx) => ({
      updated: await tx.inventoryMovement.updateMany({
        where: { tenantId: ctx.tenantId },
        data: { quantity: 500 },
      }),
      deleted: await tx.inventoryEntry.deleteMany({ where: { tenantId: ctx.tenantId } }),
    }));
    expect(changed).toEqual({ updated: { count: 0 }, deleted: { count: 0 } });

    // Un uso con quantità positiva, o un movimento di tipo diverso dal registro: rifiutati.
    await expect(
      withTenantContext(db, ctx, (tx) =>
        tx.inventoryMovement.create({
          data: {
            tenantId: ctx.tenantId,
            entryId: opening!.entryId,
            kind: 'USE',
            inventoryItemId: itemId,
            quantity: 1,
            balanceAfter: 6,
            currency: 'MXN',
          },
        }),
      ),
    ).rejects.toThrow();
    await expectConsistent(itemId);
  });
});

describe('isolamento fra fiorerie', () => {
  it('un’altra fioreria non vede né tocca l’inventario: 404 ed evento di sicurezza', async () => {
    const a = await createKit('Florería Inventario A');
    const b = await createKit('Florería Inventario B');
    const itemId = await track(a.shop.owner, a.rose.id, 30);
    await recordStockOut(a.shop.owner, itemId, 'USE', { quantity: '1' });
    const [use] = await movementsOf(a.shop.owner, itemId);

    expect((await listInventory(b.shop.owner, {})).items).toEqual([]);
    expect((await listInventoryMovements(b.shop.owner, {})).movements).toEqual([]);
    await expect(getInventoryItem(b.shop.owner, itemId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      recordStockOut(b.shop.owner, itemId, 'USE', { quantity: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      recordStockCount(b.shop.owner, itemId, { countedQuantity: '0' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateInventoryItemSettings(b.shop.owner, itemId, { minQuantity: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(stopInventoryTracking(b.shop.owner, itemId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reverseInventoryEntry(b.shop.owner, use!.entryId, {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      startInventoryTracking(b.shop.owner, {
        rows: { '0': { catalogItemId: a.paper.id, quantity: '3' } },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Il prodotto di A, visto da B, è "non controllato": nessun dato di A.
    const check = await checkStock(b.shop.owner, [{ catalogItemId: a.rose.id, quantity: 1 }]);
    expect(check.lines[0]).toMatchObject({ tracked: false, onHand: null });

    // Nulla è cambiato in A.
    expect((await getInventoryItem(a.shop.owner, itemId)).onHand).toBe(29);
    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: null, entityId: { in: [itemId, use!.entryId] } },
        select: { action: true, entityType: true },
      }),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        { action: 'security.cross_tenant_access_attempt', entityType: 'InventoryItem' },
        { action: 'security.cross_tenant_access_attempt', entityType: 'InventoryEntry' },
      ]),
    );
  });
});
