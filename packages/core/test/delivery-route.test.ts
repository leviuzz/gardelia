import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addCatalogItemToOrder,
  addCustomerAddress,
  assignOrder,
  changeOrderStatus,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  getDeliveryRoute,
  getOrder,
  listOrderAssignees,
  setMemberActive,
  updateOrderFulfillment,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/** Ruta del día e repartidor (ADR-058). */

const db = getDb();
let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let customerId: string;
let addressId: string;
let day: string;

function isoDate(plusDays: number): string {
  const parts = todayInTimeZone(shop.owner.timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + plusDays))
    .toISOString()
    .slice(0, 10);
}

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    fulfillmentMode: 'DELIVERY',
    scheduledDate: day,
    windowStart: '',
    windowEnd: '',
    customerAddressId: addressId,
    recipientName: '',
    recipientPhone: '',
    deliveryNotes: '',
    cardMessage: '',
    cardSignature: '',
    deliveryFee: '50',
    notes: 'interna',
    ...overrides,
  };
}

async function confirmed(overrides: Record<string, unknown> = {}) {
  const { id } = await createDraftOrder(shop.owner, { customerId });
  await addCatalogItemToOrder(shop.owner, id, { catalogItemId: rose.id, quantity: '3' });
  await confirmDraftOrder(shop.owner, id, delivery(overrides));
  return id;
}

beforeAll(async () => {
  shop = await createTestShop('Florería Ruta');
  other = await createTestShop('Florería Ruta Ajena');
  rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa roja', priceMinor: 3500 }));
  customerId = (
    await createCustomer(shop.owner, {
      type: 'PERSON',
      displayName: 'Ana Torres',
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
    })
  ).id;
  addressId = (
    await addCustomerAddress(shop.owner, customerId, {
      label: 'Casa',
      recipientName: 'Rosa Torres',
      recipientPhone: '449 555 0199',
      addressLine1: 'Av. Madero 120',
      addressLine2: '',
      neighborhood: 'Centro',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      deliveryNotes: 'Portón verde',
      isDefault: 'on',
    })
  ).id;
  day = isoDate(4);
});

afterAll(async () => {
  await disconnectDb();
});

describe('repartidor', () => {
  it('si assegna a un membro attivo; solo agli ordini a domicilio aperti', async () => {
    const id = await confirmed();
    const options = await listOrderAssignees(shop.manager);
    expect(options.map((option) => option.membershipId)).toContain(shop.staff.membershipId);

    await assignOrder(shop.manager, id, shop.staff.membershipId);
    expect((await getOrder(shop.owner, id)).assignee?.membershipId).toBe(shop.staff.membershipId);
    await assignOrder(shop.manager, id, '');
    expect((await getOrder(shop.owner, id)).assignee).toBeNull();

    await expect(assignOrder(shop.manager, id, other.staff.membershipId)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(assignOrder(shop.staff, id, shop.staff.membershipId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(assignOrder(other.owner, id, other.staff.membershipId)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // Un ritiro non ha repartidor.
    const pickup = await confirmed({
      fulfillmentMode: 'PICKUP',
      customerAddressId: '',
      deliveryFee: '',
    });
    await expect(assignOrder(shop.owner, pickup, shop.staff.membershipId)).rejects.toMatchObject({
      reason: 'order_not_delivery',
    });
  });

  it('passando a ritiro il repartidor si toglie; il database lo garantisce', async () => {
    const id = await confirmed();
    await assignOrder(shop.owner, id, shop.staff.membershipId);
    await updateOrderFulfillment(
      shop.owner,
      id,
      delivery({ fulfillmentMode: 'PICKUP', customerAddressId: '', deliveryFee: '' }),
    );
    expect((await getOrder(shop.owner, id)).assignee).toBeNull();
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.order.update({
          where: { id },
          data: { assignedMembershipId: shop.staff.membershipId },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('ruta del día', () => {
  it('fermate a domicilio per fascia, "in giornata" in fondo, con cosa incassare', async () => {
    const late = await confirmed({ windowStart: '15:00', windowEnd: '18:00' });
    const early = await confirmed({ windowStart: '09:00', windowEnd: '12:00' });
    const anytime = await confirmed();
    const done = await confirmed({ windowStart: '10:00', windowEnd: '11:00' });
    for (const step of ['READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const) {
      await changeOrderStatus(shop.staff, done, step);
    }
    await assignOrder(shop.owner, early, shop.staff.membershipId);

    const route = await getDeliveryRoute(shop.staff, day);
    const ids = route.stops.map((stop) => stop.id);
    expect(ids.indexOf(early)).toBeLessThan(ids.indexOf(late));
    expect(ids.indexOf(late)).toBeLessThan(ids.indexOf(anytime));
    expect(ids).not.toContain(done);
    expect(route.delivered.map((stop) => stop.id)).toContain(done);
    const first = route.stops.find((stop) => stop.id === early)!;
    expect(first).toMatchObject({
      recipientName: 'Rosa Torres',
      deliveryNotes: 'Portón verde',
      assignedToMe: true,
      balanceMinor: 3 * 3500 + 5000,
      nextSteps: ['IN_PREPARATION', 'READY'],
    });
    expect(first.address).toContain('Av. Madero 120');
    expect(first.address).toContain('Aguascalientes');
    expect(route.unassigned).toBeGreaterThan(0);
    expect(JSON.stringify(route)).not.toMatch(/interna|cost/i);

    const mine = await getDeliveryRoute(shop.staff, day, { mine: true });
    expect(mine.stops.map((stop) => stop.id)).toEqual([early]);
  });

  it('un’altra fioreria vede la sua ruta vuota', async () => {
    const route = await getDeliveryRoute(other.owner, day);
    expect(route.stops).toEqual([]);
    expect(route.delivered).toEqual([]);
  });

  it('un membro disattivato non è più assegnabile', async () => {
    const id = await confirmed();
    await setMemberActive(shop.owner, shop.staff.membershipId, false);
    try {
      expect((await listOrderAssignees(shop.owner)).map((o) => o.membershipId)).not.toContain(
        shop.staff.membershipId,
      );
      await expect(assignOrder(shop.owner, id, shop.staff.membershipId)).rejects.toBeInstanceOf(
        ValidationError,
      );
    } finally {
      await setMemberActive(shop.owner, shop.staff.membershipId, true);
    }
  });
});
