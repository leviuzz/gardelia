/**
 * Cronologia del cliente (CRM-01): preventivi, ordini, pagamenti e consegne in una sola linea del
 * tempo, dalla più recente; "Ver más" per pagine di 20; i dati di un'altra fioreria non compaiono
 * e il suo cliente risponde 404.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { customerTimelineLimit, todayInTimeZone } from '@floral/domain';
import {
  NotFoundError,
  addCatalogItemToQuote,
  addCustomerAddress,
  changeOrderStatus,
  changeQuoteStatus,
  createCatalogItem,
  createCustomer,
  createOrderFromQuote,
  createQuote,
  getCustomerTimeline,
  recordOrderPayment,
  type CatalogItemDto,
  type TenantContext,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;

function person(name: string) {
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

function tomorrow(ctx: TenantContext): string {
  const today = todayInTimeZone(ctx.timezone);
  return new Date(Date.UTC(today.year, today.month - 1, today.day + 1)).toISOString().slice(0, 10);
}

async function customerWithAddress(ctx: TenantContext, name: string) {
  const customerId = (await createCustomer(ctx, person(name))).id;
  const addressId = (
    await addCustomerAddress(ctx, customerId, {
      label: 'Casa',
      recipientName: name,
      recipientPhone: '449 555 0199',
      addressLine1: 'Av. Madero 120',
      addressLine2: '',
      neighborhood: 'Centro',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      deliveryNotes: '',
      isDefault: 'on',
    })
  ).id;
  return { customerId, addressId };
}

/** Preventivo accettato e convertito in ordine con consegna domani. */
async function orderFor(ctx: TenantContext, customerId: string, addressId: string) {
  const { id: quoteId } = await createQuote(ctx, { customerId });
  await addCatalogItemToQuote(ctx, quoteId, { catalogItemId: rose.id, quantity: '12' });
  await changeQuoteStatus(ctx, quoteId, 'SENT');
  await changeQuoteStatus(ctx, quoteId, 'ACCEPTED');
  const order = await createOrderFromQuote(ctx, quoteId, {
    fulfillmentMode: 'DELIVERY',
    scheduledDate: tomorrow(ctx),
    windowStart: '10:00',
    windowEnd: '13:00',
    customerAddressId: addressId,
    recipientName: '',
    recipientPhone: '',
    deliveryNotes: '',
    cardMessage: '',
    cardSignature: '',
    deliveryFee: '0',
    notes: '',
  });
  return { quoteId, orderId: order.id };
}

beforeAll(async () => {
  shop = await createTestShop('Florería Historial');
  other = await createTestShop('Florería Historial Ajena');
  rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', priceMinor: 3500, costMinor: 1400 }),
  );
});

afterAll(async () => {
  await disconnectDb();
});

describe('cronologia del cliente', () => {
  it('preventivo, ordine, pagamento e consegna, dal più recente', async () => {
    const owner = shop.owner;
    const { customerId, addressId } = await customerWithAddress(owner, 'Ana Torres');
    const { quoteId, orderId } = await orderFor(owner, customerId, addressId);
    await recordOrderPayment(owner, orderId, { amount: '200', method: 'CASH', kind: 'DEPOSIT' });
    await changeOrderStatus(shop.staff, orderId, 'IN_PREPARATION');
    await changeOrderStatus(shop.staff, orderId, 'READY');
    await changeOrderStatus(shop.staff, orderId, 'OUT_FOR_DELIVERY');
    await changeOrderStatus(shop.staff, orderId, 'DELIVERED');

    const timeline = await getCustomerTimeline(shop.staff, customerId);
    expect(timeline).toMatchObject({ hasMore: false, limit: 20 });
    // Preparazione, pronto e in viaggio restano nella scheda dell'ordine.
    expect(
      timeline.events.map((event) =>
        event.kind === 'order_status'
          ? `${event.kind}:${event.status}${event.created ? ':created' : ''}`
          : event.kind === 'quote_status'
            ? `${event.kind}:${event.status}`
            : event.kind,
      ),
    ).toEqual([
      'order_status:DELIVERED',
      'payment',
      'order_status:CONFIRMED:created',
      'quote_status:ACCEPTED',
      'quote_created',
      'customer_created',
    ]);
    expect(timeline.events[1]).toMatchObject({
      kind: 'payment',
      orderId,
      amountMinor: 20_000,
      method: 'CASH',
      paymentKind: 'DEPOSIT',
      currency: 'MXN',
    });
    expect(timeline.events.find((event) => event.kind === 'quote_created')).toMatchObject({
      quoteId,
      totalMinor: 42_000,
    });
    expect(timeline.events[0]).toMatchObject({ number: expect.stringMatching(/\d/) });
  });

  it('"Ver más": pagine di 20 fino a 200', async () => {
    expect(customerTimelineLimit(undefined)).toBe(20);
    expect(customerTimelineLimit('41')).toBe(60);
    expect(customerTimelineLimit('999')).toBe(200);
    expect(customerTimelineLimit('boh')).toBe(20);

    const owner = shop.owner;
    const { customerId } = await customerWithAddress(owner, 'Cliente con muchas cotizaciones');
    for (let index = 0; index < 21; index += 1) {
      await createQuote(owner, { customerId });
    }
    // 21 preventivi + la nascita del cliente = 22 eventi.
    const first = await getCustomerTimeline(owner, customerId);
    expect(first.events).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    const all = await getCustomerTimeline(owner, customerId, '40');
    expect(all.events).toHaveLength(22);
    expect(all.hasMore).toBe(false);
    expect(all.events.at(-1)?.kind).toBe('customer_created');
  });

  it('un’altra fioreria non vede la cronologia: 404 ed evento di sicurezza', async () => {
    const { customerId, addressId } = await customerWithAddress(shop.owner, 'Cliente privada');
    await orderFor(shop.owner, customerId, addressId);
    await expect(getCustomerTimeline(other.owner, customerId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getCustomerTimeline(other.owner, 'no-uuid')).rejects.toBeInstanceOf(NotFoundError);
    // I suoi clienti hanno solo i loro eventi.
    const own = await customerWithAddress(other.owner, 'Cliente de la otra');
    expect(
      (await getCustomerTimeline(other.owner, own.customerId)).events.map((event) => event.kind),
    ).toEqual(['customer_created']);

    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: null, entityId: customerId },
        select: { entityType: true },
      }),
    );
    expect(events.map((event) => event.entityType)).toContain('Customer');
  });
});
