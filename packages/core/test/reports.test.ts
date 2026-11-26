import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  addCatalogItemToOrder,
  addCustomLineToOrder,
  cancelOrder,
  changeOrderStatus,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  getSalesReport,
  recordOrderPayment,
  recordStockOut,
  reverseOrderPayment,
  startInventoryTracking,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Reportes (ADR-080): vendite dei pedidos consegnati nel periodo, confronto, cobrado, prodotti,
 * margine solo con i costi noti, mermas; solo chi gestisce; ogni fioreria vede le sue (A↔B).
 */

const db = getDb();
let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let customerId: string;

function tomorrow(): string {
  const today = todayInTimeZone('America/Mexico_City');
  return new Date(Date.UTC(today.year, today.month - 1, today.day + 1)).toISOString().slice(0, 10);
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

/** Un pedido confermato con `roses` rose (e un concepto libre se `custom`), poi spostato al giorno. */
async function order(
  target: TestShop,
  item: CatalogItemDto,
  options: {
    readonly roses: number;
    readonly custom?: string;
    readonly date: string;
    readonly status: 'PICKED_UP' | 'CONFIRMED' | 'CANCELLED';
  },
): Promise<string> {
  const customer =
    target === shop
      ? customerId
      : (
          await createCustomer(target.owner, {
            type: 'PERSON',
            displayName: 'Cliente Reporte Ajeno',
            legalName: null,
            taxId: null,
            email: null,
            phone: null,
            notes: null,
            preferences: null,
            restrictions: null,
            tags: [],
            acquisitionChannel: null,
            marketingConsent: false,
          })
        ).id;
  const { id } = await createDraftOrder(target.owner, { customerId: customer });
  await addCatalogItemToOrder(target.owner, id, {
    catalogItemId: item.id,
    quantity: String(options.roses),
  });
  if (options.custom) {
    await addCustomLineToOrder(target.owner, id, {
      description: 'Montaje',
      quantity: '1',
      unitPrice: options.custom,
    });
  }
  await confirmDraftOrder(target.owner, id, pickup());
  if (options.status === 'PICKED_UP') {
    await changeOrderStatus(target.owner, id, 'IN_PREPARATION');
    await changeOrderStatus(target.owner, id, 'READY', { confirmShortage: true });
    await changeOrderStatus(target.owner, id, 'PICKED_UP');
  }
  if (options.status === 'CANCELLED') {
    await cancelOrder(target.owner, id, { reason: 'Prueba de reporte' });
  }
  // Il giorno del pedido in un mese passato (il servizio accetta solo date future).
  await withTenantContext(db, target.owner, (tx) =>
    tx.order.updateMany({
      where: { tenantId: target.owner.tenantId, id },
      data: { scheduledDate: new Date(`${options.date}T00:00:00Z`) },
    }),
  );
  return id;
}

beforeAll(async () => {
  shop = await createTestShop('Florería Reportes');
  other = await createTestShop('Florería Reportes Ajena');
  rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa reporte', priceMinor: 10000, costMinor: 4000 }),
  );
  customerId = (
    await createCustomer(shop.owner, {
      type: 'PERSON',
      displayName: 'Cliente Reporte',
      legalName: null,
      taxId: null,
      email: null,
      phone: null,
      notes: null,
      preferences: null,
      restrictions: null,
      tags: [],
      acquisitionChannel: null,
      marketingConsent: false,
    })
  ).id;

  // Maggio 2026: un pedido ritirato (2 rose + montaggio senza costo, 10% di sconto), uno
  // confermato da consegnare e uno annullato. Aprile: un pedido ritirato per il confronto.
  const may = await order(shop, rose, {
    roses: 2,
    custom: '50',
    date: '2026-05-10',
    status: 'PICKED_UP',
  });
  await updateOrderDetailsDiscount(may);
  await order(shop, rose, { roses: 1, date: '2026-05-20', status: 'CONFIRMED' });
  await order(shop, rose, { roses: 3, date: '2026-05-12', status: 'CANCELLED' });
  await order(shop, rose, { roses: 1, date: '2026-04-15', status: 'PICKED_UP' });
  await recordOrderPayment(shop.owner, may, {
    amount: '100',
    method: 'CASH',
    kind: 'DEPOSIT',
    paidOn: '2026-05-10',
  });

  // L'altra fioreria vende a maggio: non deve comparire.
  const foreignRose = await createCatalogItem(
    other.owner,
    itemInput({ name: 'Rosa ajena', priceMinor: 99900, costMinor: 100 }),
  );
  await order(other, foreignRose, { roses: 5, date: '2026-05-11', status: 'PICKED_UP' });
});

/** 10% di sconto sul pedido di maggio (250.00 → 225.00), come dal form dei dettagli. */
async function updateOrderDetailsDiscount(orderId: string): Promise<void> {
  await withTenantContext(db, shop.owner, async (tx) => {
    await tx.order.updateMany({
      where: { tenantId: shop.owner.tenantId, id: orderId },
      data: { discountMinor: 2500, totalMinor: 22500 },
    });
  });
}

afterAll(async () => {
  await disconnectDb();
});

describe('reportes', () => {
  it('solo owner e manager', async () => {
    await expect(getSalesReport(shop.staff, { mes: '2026-05' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getSalesReport(shop.manager, { mes: '2026-05' })).resolves.toBeDefined();
  });

  it('vendite dei pedidos ritirati nel mese, confronto, da consegnare e cobrado', async () => {
    const report = await getSalesReport(shop.owner, { mes: '2026-05' });
    expect(report.period).toMatchObject({ kind: 'month', param: '2026-05' });
    expect(report.sales).toMatchObject({
      totalMinor: 22500,
      orders: 1,
      averageMinor: 22500,
      previous: { totalMinor: 10000, orders: 1 },
      totalChange: 125,
      ordersChange: 0,
    });
    expect(report.toDeliver).toEqual({ totalMinor: 10000, orders: 1 });
    expect(report.collectedMinor).toBe(10000);
    expect(report.chart).toHaveLength(31);
    expect(report.chart.find((bar) => bar.key === '2026-05-10')?.totalMinor).toBe(22500);
    expect(report.topProducts.map((item) => [item.name, item.quantity, item.revenueMinor])).toEqual(
      [
        ['Rosa reporte', 2, 20000],
        ['Montaje', 1, 5000],
      ],
    );
  });

  it('margine sui soli costi noti, con lo sconto ripartito, e quanto copre', async () => {
    const { margin } = await getSalesReport(shop.owner, { mes: '2026-05' });
    // Rose: 200.00 − 10% = 180.00, costo 80.00. Montaggio: 45.00 senza costo.
    expect(margin).toEqual({
      productSalesMinor: 22500,
      coveredSalesMinor: 18000,
      costMinor: 8000,
      marginMinor: 10000,
      marginPercent: 56,
      coveragePercent: 80,
      linesWithoutCost: 1,
    });
  });

  it("l'anno somma i mesi", async () => {
    const year = await getSalesReport(shop.owner, { ano: '2026' });
    expect(year.period.kind).toBe('year');
    expect(year.sales.totalMinor).toBe(32500);
    expect(year.chart.find((bar) => bar.key === '2026-04')?.totalMinor).toBe(10000);
  });

  it('ogni fioreria vede solo le sue vendite (A↔B)', async () => {
    const theirs = await getSalesReport(other.owner, { mes: '2026-05' });
    expect(theirs.sales.totalMinor).toBe(499500);
    expect(theirs.topProducts.map((item) => item.name)).toEqual(['Rosa ajena']);
    const mine = await getSalesReport(shop.owner, { mes: '2026-05' });
    expect(mine.topProducts.map((item) => item.name)).not.toContain('Rosa ajena');
  });

  it('uno storno toglie dal cobrado, non aggiunge', async () => {
    // Un pedido solo confermato (non entra nelle vendite) con due pagamenti a marzo, uno stornato.
    const id = await order(shop, rose, { roses: 1, date: '2026-03-10', status: 'CONFIRMED' });
    await recordOrderPayment(shop.owner, id, {
      amount: '30',
      method: 'CASH',
      kind: 'DEPOSIT',
      paidOn: '2026-03-10',
    });
    await recordOrderPayment(shop.owner, id, {
      amount: '20',
      method: 'TRANSFER',
      kind: 'BALANCE',
      paidOn: '2026-03-11',
    });
    const wrong = await withTenantContext(db, shop.owner, (tx) =>
      tx.orderPayment.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, orderId: id, amountMinor: 2000 },
        select: { id: true },
      }),
    );
    await reverseOrderPayment(shop.owner, id, wrong.id);
    // Lo storno nasce con la data di oggi: lo si porta a marzo come le altre date del test.
    await withTenantContext(db, shop.owner, (tx) =>
      tx.orderPayment.updateMany({
        where: { tenantId: shop.owner.tenantId, orderId: id, kind: 'REVERSAL' },
        data: { paidOn: new Date('2026-03-11T00:00:00Z') },
      }),
    );
    const march = await getSalesReport(shop.owner, { mes: '2026-03' });
    expect(march.collectedMinor).toBe(3000);
  });

  it('le mermas del mese con il loro costo', async () => {
    await startInventoryTracking(shop.owner, {
      rows: { '0': { catalogItemId: rose.id, quantity: '40', minQuantity: '' } },
    });
    const inventory = await withTenantContext(db, shop.owner, (tx) =>
      tx.inventoryItem.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, catalogItemId: rose.id },
        select: { id: true },
      }),
    );
    await recordStockOut(shop.owner, inventory.id, 'WASTE', { quantity: '3', note: 'Marchitas' });
    const report = await getSalesReport(shop.owner);
    expect(report.waste?.items).toEqual([
      expect.objectContaining({ name: 'Rosa reporte', quantity: 3 }),
    ]);
  });
});
