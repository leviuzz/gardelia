import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  ValidationError,
  addCatalogItemToOrder,
  addCatalogItemToQuote,
  addRecipeLine,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  createQuote,
  createSupplier,
  getCatalogItem,
  getOrder,
  getOrdersDay,
  getQuote,
  getRestockList,
  setSupplierArchived,
  startInventoryTracking,
  updateCatalogItem,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Catalogo e approvvigionamento (ADR-081): proveedor habitual dei prodotti e "Por pedir", durata e
 * raggio dei servizi (nella riga e nell'avviso del pedido), tempo di preparazione nella Producción
 * del día. Ogni fioreria vede e usa solo i suoi proveedores (A↔B).
 */

const db = getDb();
let shop: TestShop;
let other: TestShop;
let rose: CatalogItemDto;
let customerId: string;

const STORE = { latitude: 21.8818, longitude: -102.2916 };

function isoDate(plusDays: number): string {
  const parts = todayInTimeZone(shop.owner.timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + plusDays))
    .toISOString()
    .slice(0, 10);
}

function fulfillment(overrides: Record<string, unknown> = {}) {
  return {
    fulfillmentMode: 'PICKUP',
    scheduledDate: isoDate(2),
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

function serviceInput(overrides: Record<string, unknown> = {}) {
  return itemInput({
    type: 'SERVICE',
    name: 'Montaje de evento',
    saleUnit: 'SERVICE',
    variety: null,
    colors: [],
    heightCm: null,
    priceMinor: 150000,
    costMinor: null,
    tags: [],
    ...overrides,
  });
}

beforeAll(async () => {
  shop = await createTestShop('Florería Proveedores');
  other = await createTestShop('Florería Proveedores Ajena');
  rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa proveedor' }));
  customerId = (
    await createCustomer(shop.owner, {
      type: 'PERSON',
      displayName: 'Cliente Servicio',
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
});

afterAll(async () => {
  await disconnectDb();
});

describe('proveedor habitual', () => {
  it('si sceglie, resta se il form non lo manda e si toglie', async () => {
    const supplier = await createSupplier(shop.owner, { name: 'Flores del Bajío' });
    const item = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Eucalipto', type: 'FOLIAGE', saleUnit: 'BUNCH', supplierId: supplier.id }),
    );
    expect(item).toMatchObject({ supplierId: supplier.id, supplierName: 'Flores del Bajío' });

    // Senza il campo (chi modifica senza il piano dell'inventario) il proveedor resta.
    const kept = await updateCatalogItem(
      shop.owner,
      item.id,
      itemInput({ name: 'Eucalipto baby', type: 'FOLIAGE', saleUnit: 'BUNCH' }),
    );
    expect(kept.supplierId).toBe(supplier.id);

    const cleared = await updateCatalogItem(
      shop.owner,
      item.id,
      itemInput({ name: 'Eucalipto baby', type: 'FOLIAGE', saleUnit: 'BUNCH', supplierId: null }),
    );
    expect(cleared).toMatchObject({ supplierId: null, supplierName: null });
  });

  it('un proveedor archiviato non si sceglie, ma quello già scelto resta', async () => {
    const supplier = await createSupplier(shop.owner, { name: 'Mercado de Abastos' });
    const item = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Clavel proveedor', supplierId: supplier.id }),
    );
    await setSupplierArchived(shop.owner, supplier.id, true);
    await expect(
      updateCatalogItem(
        shop.owner,
        rose.id,
        itemInput({ name: 'Rosa proveedor', supplierId: supplier.id }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const again = await updateCatalogItem(
      shop.owner,
      item.id,
      itemInput({ name: 'Clavel proveedor rojo', supplierId: supplier.id }),
    );
    expect(again.supplierId).toBe(supplier.id);
  });

  it('il proveedor di un’altra fioreria non si può usare (A↔B)', async () => {
    const foreign = await createSupplier(other.owner, { name: 'Proveedor ajeno' });
    await expect(
      createCatalogItem(shop.owner, itemInput({ name: 'Rosa ajena', supplierId: foreign.id })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateCatalogItem(
        shop.owner,
        rose.id,
        itemInput({ name: 'Rosa proveedor', supplierId: foreign.id }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await getCatalogItem(shop.owner, rose.id)).supplierId).toBeNull();
  });

  it('i servizi non hanno proveedor', async () => {
    const supplier = await createSupplier(shop.owner, { name: 'Proveedor servicio' });
    const service = await createCatalogItem(shop.owner, serviceInput({ supplierId: supplier.id }));
    expect(service.supplierId).toBeNull();
  });
});

describe('por pedir', () => {
  it('i prodotti che finiscono, per proveedor, gli agotados prima; senza proveedor in fondo', async () => {
    const kit = await createTestShop('Florería Por Pedir');
    const supplier = await createSupplier(kit.owner, {
      name: 'Bajío Flores',
      phone: '449 555 0199',
    });
    const [tulip, gerbera, ribbon, plenty] = await Promise.all([
      createCatalogItem(kit.owner, itemInput({ name: 'Tulipán', supplierId: supplier.id })),
      createCatalogItem(kit.owner, itemInput({ name: 'Gerbera', supplierId: supplier.id })),
      createCatalogItem(
        kit.owner,
        itemInput({ name: 'Listón', type: 'ACCESSORY', saleUnit: 'PIECE', colors: [] }),
      ),
      createCatalogItem(kit.owner, itemInput({ name: 'Rosa abundante', supplierId: supplier.id })),
    ]);
    await startInventoryTracking(kit.owner, {
      rows: {
        '0': { catalogItemId: tulip.id, quantity: '3', minQuantity: '20' },
        '1': { catalogItemId: gerbera.id, quantity: '0', minQuantity: '10' },
        '2': { catalogItemId: ribbon.id, quantity: '1', minQuantity: '5' },
        '3': { catalogItemId: plenty.id, quantity: '100', minQuantity: '10' },
      },
    });

    const groups = await getRestockList(kit.owner);
    expect(
      groups?.map((group) => [group.supplier?.name ?? null, group.items.map((i) => i.name)]),
    ).toEqual([
      ['Bajío Flores', ['Gerbera', 'Tulipán']],
      [null, ['Listón']],
    ]);
    expect(groups?.[0]?.supplier?.phone).toBe('+524495550199');
    expect(groups?.[0]?.items[1]).toMatchObject({ available: 3, minQuantity: 20, status: 'LOW' });

    // Solo chi compra: lo staff no. E ogni fioreria vede la sua lista.
    await expect(getRestockList(kit.staff)).rejects.toBeInstanceOf(ForbiddenError);
    const theirs = await getRestockList(other.owner);
    expect(theirs?.flatMap((group) => group.items.map((i) => i.name))).not.toContain('Tulipán');
  });
});

describe('servizi', () => {
  it('durata e raggio solo per i servizi; il tempo di preparazione no', async () => {
    const service = await createCatalogItem(
      shop.owner,
      serviceInput({ serviceDurationMinutes: 180, serviceRadiusKm: 15, prepMinutes: 30 }),
    );
    expect(service).toMatchObject({
      serviceDurationMinutes: 180,
      serviceRadiusKm: 15,
      prepMinutes: null,
    });
    const flower = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Rosa sin servicio', serviceDurationMinutes: 60, serviceRadiusKm: 5 }),
    );
    expect(flower).toMatchObject({ serviceDurationMinutes: null, serviceRadiusKm: null });
    await expect(
      createCatalogItem(shop.owner, serviceInput({ serviceRadiusKm: 500 })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('la riga del preventivo porta la durata e il raggio concordati', async () => {
    const service = await createCatalogItem(
      shop.owner,
      serviceInput({
        name: 'Decoración de iglesia',
        serviceDurationMinutes: 240,
        serviceRadiusKm: 20,
      }),
    );
    const quote = await createQuote(shop.owner, { customerId });
    await addCatalogItemToQuote(shop.owner, quote.id, { catalogItemId: service.id, quantity: '1' });
    // Cambiare il catalogo dopo non cambia quanto detto al cliente.
    await updateCatalogItem(
      shop.owner,
      service.id,
      serviceInput({
        name: 'Decoración de iglesia',
        serviceDurationMinutes: 60,
        serviceRadiusKm: 5,
      }),
    );
    const detail = await getQuote(shop.owner, quote.id);
    expect(detail.lines[0]?.service).toEqual({ durationMinutes: 240, radiusKm: 20 });
  });

  it('il pedido avvisa se l’indirizzo è oltre il raggio di un servizio', async () => {
    const service = await createCatalogItem(
      shop.owner,
      serviceInput({ name: 'Montaje lejano', serviceDurationMinutes: 120, serviceRadiusKm: 10 }),
    );
    const { id } = await createDraftOrder(shop.owner, { customerId });
    await addCatalogItemToOrder(shop.owner, id, { catalogItemId: service.id, quantity: '1' });
    await confirmDraftOrder(shop.owner, id, fulfillment());
    // Fioreria e indirizzo con le coordinate di Google (qui scritte a mano): 18 km a nord.
    await withTenantContext(db, shop.owner, async (tx) => {
      await tx.location.updateMany({
        where: { tenantId: shop.owner.tenantId, isPrimary: true },
        data: { ...STORE, coordinatesAt: new Date() },
      });
      await tx.order.updateMany({
        where: { tenantId: shop.owner.tenantId, id },
        data: {
          fulfillmentMode: 'DELIVERY',
          deliveryAddressLine1: 'Calle Lejana 1',
          deliveryCity: 'Aguascalientes',
          deliveryRegion: 'AGU',
          deliveryPostalCode: '20000',
          deliveryCountryCode: 'MX',
          deliveryLatitude: STORE.latitude + 18 * 0.008993,
          deliveryLongitude: STORE.longitude,
          deliveryCoordinatesAt: new Date(),
        },
      });
    });
    const order = await getOrder(shop.owner, id);
    expect(order.lines[0]?.service).toEqual({ durationMinutes: 120, radiusKm: 10 });
    expect(order.serviceZone?.lines).toEqual([{ description: 'Montaje lejano', radiusKm: 10 }]);
    expect(order.serviceZone?.distanceKm).toBeCloseTo(18, 0);

    // Senza le coordinate dell'indirizzo non si misura: nessun avviso inventato.
    await withTenantContext(db, shop.owner, (tx) =>
      tx.order.updateMany({
        where: { tenantId: shop.owner.tenantId, id },
        data: { deliveryLatitude: null, deliveryLongitude: null, deliveryCoordinatesAt: null },
      }),
    );
    expect((await getOrder(shop.owner, id)).serviceZone).toBeNull();
  });
});

describe('tempo di preparazione', () => {
  it('la Producción del día somma i minuti dei ramos e dice quanti non lo hanno', async () => {
    const kit = await createTestShop('Florería Tiempos');
    const flower = await createCatalogItem(kit.owner, itemInput({ name: 'Rosa tiempo' }));
    const timed = await createCatalogItem(
      kit.owner,
      itemInput({
        name: 'Ramo con tiempo',
        type: 'BOUQUET',
        saleUnit: 'PIECE',
        variety: null,
        prepMinutes: 25,
      }),
    );
    const untimed = await createCatalogItem(
      kit.owner,
      itemInput({ name: 'Ramo sin tiempo', type: 'BOUQUET', saleUnit: 'PIECE', variety: null }),
    );
    for (const bouquet of [timed, untimed]) {
      await addRecipeLine(kit.owner, bouquet.id, { ingredientItemId: flower.id, quantity: 6 });
    }
    const customer = await createCustomer(kit.owner, {
      type: 'PERSON',
      displayName: 'Cliente Tiempos',
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
    });
    const { id } = await createDraftOrder(kit.owner, { customerId: customer.id });
    await addCatalogItemToOrder(kit.owner, id, { catalogItemId: timed.id, quantity: '3' });
    await addCatalogItemToOrder(kit.owner, id, { catalogItemId: untimed.id, quantity: '1' });
    const day = (() => {
      const parts = todayInTimeZone(kit.owner.timezone);
      return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 2))
        .toISOString()
        .slice(0, 10);
    })();
    await confirmDraftOrder(kit.owner, id, fulfillment({ scheduledDate: day }));
    const view = await getOrdersDay(kit.owner, day);
    expect(view.production).toMatchObject({
      bouquets: 4,
      prepMinutes: 75,
      bouquetsWithoutPrepTime: 1,
    });
  });
});
