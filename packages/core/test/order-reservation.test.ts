import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { addDays, toIsoDate, todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  NotFoundError,
  addCatalogItemToOrder,
  addCustomLineToOrder,
  cancelOrder,
  changeOrderStatus,
  confirmDraftOrder,
  consumeReservation,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  extendReservation,
  getCatalogItemInventory,
  getOrderInventory,
  getReservation,
  listReservations,
  releaseReservation,
  removeOrderLine,
  startInventoryTracking,
  updateOrderFulfillment,
  updateOrderLineQuantity,
  type CatalogItemDto,
  type TenantContext,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Apartados dagli ordini confermati (ADR-072): l'ordine confermato tiene i suoi materiali negli
 * ultimi giorni prima della consegna; l'apartado segue righe e giorno, si usa a "Listo" (un solo
 * movimento) e si libera all'annullamento. Le azioni manuali non lo toccano.
 */

const db = getDb();
let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let vase: CatalogItemDto;
let customerId: string;

const today = () => todayInTimeZone('America/Mexico_City');
const inDays = (days: number) => toIsoDate(addDays(today(), days));

const pickup = (days = 1) => ({
  fulfillmentMode: 'PICKUP',
  scheduledDate: inDays(days),
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

async function stock(item: CatalogItemDto, ctx: TenantContext = shop.owner) {
  const found = await getCatalogItemInventory(ctx, item.id);
  return { onHand: found?.item?.onHand ?? null, available: found?.item?.available ?? null };
}

async function confirmedOrder(
  lines: readonly (readonly [CatalogItemDto, number])[],
  days = 1,
): Promise<string> {
  const { id } = await createDraftOrder(shop.owner, { customerId });
  for (const [item, quantity] of lines) {
    await addCatalogItemToOrder(shop.owner, id, {
      catalogItemId: item.id,
      quantity: String(quantity),
    });
  }
  await confirmDraftOrder(shop.owner, id, pickup(days));
  return id;
}

/** L'apartado dell'ordine com'è nel database (per gli ID e lo stato). */
async function reservationOf(orderId: string) {
  return withTenantContext(db, shop.owner, async (tx) => {
    const order = await tx.order.findFirst({
      where: { tenantId: shop.owner.tenantId, id: orderId },
      select: {
        number: true,
        inventoryEntryId: true,
        inventoryReservation: {
          select: {
            id: true,
            label: true,
            status: true,
            holdsFrom: true,
            expiresOn: true,
            usedEntryId: true,
            lines: {
              select: { item: { select: { catalogItemId: true } }, quantity: true },
            },
          },
        },
      },
    });
    return order;
  });
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);

beforeAll(async () => {
  shop = await createTestShop('Florería Apartados Pedidos');
  other = await createTestShop('Florería Ajena Apartados');
  rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa apartada' }));
  vase = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Florero apartado',
      type: 'CONTAINER',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      colors: [],
      priceMinor: 12000,
      costMinor: 5000,
    }),
  );
  await track(shop.owner, rose.id, 20);
  await track(shop.owner, vase.id, 5);
  customerId = (await createCustomer(shop.owner, customer('Lucía Apartados'))).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe('apartado di un ordine confermato', () => {
  it('alla conferma aparta i materiali fino al giorno della consegna', async () => {
    const before = await stock(rose);
    const orderId = await confirmedOrder([[rose, 12]]);
    const order = await reservationOf(orderId);
    expect(order?.inventoryReservation).toMatchObject({
      status: 'ACTIVE',
      label: expect.stringMatching(/^PED-\d+$/),
    });
    expect(iso(order?.inventoryReservation?.expiresOn)).toBe(inDays(1));
    expect(iso(order?.inventoryReservation?.holdsFrom)).toBe(inDays(1 - 7));
    expect(await stock(rose)).toEqual({
      onHand: before.onHand,
      available: (before.available ?? 0) - 12,
    });

    // Nella scheda dell'ordine la sua merce è sua: non conta come apartada per altri.
    const panel = await getOrderInventory(shop.owner, orderId);
    expect(panel?.hold).toEqual({ holdsFrom: inDays(-6), expiresOn: inDays(1), started: true });
    expect(panel?.lines[0]).toMatchObject({ requested: 12, reserved: 0, missing: 0 });

    // Nell'elenco degli apartados si vede di quale ordine è.
    const listed = await listReservations(shop.owner, { q: order?.inventoryReservation?.label });
    expect(listed.items[0]?.order).toMatchObject({ id: orderId, customerName: 'Lucía Apartados' });
    // Si trova anche per il cliente dell'ordine.
    const byCustomer = await listReservations(shop.owner, { q: 'lucía apartados' });
    expect(byCustomer.items.map((item) => item.id)).toContain(order?.inventoryReservation?.id);
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba' });
  });

  it('segue righe e giorno; un giorno lontano non toglie ancora merce', async () => {
    const before = await stock(rose);
    const orderId = await confirmedOrder([
      [rose, 4],
      [vase, 1],
    ]);
    const line = await withTenantContext(db, shop.owner, (tx) =>
      tx.orderLine.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, orderId, catalogItemId: rose.id },
      }),
    );
    await updateOrderLineQuantity(shop.owner, orderId, line.id, '6');
    expect(await stock(rose)).toMatchObject({ available: (before.available ?? 0) - 6 });

    // Consegna fra 30 giorni: l'apartado resta ma comincia 7 giorni prima.
    await updateOrderFulfillment(shop.owner, orderId, pickup(30));
    const later = await reservationOf(orderId);
    expect(iso(later?.inventoryReservation?.holdsFrom)).toBe(inDays(23));
    expect(iso(later?.inventoryReservation?.expiresOn)).toBe(inDays(30));
    expect(await stock(rose)).toMatchObject({ available: before.available });
    expect((await getOrderInventory(shop.owner, orderId))?.hold).toMatchObject({
      started: false,
    });
    const detail = await getReservation(shop.owner, later!.inventoryReservation!.id);
    expect(detail).toMatchObject({ scheduled: true, holdsFrom: inDays(23) });

    // Tolte le rose, restano solo i floreros.
    await removeOrderLine(shop.owner, orderId, line.id);
    const lines = (await reservationOf(orderId))?.inventoryReservation?.lines ?? [];
    expect(lines).toEqual([{ item: { catalogItemId: vase.id }, quantity: 1 }]);
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba' });
  });

  it('a "Listo" usa l’apartado: la merce esce una volta sola', async () => {
    const before = await stock(rose);
    const orderId = await confirmedOrder([[rose, 3]]);
    await changeOrderStatus(shop.owner, orderId, 'IN_PREPARATION');
    await changeOrderStatus(shop.owner, orderId, 'READY');
    const order = await reservationOf(orderId);
    expect(order?.inventoryReservation?.status).toBe('USED');
    expect(order?.inventoryEntryId).not.toBeNull();
    expect(order?.inventoryReservation?.usedEntryId).toBe(order?.inventoryEntryId);
    expect(await stock(rose)).toEqual({
      onHand: (before.onHand ?? 0) - 3,
      available: (before.available ?? 0) - 3,
    });
    // Tornare indietro non riaparta né riscarica.
    await changeOrderStatus(shop.owner, orderId, 'IN_PREPARATION');
    await changeOrderStatus(shop.owner, orderId, 'READY');
    expect(await stock(rose)).toMatchObject({ onHand: (before.onHand ?? 0) - 3 });
  });

  it('annullare l’ordine libera la merce', async () => {
    const before = await stock(vase);
    const orderId = await confirmedOrder([[vase, 2]]);
    expect(await stock(vase)).toMatchObject({ available: (before.available ?? 0) - 2 });
    await cancelOrder(shop.owner, orderId, { reason: 'El cliente ya no lo quiere' });
    expect((await reservationOf(orderId))?.inventoryReservation?.status).toBe('RELEASED');
    expect(await stock(vase)).toEqual(before);
  });

  it('se la merce non basta l’ordine si conferma lo stesso e si vede cosa manca', async () => {
    const before = await stock(vase);
    const orderId = await confirmedOrder([[vase, (before.available ?? 0) + 2]]);
    expect(await stock(vase)).toMatchObject({ available: -2 });
    const panel = await getOrderInventory(shop.owner, orderId);
    expect(panel?.shortages).toEqual([
      expect.objectContaining({ catalogItemId: vase.id, missing: 2 }),
    ]);
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba' });
    expect(await stock(vase)).toEqual(before);
  });

  it('senza prodotti controllati non c’è apartado', async () => {
    const { id } = await createDraftOrder(shop.owner, { customerId });
    await addCustomLineToOrder(shop.owner, id, {
      description: 'Globo metálico',
      quantity: '1',
      unitPrice: '45',
    });
    await confirmDraftOrder(shop.owner, id, pickup());
    expect((await reservationOf(id))?.inventoryReservation).toBeNull();
  });

  it('le azioni della scheda dell’apartado non toccano quello di un ordine', async () => {
    const orderId = await confirmedOrder([[rose, 1]]);
    const reservationId = (await reservationOf(orderId))!.inventoryReservation!.id;
    const reason = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: unknown) => (error instanceof ConflictError ? error.reason : error),
      );
    expect(await reason(releaseReservation(shop.owner, reservationId))).toBe(
      'inventory_reservation_order',
    );
    expect(
      await reason(extendReservation(shop.owner, reservationId, { expiresOn: inDays(5) })),
    ).toBe('inventory_reservation_order');
    expect(
      await reason(
        consumeReservation(shop.owner, reservationId, { lines: {}, confirmShortage: '' }),
      ),
    ).not.toBeNull();
    expect((await reservationOf(orderId))?.inventoryReservation?.status).toBe('ACTIVE');
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba' });
  });

  it('un’altra fioreria non vede l’apartado dell’ordine (isolamento)', async () => {
    const orderId = await confirmedOrder([[rose, 1]]);
    const reservationId = (await reservationOf(orderId))!.inventoryReservation!.id;
    await expect(getReservation(other.owner, reservationId)).rejects.toBeInstanceOf(NotFoundError);
    const listed = await listReservations(other.owner, {});
    expect(listed.items.some((item) => item.id === reservationId)).toBe(false);
    await expect(releaseReservation(other.owner, reservationId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba' });
  });
});
