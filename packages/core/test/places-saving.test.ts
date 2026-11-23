import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  addCatalogItemToOrder,
  addCustomerAddress,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  getAddressSearchSettings,
  getCustomer,
  getDeliveryRoute,
  getOrder,
  getTenantSettings,
  setPlacesProvider,
  updateCustomerAddress,
  updateOrderFulfillment,
  updatePrimaryLocation,
  type CatalogItemDto,
  type PlacesProvider,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Google Places (ADR-059): place ID e coordinate salvati da un indirizzo scelto fra i
 * suggerimenti, mai allungati salvando, tolti se l'indirizzo si scrive a mano; la ruta li usa
 * per ordinare le fermate per vicinanza.
 */

const db = getDb();
let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let customerId: string;
let day: string;

const SHOP = { latitude: 21.8818, longitude: -102.2916 };
const NEAR = { latitude: 21.885, longitude: -102.29 };
const MID = { latitude: 21.9, longitude: -102.3 };
const FAR = { latitude: 21.95, longitude: -102.32 };

const fakeProvider: PlacesProvider = {
  id: 'fake',
  autocomplete: async () => [],
  details: async () => null,
};

function isoDate(plusDays: number): string {
  const parts = todayInTimeZone(shop.owner.timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + plusDays))
    .toISOString()
    .slice(0, 10);
}

function address(overrides: Record<string, unknown> = {}) {
  return {
    label: '',
    recipientName: '',
    recipientPhone: '',
    addressLine1: 'Av. Madero 120',
    addressLine2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryNotes: '',
    ...overrides,
  };
}

function place(id: string, at: { latitude: number; longitude: number }) {
  return { placeId: id, latitude: String(at.latitude), longitude: String(at.longitude) };
}

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    fulfillmentMode: 'DELIVERY',
    scheduledDate: day,
    windowStart: '10:00',
    windowEnd: '13:00',
    customerAddressId: '',
    ...address(),
    cardMessage: '',
    cardSignature: '',
    deliveryFee: '',
    notes: '',
    ...overrides,
  };
}

async function confirmed(overrides: Record<string, unknown> = {}) {
  const { id } = await createDraftOrder(shop.owner, { customerId });
  await addCatalogItemToOrder(shop.owner, id, { catalogItemId: rose.id, quantity: '1' });
  await confirmDraftOrder(shop.owner, id, delivery(overrides));
  return id;
}

async function storedAddress(id: string) {
  return withTenantContext(db, shop.owner, (tx) =>
    tx.customerAddress.findFirstOrThrow({
      where: { id, tenantId: shop.owner.tenantId },
      select: { placeId: true, latitude: true, longitude: true, coordinatesAt: true },
    }),
  );
}

async function storedOrder(id: string) {
  return withTenantContext(db, shop.owner, (tx) =>
    tx.order.findFirstOrThrow({
      where: { id, tenantId: shop.owner.tenantId },
      select: {
        deliveryPlaceId: true,
        deliveryLatitude: true,
        deliveryLongitude: true,
        deliveryCoordinatesAt: true,
      },
    }),
  );
}

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  shop = await createTestShop('Florería Lugares');
  other = await createTestShop('Florería Lugares Ajena');
  rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa roja', priceMinor: 3500 }));
  customerId = (
    await createCustomer(shop.owner, {
      type: 'PERSON',
      displayName: 'Lucía Pérez',
      legalName: null,
      taxId: null,
      email: null,
      phone: '+524495550177',
      notes: null,
      preferences: null,
      restrictions: null,
      tags: [],
      acquisitionChannel: null,
      marketingConsent: false,
    })
  ).id;
  day = isoDate(5);
});

afterEach(() => {
  setPlacesProvider(undefined);
});

afterAll(async () => {
  await disconnectDb();
});

describe('indirizzi dei clienti', () => {
  it('salva place ID e coordinate del suggerimento; salvare di nuovo non allunga la cache', async () => {
    const { id } = await addCustomerAddress(
      shop.owner,
      customerId,
      address(place('ChIJ_madero_120', NEAR)),
    );
    const first = await storedAddress(id);
    expect(first).toMatchObject({ placeId: 'ChIJ_madero_120', ...NEAR });
    expect(first.coordinatesAt).toBeInstanceOf(Date);
    const customer = await getCustomer(shop.owner, customerId);
    expect(customer.addresses.find((item) => item.id === id)?.placeId).toBe('ChIJ_madero_120');

    // Una modifica rimanda solo il place ID: le coordinate salvate non tornano nel form.
    await updateCustomerAddress(
      shop.owner,
      customerId,
      id,
      address({ placeId: 'ChIJ_madero_120', addressLine2: 'Depto 3' }),
    );
    const again = await storedAddress(id);
    expect(again).toMatchObject({ placeId: 'ChIJ_madero_120', ...NEAR });
    expect(again.coordinatesAt?.getTime()).toBe(first.coordinatesAt?.getTime());
  });

  it('un indirizzo scritto a mano non ha place ID né coordinate', async () => {
    const { id } = await addCustomerAddress(
      shop.owner,
      customerId,
      address(place('ChIJ_madero_120', NEAR)),
    );
    await updateCustomerAddress(shop.owner, customerId, id, address({ addressLine1: 'Juárez 5' }));
    expect(await storedAddress(id)).toEqual({
      placeId: null,
      latitude: null,
      longitude: null,
      coordinatesAt: null,
    });
  });

  it('coordinate non valide si scartano senza bloccare il salvataggio', async () => {
    const { id } = await addCustomerAddress(
      shop.owner,
      customerId,
      address({ placeId: 'ChIJ_madero_120', latitude: '200', longitude: 'x' }),
    );
    expect(await storedAddress(id)).toEqual({
      placeId: 'ChIJ_madero_120',
      latitude: null,
      longitude: null,
      coordinatesAt: null,
    });
  });
});

describe('sede della fioreria e ricerca', () => {
  it('senza chiave la ricerca non c’è; con la chiave preferisce i dintorni della fioreria', async () => {
    setPlacesProvider(null);
    expect(await getAddressSearchSettings(shop.staff)).toEqual({ enabled: false, near: null });

    await updatePrimaryLocation(shop.owner, {
      addressLine1: 'Av. López Mateos 300',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      deliveryRadiusKm: '',
      ...place('ChIJ_tienda_300', SHOP),
    });
    expect((await getTenantSettings(shop.owner)).location?.placeId).toBe('ChIJ_tienda_300');

    setPlacesProvider(fakeProvider);
    expect(await getAddressSearchSettings(shop.staff)).toEqual({ enabled: true, near: SHOP });
    // Ogni fioreria vede solo le sue coordinate.
    expect(await getAddressSearchSettings(other.staff)).toEqual({ enabled: true, near: null });

    // Oltre i 30 giorni le coordinate non si usano più (e il lavoro notturno le cancella).
    await withTenantContext(db, shop.owner, (tx) =>
      tx.location.updateMany({
        where: { tenantId: shop.owner.tenantId, isPrimary: true },
        data: { coordinatesAt: daysAgo(31) },
      }),
    );
    expect(await getAddressSearchSettings(shop.staff)).toEqual({ enabled: true, near: null });

    // Rimettere il suggerimento le aggiorna anche senza altre modifiche all'indirizzo.
    await updatePrimaryLocation(shop.owner, {
      addressLine1: 'Av. López Mateos 300',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      deliveryRadiusKm: '',
      ...place('ChIJ_tienda_300', SHOP),
    });
    expect(await getAddressSearchSettings(shop.staff)).toEqual({ enabled: true, near: SHOP });
  });
});

describe('ordini e ruta', () => {
  it('un indirizzo nuovo salva il luogo; dalla rubrica lo copia; il ritiro lo toglie', async () => {
    const fresh = await confirmed(place('ChIJ_nuevo_1', MID));
    expect(await storedOrder(fresh)).toMatchObject({
      deliveryPlaceId: 'ChIJ_nuevo_1',
      deliveryLatitude: MID.latitude,
      deliveryLongitude: MID.longitude,
    });
    expect((await getOrder(shop.owner, fresh)).deliveryAddress?.placeId).toBe('ChIJ_nuevo_1');

    const saved = await addCustomerAddress(
      shop.owner,
      customerId,
      address(place('ChIJ_rubrica_1', FAR)),
    );
    const fromBook = await confirmed({ customerAddressId: saved.id });
    const book = await storedAddress(saved.id);
    expect(await storedOrder(fromBook)).toEqual({
      deliveryPlaceId: 'ChIJ_rubrica_1',
      deliveryLatitude: FAR.latitude,
      deliveryLongitude: FAR.longitude,
      // Stessa data della rubrica: copiarle non allunga la cache.
      deliveryCoordinatesAt: book.coordinatesAt,
    });

    // Modifica con lo stesso place ID: coordinate e data restano.
    const before = await storedOrder(fresh);
    await updateOrderFulfillment(
      shop.owner,
      fresh,
      delivery({ placeId: 'ChIJ_nuevo_1', deliveryNotes: 'Timbre 2' }),
    );
    expect(await storedOrder(fresh)).toEqual(before);

    await updateOrderFulfillment(shop.owner, fresh, delivery({ fulfillmentMode: 'PICKUP' }));
    expect(await storedOrder(fresh)).toEqual({
      deliveryPlaceId: null,
      deliveryLatitude: null,
      deliveryLongitude: null,
      deliveryCoordinatesAt: null,
    });
  });

  it('dentro la fascia le fermate vanno per vicinanza dalla fioreria; senza coordinate in fondo', async () => {
    const routeDay = isoDate(6);
    const at = (overrides: Record<string, unknown>) =>
      confirmed({ scheduledDate: routeDay, ...overrides });
    // Creati in disordine: per numero sarebbero lontano, senza coordinate, vicino, a metà.
    const far = await at(place('ChIJ_lejos', FAR));
    const unlocated = await at({});
    const near = await at(place('ChIJ_cerca', NEAR));
    const mid = await at(place('ChIJ_medio', MID));
    const stale = await at(place('ChIJ_viejo', NEAR));
    await withTenantContext(db, shop.owner, (tx) =>
      tx.order.update({ where: { id: stale }, data: { deliveryCoordinatesAt: daysAgo(31) } }),
    );
    // Una fascia successiva resta dopo, qualunque sia la distanza.
    const later = await at({
      ...place('ChIJ_tarde', NEAR),
      windowStart: '15:00',
      windowEnd: '18:00',
    });

    const route = await getDeliveryRoute(shop.staff, routeDay);
    expect(route.orderedByDistance).toBe(true);
    const ids = route.stops.map((stop) => stop.id);
    expect(ids.slice(0, 3)).toEqual([near, mid, far]);
    // Senza coordinate (o scadute) dopo quelle ordinate, nell'ordine di prima.
    expect(ids.slice(3, 5)).toEqual([unlocated, stale]);
    expect(ids[5]).toBe(later);
  });

  it('senza coordinate la ruta resta per fascia e numero', async () => {
    const plainDay = isoDate(7);
    const first = await confirmed({ scheduledDate: plainDay });
    const second = await confirmed({ scheduledDate: plainDay });
    const route = await getDeliveryRoute(shop.staff, plainDay);
    expect(route.orderedByDistance).toBe(false);
    expect(route.stops.map((stop) => stop.id)).toEqual([first, second]);
  });

  it('un’altra fioreria non vede le fermate', async () => {
    const route = await getDeliveryRoute(other.staff, isoDate(6));
    expect(route.stops).toEqual([]);
  });
});
