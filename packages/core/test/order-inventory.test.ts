import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  NotFoundError,
  addCatalogItemToOrder,
  addRecipeLine,
  changeOrderStatus,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  createReservation,
  getCatalogItemInventory,
  getOrder,
  getOrderInventory,
  recordStockCount,
  reverseInventoryEntry,
  saveBouquetConfiguration,
  startInventoryTracking,
  type CatalogItemDto,
  type TenantContext,
} from '../src/index';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Scarico dell'inventario dagli ordini (ADR-071): i materiali escono quando l'ordine diventa
 * "Listo" per la prima volta, dalla ricetta concordata, una volta sola; se la merce non basta serve
 * la conferma; senza il piano o per i prodotti non controllati non succede nulla.
 */

const db = getDb();
let operatorEmail: string;
let shop: TestShop;
let basic: TestShop;
let rose: CatalogItemDto;
let paper: CatalogItemDto;
let vase: CatalogItemDto;
let bouquet: CatalogItemDto;
let customerId: string;

function tomorrow(): string {
  const today = todayInTimeZone('America/Mexico_City');
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return date.toISOString().slice(0, 10);
}

const pickup = () => ({
  fulfillmentMode: 'PICKUP',
  scheduledDate: tomorrow(),
  windowStart: '',
  windowEnd: '',
  customerAddressId: '',
  recipientName: '',
  recipientPhone: '',
  deliveryNotes: '',
  cardMessage: '',
  cardSignature: '',
  deliveryFee: '',
  notes: '',
});

function customer(name: string) {
  return {
    type: 'PERSON',
    displayName: name,
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550142',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  };
}

async function track(ctx: TenantContext, catalogItemId: string, quantity: number) {
  await startInventoryTracking(ctx, {
    rows: { '0': { catalogItemId, quantity: String(quantity), minQuantity: '' } },
  });
}

async function onHand(ctx: TenantContext, catalogItemId: string): Promise<number | null> {
  return (await getCatalogItemInventory(ctx, catalogItemId))?.item?.onHand ?? null;
}

/** Un ordine confermato con le righe date (prodotto, quantità). */
async function confirmedOrder(
  ctx: TenantContext,
  lines: readonly (readonly [CatalogItemDto, number])[],
  customer = customerId,
) {
  const { id } = await createDraftOrder(ctx, { customerId: customer });
  for (const [item, quantity] of lines) {
    await addCatalogItemToOrder(ctx, id, { catalogItemId: item.id, quantity: String(quantity) });
  }
  await confirmDraftOrder(ctx, id, pickup());
  return id;
}

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador Pedidos Inventario' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
  shop = await createTestShop('Florería Pedidos Inventario');
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  basic = await createTestShop('Florería Pedidos Sin Inventario');

  rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa roja' }));
  paper = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Papel kraft',
      type: 'PACKAGING',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      colors: [],
      priceMinor: 3000,
      costMinor: 800,
    }),
  );
  vase = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Florero de vidrio',
      type: 'CONTAINER',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      colors: [],
      priceMinor: 15000,
      costMinor: 6000,
    }),
  );
  bouquet = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'BOUQUET',
      name: 'Ramo Clásico',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 69000,
      costMinor: null,
    }),
  );
  await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: rose.id, quantity: 12 });
  await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: paper.id, quantity: 1 });
  // Rose e carta si controllano; il florero no.
  await track(shop.owner, rose.id, 30);
  await track(shop.owner, paper.id, 10);
  customerId = (await createCustomer(shop.owner, customer('Ana Inventario'))).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe('materiali di un ordine', () => {
  let orderId: string;

  it('prima di "Listo": cosa si scaricherà e cosa è disponibile', async () => {
    orderId = await confirmedOrder(shop.owner, [
      [bouquet, 2],
      [rose, 3],
      [vase, 1],
    ]);
    const inventory = await getOrderInventory(shop.staff, orderId);
    expect(inventory).toMatchObject({ consumed: null, shortages: [] });
    expect(
      inventory!.lines.map(({ name, requested, available }) => ({ name, requested, available })),
    ).toEqual([
      { name: 'Papel kraft', requested: 2, available: 10 },
      { name: 'Rosa roja', requested: 27, available: 30 },
    ]);
  });

  it('"En preparación" non scarica; "Listo" sì, una volta sola, col numero dell\'ordine', async () => {
    await changeOrderStatus(shop.staff, orderId, 'IN_PREPARATION');
    expect(await onHand(shop.owner, rose.id)).toBe(30);
    await changeOrderStatus(shop.staff, orderId, 'READY');
    expect(await onHand(shop.owner, rose.id)).toBe(3);
    expect(await onHand(shop.owner, paper.id)).toBe(8);
    const inventory = await getOrderInventory(shop.owner, orderId);
    expect(inventory?.consumed?.entryId).toBeTruthy();
    const entry = await withTenantContext(db, shop.owner, (tx) =>
      tx.inventoryEntry.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, id: inventory!.consumed!.entryId },
        select: { kind: true, note: true },
      }),
    );
    expect(entry).toEqual({
      kind: 'USE',
      note: (await getOrder(shop.owner, orderId)).numberLabel,
    });

    // Un passo indietro e di nuovo "Listo": niente secondo scarico.
    await changeOrderStatus(shop.staff, orderId, 'IN_PREPARATION');
    await changeOrderStatus(shop.staff, orderId, 'READY');
    expect(await onHand(shop.owner, rose.id)).toBe(3);
  });

  it("annullato dall'inventario: la scheda lo dice e l'ordine non riscarica", async () => {
    const before = await getOrderInventory(shop.owner, orderId);
    await reverseInventoryEntry(shop.manager, before!.consumed!.entryId, {});
    expect(await onHand(shop.owner, rose.id)).toBe(30);
    expect((await getOrderInventory(shop.staff, orderId))?.consumed?.reversed).toBe(true);
    await changeOrderStatus(shop.staff, orderId, 'IN_PREPARATION');
    await changeOrderStatus(shop.staff, orderId, 'READY');
    expect(await onHand(shop.owner, rose.id)).toBe(30);
    // Le rose tornano come prima per i casi che seguono.
    const roses = await getCatalogItemInventory(shop.owner, rose.id);
    await recordStockCount(shop.owner, roses!.item!.id, { countedQuantity: '3', note: '' });
  });

  it('se la merce non basta serve la conferma; con la conferma la giacenza va sotto zero', async () => {
    const id = await confirmedOrder(shop.owner, [[bouquet, 1]]);
    const inventory = await getOrderInventory(shop.owner, id);
    expect(inventory!.shortages.map(({ name, missing }) => ({ name, missing }))).toEqual([
      { name: 'Rosa roja', missing: 9 },
    ]);
    await expect(changeOrderStatus(shop.staff, id, 'READY')).rejects.toMatchObject({
      reason: 'order_inventory_shortage',
    });
    expect((await getOrder(shop.owner, id)).status).toBe('CONFIRMED');
    expect(await onHand(shop.owner, rose.id)).toBe(3);
    await changeOrderStatus(shop.staff, id, 'READY', { confirmShortage: true });
    expect(await onHand(shop.owner, rose.id)).toBe(-9);
    expect(ConflictError).toBeDefined();
  });

  it('gli apartados dei suoi prodotti si vedono (da liberare se sono per questo ordine)', async () => {
    const id = await confirmedOrder(shop.owner, [[paper, 1]]);
    const paperItem = await getCatalogItemInventory(shop.owner, paper.id);
    await createReservation(shop.owner, {
      label: 'Boda',
      expiresOn: tomorrow(),
      lines: { '0': { inventoryItemId: paperItem!.item!.id, quantity: '2' } },
    });
    const inventory = await getOrderInventory(shop.staff, id);
    expect(inventory!.lines).toEqual([
      expect.objectContaining({ name: 'Papel kraft', requested: 1, reserved: 2, missing: 0 }),
    ]);
  });

  it('due "Listo" nello stesso momento scaricano una volta sola', async () => {
    const id = await confirmedOrder(shop.owner, [[paper, 1]]);
    const before = await onHand(shop.owner, paper.id);
    const results = await Promise.allSettled([
      changeOrderStatus(shop.staff, id, 'READY', { confirmShortage: true }),
      changeOrderStatus(shop.owner, id, 'READY', { confirmShortage: true }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await onHand(shop.owner, paper.id)).toBe((before ?? 0) - 1);
  });

  it('righe nate prima: si usa la ricetta attuale del ramo', async () => {
    await track(shop.owner, vase.id, 5);
    const id = await confirmedOrder(shop.owner, [[bouquet, 1]]);
    // Snapshot di una riga vecchia: la ricetta senza gli ID degli ingredienti.
    await withTenantContext(db, shop.owner, async (tx) => {
      const line = await tx.orderLine.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, orderId: id },
      });
      const snapshot = line.snapshot as { recipe: { catalogItemId?: string }[] };
      await tx.orderLine.update({
        where: { id: line.id },
        data: {
          snapshot: {
            ...snapshot,
            recipe: snapshot.recipe.map(({ catalogItemId: _, ...rest }) => rest),
          },
        },
      });
    });
    const before = await onHand(shop.owner, paper.id);
    await changeOrderStatus(shop.owner, id, 'READY', { confirmShortage: true });
    expect(await onHand(shop.owner, paper.id)).toBe((before ?? 0) - 1);
  });

  it('i componenti di un disegno del Diseñador', async () => {
    const { id: configurationId } = await saveBouquetConfiguration(shop.owner, {
      name: 'Diseño de prueba',
      style: 'ROMANTIC',
      size: 'MEDIUM',
      budget: '800',
      notes: '',
      lines: [
        { catalogItemId: rose.id, quantity: 5 },
        { catalogItemId: paper.id, quantity: 1 },
      ],
    });
    const { id } = await createDraftOrder(shop.owner, { customerId, configurationId });
    await confirmDraftOrder(shop.owner, id, pickup());
    const roses = await onHand(shop.owner, rose.id);
    await changeOrderStatus(shop.owner, id, 'READY', { confirmShortage: true });
    expect(await onHand(shop.owner, rose.id)).toBe((roses ?? 0) - 5);
  });
});

describe('senza inventario', () => {
  it('senza il piano: nessun riquadro e "Listo" come sempre', async () => {
    const flower = await createCatalogItem(basic.owner, itemInput({ name: 'Girasol' }));
    const client = (await createCustomer(basic.owner, customer('Cliente Basic'))).id;
    const id = await confirmedOrder(basic.owner, [[flower, 5]], client);
    expect(await getOrderInventory(basic.owner, id)).toBeNull();
    await changeOrderStatus(basic.owner, id, 'READY');
    expect((await getOrder(basic.owner, id)).status).toBe('READY');
  });

  it("l'ordine di un'altra fioreria non esiste (404)", async () => {
    const id = await confirmedOrder(shop.owner, [[vase, 1]]);
    await expect(getOrderInventory(basic.owner, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
