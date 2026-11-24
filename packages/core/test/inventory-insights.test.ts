/**
 * Avvisi, ramos e riepilogo del mese (ADR-063): quanti ramos si possono fare con la merce
 * disponibile, il costo previsto e reale dei materiali, "Registrar ramos hechos", gli avvisi del
 * pannello e il riepilogo del mese per chi vede i costi; ruoli, piano e isolamento A↔B.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { addDays, toIsoDate, todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  addRecipeLine,
  createCatalogItem,
  createReservation,
  getBouquetInventory,
  getCatalogItemInventory,
  getInventoryAlerts,
  getInventoryItem,
  getInventoryMonthSummary,
  listInventoryMovements,
  recordBouquetsMade,
  recordPurchase,
  recordStockOut,
  reverseInventoryEntry,
  startInventoryTracking,
  updateInventoryItemSettings,
  type CatalogItemDto,
  type TenantContext,
} from '../src/index';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
let operatorEmail: string;

interface Kit {
  readonly shop: TestShop;
  readonly bouquet: CatalogItemDto;
  readonly rose: CatalogItemDto;
  readonly roseItemId: string;
  readonly eucalyptusItemId: string;
}

async function track(ctx: TenantContext, catalogItemId: string, quantity: number) {
  await startInventoryTracking(ctx, {
    rows: { '0': { catalogItemId, quantity: String(quantity) } },
  });
  const inventory = await getCatalogItemInventory(ctx, catalogItemId);
  if (!inventory?.item) throw new Error('prodotto non avviato');
  return inventory.item.id;
}

/**
 * Un ramo da 12 rose (costo catalogo 10,00), 3 eucalipti (2,00) e 1 carta (4,50, comprata a
 * richiesta: non si controlla). In negozio 50 rose e 20 eucalipti.
 */
async function createKit(name?: string): Promise<Kit> {
  const shop = await createTestShop(name);
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  const owner = shop.owner;
  const rose = await createCatalogItem(owner, itemInput({ name: 'Rosa roja', costMinor: 1000 }));
  const eucalyptus = await createCatalogItem(
    owner,
    itemInput({ type: 'FOLIAGE', name: 'Eucalipto', variety: null, costMinor: 200 }),
  );
  const paper = await createCatalogItem(
    owner,
    itemInput({
      type: 'PACKAGING',
      name: 'Papel kraft',
      variety: null,
      colors: ['brown'],
      saleUnit: 'PIECE',
      costMinor: 450,
      heightCm: null,
      tags: [],
    }),
  );
  const bouquet = await createCatalogItem(
    owner,
    itemInput({
      name: 'Ramo Clásico',
      type: 'BOUQUET',
      saleUnit: 'PIECE',
      priceMinor: 69_000,
      costMinor: null,
      variety: null,
    }),
  );
  await addRecipeLine(owner, bouquet.id, { ingredientItemId: rose.id, quantity: 12 });
  await addRecipeLine(owner, bouquet.id, { ingredientItemId: eucalyptus.id, quantity: 3 });
  await addRecipeLine(owner, bouquet.id, { ingredientItemId: paper.id, quantity: 1 });
  return {
    shop,
    bouquet,
    rose,
    roseItemId: await track(owner, rose.id, 50),
    eucalyptusItemId: await track(owner, eucalyptus.id, 20),
  };
}

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador Ramos' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
});

afterAll(async () => {
  await disconnectDb();
});

describe('ramos del catálogo', () => {
  it('quanti ramos si possono fare, cosa manca e il costo previsto e reale', async () => {
    const kit = await createKit();
    const owner = kit.shop.owner;
    const stock = await getBouquetInventory(owner, kit.bouquet.id);
    // Rose: 50 / 12 = 4; eucalipto: 20 / 3 = 6; la carta non si controlla.
    expect(stock).toMatchObject({ possible: 4, canRecord: true });
    expect(stock?.lines.map((line) => [line.name, line.available])).toEqual([
      ['Rosa roja', 50],
      ['Eucalipto', 20],
      ['Papel kraft', null],
    ]);
    // Previsto: 12 × 10 + 3 × 2 + 4,50 = 130,50; reale uguale finché non ci sono compras.
    expect(stock?.cost).toEqual({
      expectedMinor: 13_050,
      realMinor: 13_050,
      catalogFallbackLines: 1,
    });

    // Una compra di rose più care alza il costo reale (50 a 10,00 + 50 a 14,00 → 12,00).
    await recordPurchase(owner, {
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '50', total: '700' } },
    });
    const after = await getBouquetInventory(owner, kit.bouquet.id);
    expect(after).toMatchObject({ possible: 6 });
    expect(after?.cost).toMatchObject({ expectedMinor: 13_050, realMinor: 15_450 });

    // Gli apartados tolgono disponibile anche ai ramos.
    await createReservation(owner, {
      label: 'Boda',
      expiresOn: toIsoDate(addDays(todayInTimeZone(owner.timezone), 2)),
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '90' } },
    });
    expect((await getBouquetInventory(owner, kit.bouquet.id))?.possible).toBe(0);

    // Lo staff vede quanti ramos, ma non i costi né il pulsante.
    expect(await getBouquetInventory(kit.shop.staff, kit.bouquet.id)).toMatchObject({
      possible: 0,
      cost: null,
      canRecord: false,
    });
  });

  it('ramos hechos: la ricetta × N esce dall’inventario, con la conferma se non basta', async () => {
    const kit = await createKit();
    const manager = kit.shop.manager;
    const made = await recordBouquetsMade(manager, kit.bouquet.id, { count: '3' });
    expect(made).toMatchObject({ count: 3, missing: 0 });
    expect(made.entryId).not.toBeNull();
    expect((await getInventoryItem(manager, kit.roseItemId)).onHand).toBe(14);
    expect((await getInventoryItem(manager, kit.eucalyptusItemId)).onHand).toBe(11);
    const movements = await listInventoryMovements(manager, { kind: 'USE' });
    expect(movements.movements[0]).toMatchObject({ note: '3 × Ramo Clásico' });

    // 2 ramos in più: le rose (14) non bastano per 24.
    await expect(recordBouquetsMade(manager, kit.bouquet.id, { count: '2' })).rejects.toMatchObject(
      { reason: 'inventory_insufficient_stock' },
    );
    expect(
      await recordBouquetsMade(manager, kit.bouquet.id, { count: '2', confirmShortage: 'on' }),
    ).toMatchObject({ missing: 10 });
    expect((await getInventoryItem(manager, kit.roseItemId)).onHand).toBe(-10);

    // Un errore si annulla come ogni registro.
    if (!made.entryId) throw new Error('registro mancante');
    await reverseInventoryEntry(manager, made.entryId, {});
    expect((await getInventoryItem(manager, kit.roseItemId)).onHand).toBe(26);

    // Un ramo senza ricetta, o un prodotto che non è un ramo: niente da registrare.
    const empty = await createCatalogItem(
      kit.shop.owner,
      itemInput({ name: 'Ramo vacío', type: 'BOUQUET', saleUnit: 'PIECE', variety: null }),
    );
    await expect(recordBouquetsMade(manager, empty.id, { count: '1' })).rejects.toMatchObject({
      reason: 'inventory_bouquet_without_recipe',
    });
    await expect(recordBouquetsMade(manager, kit.rose.id, { count: '1' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await getBouquetInventory(manager, empty.id)).toBeNull();
  });
});

describe('avvisi e riepilogo del mese', () => {
  it('il pannello mostra i prodotti da guardare e gli apartados in scadenza', async () => {
    const kit = await createKit();
    const owner = kit.shop.owner;
    expect(await getInventoryAlerts(owner)).toMatchObject({ low: 0, out: 0, items: [] });

    await updateInventoryItemSettings(owner, kit.eucalyptusItemId, { minQuantity: '20' });
    await recordStockOut(owner, kit.roseItemId, 'WASTE', { quantity: '50', note: '' });
    const today = todayInTimeZone(owner.timezone);
    await createReservation(owner, {
      label: 'Hoy',
      expiresOn: toIsoDate(today),
      lines: { '0': { inventoryItemId: kit.eucalyptusItemId, quantity: '1' } },
    });
    const alerts = await getInventoryAlerts(kit.shop.staff);
    expect(alerts).toMatchObject({
      low: 1,
      out: 1,
      reservationsDueSoon: 1,
      reservationsExpired: 0,
    });
    expect(alerts?.items.map((item) => [item.name, item.status, item.available])).toEqual([
      ['Rosa roja', 'OUT', 0],
      ['Eucalipto', 'LOW', 19],
    ]);
  });

  it('riepilogo: compras, usato e mermas del mese, senza i registri annullati', async () => {
    const kit = await createKit();
    const owner = kit.shop.owner;
    await recordPurchase(owner, {
      lines: { '0': { inventoryItemId: kit.roseItemId, quantity: '50', total: '700' } },
    });
    const wrong = await recordPurchase(owner, {
      lines: { '0': { inventoryItemId: kit.eucalyptusItemId, quantity: '10', total: '30' } },
    });
    await reverseInventoryEntry(owner, wrong.entryId, {});
    await recordBouquetsMade(owner, kit.bouquet.id, { count: '1' });
    await recordStockOut(owner, kit.eucalyptusItemId, 'WASTE', { quantity: '2', note: '' });

    const summary = await getInventoryMonthSummary(owner, undefined);
    const today = todayInTimeZone(owner.timezone);
    expect(summary).toMatchObject({
      month: `${today.year}-${String(today.month).padStart(2, '0')}`,
      nextMonth: null,
      purchases: { totalMinor: 70_000, entries: 1 },
      // 12 rose al costo medio 12,00 + 3 eucalipti a 2,00; ai costi del catalogo 12 × 10 + 3 × 2.
      used: { realMinor: 15_000, expectedMinor: 12_600, entries: 1 },
      waste: { realMinor: 400, expectedMinor: 400, entries: 1 },
    });
    // Un mese futuro vale il mese di oggi; il mese prima è vuoto.
    expect((await getInventoryMonthSummary(owner, '2999-01')).month).toBe(summary.month);
    expect(await getInventoryMonthSummary(owner, summary.previousMonth)).toMatchObject({
      purchases: { totalMinor: 0, entries: 0 },
      used: { realMinor: 0, entries: 0 },
      nextMonth: summary.month,
    });
    // Lo staff non vede i costi: niente riepilogo.
    await expect(getInventoryMonthSummary(kit.shop.staff, undefined)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('piano, ruoli e isolamento', () => {
  it('fase di prova (D-29): anche senza abbonamento ci sono avvisi e ramos', async () => {
    const basic = await createTestShop('Florería Basic Ramos');
    const bouquet = await createCatalogItem(
      basic.owner,
      itemInput({ name: 'Ramo', type: 'BOUQUET', saleUnit: 'PIECE', variety: null }),
    );
    expect(await getInventoryAlerts(basic.owner)).toMatchObject({ out: 0, low: 0 });
    // Senza ricetta il ramo non ha riquadro e non si registra (ADR-063): non dipende dal piano.
    expect(await getBouquetInventory(basic.owner, bouquet.id)).toBeNull();
    await expect(recordBouquetsMade(basic.owner, bouquet.id, { count: '1' })).rejects.toMatchObject(
      { reason: 'inventory_bouquet_without_recipe' },
    );
  });

  it('lo staff non registra ramos; un’altra fioreria non vede né usa il ramo: 404', async () => {
    const a = await createKit('Florería Ramos A');
    const b = await createKit('Florería Ramos B');
    await expect(
      recordBouquetsMade(a.shop.staff, a.bouquet.id, { count: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getBouquetInventory(b.shop.owner, a.bouquet.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      recordBouquetsMade(b.shop.owner, a.bouquet.id, { count: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await getInventoryItem(a.shop.owner, a.roseItemId)).onHand).toBe(50);
    // Gli avvisi e il riepilogo di B non contano la merce di A.
    await recordStockOut(a.shop.owner, a.roseItemId, 'WASTE', { quantity: '50', note: '' });
    expect(await getInventoryAlerts(b.shop.owner)).toMatchObject({ out: 0, low: 0 });
    expect((await getInventoryMonthSummary(b.shop.owner, undefined)).waste.entries).toBe(0);

    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: null, entityId: a.bouquet.id },
        select: { entityType: true },
      }),
    );
    expect(events.map((event) => event.entityType)).toContain('CatalogItem');
  });
});
