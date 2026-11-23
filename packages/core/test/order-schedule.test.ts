import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  addCatalogItemToOrder,
  addCustomLineToOrder,
  addRecipeLine,
  cancelOrder,
  changeOrderStatus,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  getOrdersDay,
  getOrdersMonth,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/** Agenda degli ordini (ADR-057): giorno per fascia, Producción del día e mese. */

let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let bouquet: CatalogItemDto;
let customerId: string;
let day: string;

function isoDate(plusDays: number): string {
  const parts = todayInTimeZone(shop.owner.timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + plusDays))
    .toISOString()
    .slice(0, 10);
}

function fulfillment(overrides: Record<string, unknown> = {}) {
  return {
    fulfillmentMode: 'PICKUP',
    scheduledDate: day,
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
    ...overrides,
  };
}

/** Ordine confermato per `day` con le righe date. */
async function order(
  lines: (id: string) => Promise<void>,
  overrides: Record<string, unknown> = {},
  ctx = shop.owner,
) {
  const { id } = await createDraftOrder(ctx, { customerId });
  await lines(id);
  await confirmDraftOrder(ctx, id, fulfillment(overrides));
  return id;
}

beforeAll(async () => {
  shop = await createTestShop('Florería Agenda');
  other = await createTestShop('Florería Agenda Ajena');
  rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', priceMinor: 3500, costMinor: 1400 }),
  );
  bouquet = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Ramo 12 rosas',
      type: 'BOUQUET',
      saleUnit: 'PIECE',
      priceMinor: 69000,
      costMinor: null,
      variety: null,
    }),
  );
  await addRecipeLine(shop.owner, bouquet.id, { ingredientItemId: rose.id, quantity: 12 });
  customerId = (
    await createCustomer(shop.owner, {
      type: 'PERSON',
      displayName: 'Ana Torres',
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
  day = isoDate(3);
});

afterAll(async () => {
  await disconnectDb();
});

describe('il giorno', () => {
  it('per fascia, con la produzione sommata dalle distinte degli ordini da preparare', async () => {
    const morning = await order(
      async (id) => {
        await addCatalogItemToOrder(shop.owner, id, { catalogItemId: bouquet.id, quantity: '2' });
        await addCatalogItemToOrder(shop.owner, id, { catalogItemId: rose.id, quantity: '6' });
      },
      { windowStart: '09:00', windowEnd: '12:00', cardMessage: 'Para ti' },
    );
    const allDay = await order(async (id) => {
      await addCatalogItemToOrder(shop.owner, id, { catalogItemId: bouquet.id, quantity: '1' });
      await addCustomLineToOrder(shop.owner, id, {
        description: 'Globo metálico',
        quantity: '1',
        unitPrice: '80',
      });
    });
    // Consegnato: resta nel giorno ma non nella produzione. Annullato: fuori da tutto.
    const delivered = await order(async (id) => {
      await addCatalogItemToOrder(shop.owner, id, { catalogItemId: bouquet.id, quantity: '5' });
    });
    await changeOrderStatus(shop.staff, delivered, 'READY');
    await changeOrderStatus(shop.staff, delivered, 'PICKED_UP');
    const cancelled = await order(async (id) => {
      await addCatalogItemToOrder(shop.owner, id, { catalogItemId: bouquet.id, quantity: '9' });
    });
    await cancelOrder(shop.owner, cancelled, { reason: 'No lo necesita' });
    // Borrador: non ha data, non c'è.
    const { id: draft } = await createDraftOrder(shop.owner, { customerId });

    const view = await getOrdersDay(shop.staff, day);
    expect(view.date).toBe(day);
    expect(view.isToday).toBe(false);
    const ids = view.groups.flatMap((group) => group.orders.map((o) => o.id));
    expect(ids).toEqual(expect.arrayContaining([morning, allDay, delivered]));
    expect(ids).not.toContain(cancelled);
    expect(ids).not.toContain(draft);
    // "En el día" prima, poi le fasce in ordine.
    expect(view.groups.map((group) => group.start)).toEqual([null, '09:00']);
    const morningCard = view.groups[1]!.orders[0]!;
    expect(morningCard).toMatchObject({
      hasCard: true,
      fulfillmentMode: 'PICKUP',
      nextSteps: ['IN_PREPARATION', 'READY'],
    });
    expect(view.counts).toEqual({ total: 3, deliveries: 0, pickups: 3, pending: 2 });

    expect(view.productionOrders).toBe(2);
    expect(view.production.bouquets).toBe(3);
    expect(view.production.items).toEqual([
      {
        name: 'Rosa roja',
        variety: 'Freedom',
        color: null,
        saleUnit: 'STEM',
        quantity: 3 * 12 + 6,
      },
    ]);
    expect(view.production.custom).toEqual([{ description: 'Globo metálico', quantity: 1 }]);
    expect(JSON.stringify(view)).not.toMatch(/cost|Cost/);
  });

  it('una data non valida mostra oggi', async () => {
    const view = await getOrdersDay(shop.owner, 'ieri');
    expect(view.isToday).toBe(true);
  });
});

describe('il mese', () => {
  it('conta consegne e ritiri per giorno, senza annullati', async () => {
    const month = await getOrdersMonth(shop.owner, day.slice(0, 7));
    expect(month.days.find((entry) => entry.date === day)).toEqual({
      date: day,
      deliveries: 0,
      pickups: 3,
    });
    const fallback = await getOrdersMonth(shop.owner, '2026-13');
    const today = todayInTimeZone(shop.owner.timezone);
    expect([fallback.year, fallback.month]).toEqual([today.year, today.month]);
  });
});

describe('isolamento', () => {
  it('un’altra fioreria vede la sua agenda vuota; serve il permesso di lettura', async () => {
    const view = await getOrdersDay(other.owner, day);
    expect(view.groups).toEqual([]);
    expect(view.production.items).toEqual([]);
    expect((await getOrdersMonth(other.owner, day.slice(0, 7))).days).toEqual([]);
    await expect(
      getOrdersDay({ ...shop.staff, role: 'NONE' } as never, day),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
