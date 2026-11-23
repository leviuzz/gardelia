/**
 * Compras al mayorista e proveedores (ADR-061): la merce entra, il costo medio si aggiorna con
 * quanto si è pagato e torna com'era se la compra si annulla; "Usar este costo" porta il costo reale
 * nel catalogo; proveedores archiviabili; solo proprietario e manager; isolamento A↔B.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  ForbiddenError,
  NotFoundError,
  createCatalogItem,
  createSupplier,
  getCatalogItem,
  getCatalogItemInventory,
  getInventoryItem,
  getPurchase,
  listInventoryMovements,
  listPurchases,
  listSuppliers,
  recordPurchase,
  recordStockOut,
  reverseInventoryEntry,
  setSupplierArchived,
  startInventoryTracking,
  updateSupplier,
  applyRealCostToCatalog,
  type CatalogItemDto,
  type TenantContext,
} from '../src/index';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
let operatorEmail: string;

interface Kit {
  readonly shop: TestShop;
  readonly rose: CatalogItemDto;
  readonly roseItemId: string;
  readonly paperItemId: string;
}

async function track(ctx: TenantContext, catalogItemId: string, quantity: number) {
  await startInventoryTracking(ctx, {
    rows: { '0': { catalogItemId, quantity: String(quantity) } },
  });
  const inventory = await getCatalogItemInventory(ctx, catalogItemId);
  if (!inventory?.item) throw new Error('prodotto non avviato');
  return inventory.item.id;
}

async function createKit(name?: string): Promise<Kit> {
  const shop = await createTestShop(name);
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  // Rosa: 50 steli in negozio al costo del catalogo (10,00).
  const rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', costMinor: 1000 }),
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
  return {
    shop,
    rose,
    roseItemId: await track(shop.owner, rose.id, 50),
    paperItemId: await track(shop.owner, paper.id, 0),
  };
}

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador Compras' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
});

afterAll(async () => {
  await disconnectDb();
});

describe('compras', () => {
  it('la merce entra, il costo medio si aggiorna, il proveedor nuovo nasce con la compra', async () => {
    const kit = await createKit();
    const { entryId } = await recordPurchase(kit.shop.manager, {
      supplierId: '',
      newSupplierName: 'Mercado de Jamaica',
      purchasedOn: '',
      reference: 'Nota 118',
      lines: {
        '0': { inventoryItemId: kit.roseItemId, quantity: '4x25', total: '1300' },
        '1': { inventoryItemId: kit.paperItemId, quantity: '10', total: '45' },
        // Lo stesso prodotto due volte si somma.
        '2': { inventoryItemId: kit.paperItemId, quantity: '10', total: '45' },
      },
    });

    // 50 a 10,00 + 100 a 13,00 → 150 a 12,00. La carta: 20 a 4,50.
    expect(await getInventoryItem(kit.shop.owner, kit.roseItemId)).toMatchObject({
      onHand: 150,
      avgUnitCostMinor: 1200,
      catalogCostMinor: 1000,
    });
    expect(await getInventoryItem(kit.shop.owner, kit.paperItemId)).toMatchObject({
      onHand: 20,
      avgUnitCostMinor: 450,
    });

    const purchase = await getPurchase(kit.shop.owner, entryId);
    expect(purchase).toMatchObject({
      supplierName: 'Mercado de Jamaica',
      reference: 'Nota 118',
      lines: 2,
      totalMinor: 139_000,
      reversed: false,
      canReverse: true,
    });
    expect(purchase.purchaseLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Rosa roja',
          quantity: 100,
          unitCostMinor: 1300,
          totalCostMinor: 130_000,
        }),
        expect.objectContaining({
          name: 'Papel kraft',
          quantity: 20,
          unitCostMinor: 450,
          totalCostMinor: 9000,
        }),
      ]),
    );
    expect((await listSuppliers(kit.shop.owner)).map((supplier) => supplier.name)).toEqual([
      'Mercado de Jamaica',
    ]);
    const list = await listPurchases(kit.shop.owner, { q: 'jamaica' });
    expect(list.purchases.map((row) => row.entryId)).toEqual([entryId]);
    expect((await listPurchases(kit.shop.owner, { q: 'nota 118' })).total).toBe(1);
    expect((await listPurchases(kit.shop.owner, { q: 'otro' })).total).toBe(0);

    const [movement] = (
      await listInventoryMovements(kit.shop.owner, {}, { inventoryItemId: kit.roseItemId })
    ).movements;
    expect(movement).toMatchObject({
      kind: 'PURCHASE',
      quantity: 100,
      balanceAfter: 150,
      canReverse: true,
    });
  });

  it('annullare la compra toglie la merce e il suo prezzo dal costo medio', async () => {
    const kit = await createKit();
    const { entryId } = await recordPurchase(kit.shop.owner, {
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '100', total: '1300' } },
    });
    await reverseInventoryEntry(kit.shop.owner, entryId, {});
    expect(await getInventoryItem(kit.shop.owner, kit.roseItemId)).toMatchObject({
      onHand: 50,
      avgUnitCostMinor: 1000,
    });
    expect(await getPurchase(kit.shop.owner, entryId)).toMatchObject({
      reversed: true,
      canReverse: false,
    });
  });

  it('se la merce comprata è già stata usata, annullare chiede la conferma', async () => {
    const kit = await createKit();
    const { entryId } = await recordPurchase(kit.shop.owner, {
      lines: { '0': { inventoryItemId: kit.paperItemId, quantity: '10', total: '40' } },
    });
    await recordStockOut(kit.shop.owner, kit.paperItemId, 'USE', { quantity: '6' });
    await expect(reverseInventoryEntry(kit.shop.owner, entryId, {})).rejects.toMatchObject({
      reason: 'inventory_insufficient_stock',
    });
    await reverseInventoryEntry(kit.shop.owner, entryId, { confirmShortage: 'on' });
    expect((await getInventoryItem(kit.shop.owner, kit.paperItemId)).onHand).toBe(-6);
  });

  it('data della compra: oggi se vuota, mai nel futuro; proveedor archiviato non si sceglie', async () => {
    const kit = await createKit();
    const line = { '0': { inventoryItemId: kit.roseItemId, quantity: '1', total: '10' } };
    await expect(
      recordPurchase(kit.shop.owner, { purchasedOn: '2999-01-01', lines: line }),
    ).rejects.toMatchObject({ fieldErrors: { purchasedOn: 'out_of_range' } });
    const supplier = await createSupplier(kit.shop.owner, {
      name: 'Flores Toño',
      phone: '449 555 0123',
    });
    await setSupplierArchived(kit.shop.owner, supplier.id, true);
    await expect(
      recordPurchase(kit.shop.owner, { supplierId: supplier.id, lines: line }),
    ).rejects.toMatchObject({ fieldErrors: { supplierId: 'invalid_option' } });
    expect(await listSuppliers(kit.shop.owner)).toEqual([]);
    expect((await listSuppliers(kit.shop.owner, { includeArchived: true }))[0]).toMatchObject({
      name: 'Flores Toño',
      phone: '+524495550123',
      status: 'ARCHIVED',
    });
    await setSupplierArchived(kit.shop.owner, supplier.id, false);
    const updated = await updateSupplier(kit.shop.owner, supplier.id, {
      name: 'Flores Toño (mercado)',
      phone: '',
      notes: 'Llega los martes',
    });
    expect(updated).toMatchObject({ name: 'Flores Toño (mercado)', phone: null, status: 'ACTIVE' });
  });

  it('"Usar este costo": il costo reale va nel catalogo, deciso dal server', async () => {
    const kit = await createKit();
    await recordPurchase(kit.shop.owner, {
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '100', total: '1300' } },
    });
    expect(await applyRealCostToCatalog(kit.shop.manager, kit.roseItemId)).toEqual({
      costMinor: 1200,
    });
    expect((await getCatalogItem(kit.shop.owner, kit.rose.id)).costMinor).toBe(1200);
    // Senza costo reale non c'è nulla da usare.
    await expect(applyRealCostToCatalog(kit.shop.owner, kit.paperItemId)).rejects.toMatchObject({
      reason: 'inventory_no_real_cost',
    });
  });
});

describe('ruoli e isolamento', () => {
  it('lo staff non vede né registra compras e proveedores', async () => {
    const kit = await createKit();
    const staff = kit.shop.staff;
    const line = { '0': { inventoryItemId: kit.roseItemId, quantity: '1', total: '10' } };
    await expect(recordPurchase(staff, { lines: line })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listPurchases(staff, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listSuppliers(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSupplier(staff, { name: 'X' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(applyRealCostToCatalog(staff, kit.roseItemId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('un’altra fioreria non vede né usa compras, proveedores e prodotti: 404', async () => {
    const a = await createKit('Florería Compras A');
    const b = await createKit('Florería Compras B');
    const supplier = await createSupplier(a.shop.owner, { name: 'Mercado A' });
    const { entryId } = await recordPurchase(a.shop.owner, {
      supplierId: supplier.id,
      lines: { '0': { inventoryItemId: a.roseItemId, quantity: '10', total: '100' } },
    });

    expect((await listPurchases(b.shop.owner, {})).purchases).toEqual([]);
    expect(await listSuppliers(b.shop.owner)).toEqual([]);
    await expect(getPurchase(b.shop.owner, entryId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reverseInventoryEntry(b.shop.owner, entryId, {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(updateSupplier(b.shop.owner, supplier.id, { name: 'Y' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(setSupplierArchived(b.shop.owner, supplier.id, true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Il proveedor o il prodotto di A in una compra di B: 404, nulla cambia.
    await expect(
      recordPurchase(b.shop.owner, {
        supplierId: supplier.id,
        lines: { '0': { inventoryItemId: b.roseItemId, quantity: '1', total: '1' } },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      recordPurchase(b.shop.owner, {
        lines: { '0': { inventoryItemId: a.roseItemId, quantity: '1', total: '1' } },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(applyRealCostToCatalog(b.shop.owner, a.roseItemId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getInventoryItem(a.shop.owner, a.roseItemId)).onHand).toBe(60);
    expect((await getInventoryItem(b.shop.owner, b.roseItemId)).onHand).toBe(50);

    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: null, entityId: { in: [supplier.id, entryId] } },
        select: { entityType: true },
      }),
    );
    expect(events.map((event) => event.entityType)).toEqual(
      expect.arrayContaining(['Supplier', 'InventoryEntry']),
    );
  });
});
