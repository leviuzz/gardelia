import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { addDays, dayOfWeek, toIsoDate, todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  NotFoundError,
  ValidationError,
  addBuyerAddress,
  addDeliveryFeeTier,
  createCatalogItem,
  getCheckoutForm,
  getDeliverySettings,
  getOrder,
  placeMarketplaceOrder,
  removeDeliveryFeeTier,
  setOnlineStorePublished,
  updateDeliverySettings,
  updateOnlineOrderSettings,
  updateOnlineStore,
  updatePrimaryLocation,
  updateTenantProfile,
  type BuyerContext,
  type OrderMailDeps,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Costo di consegna per distanza (ADR-069): fasce nelle impostazioni e costo deciso dal server per
 * gli ordini online, dalla posizione della tienda a quella dell'indirizzo (in linea retta).
 */

const db = getDb();
const deps: OrderMailDeps = {
  mailer: new MemoryMailer(),
  appUrl: 'http://localhost:3000',
  secret: 'segreto-di-prova-per-i-link-pubblici-0123456789',
  links: {
    order: (slug, id) => `http://localhost:3000/app/${slug}/orders/${id}`,
    account: 'http://localhost:3000/cuenta',
    search: 'http://localhost:3000/',
  },
};
const STORE = { latitude: 21.8818, longitude: -102.2916 };
/** Un punto a `km` a nord della tienda (~0.008993 gradi di latitudine per km). */
const north = (km: number) => ({
  latitude: STORE.latitude + km * 0.008993,
  longitude: STORE.longitude,
});

let shop: TestShop;
let other: TestShop;
let itemId: string;
let buyer: BuyerContext;

function nextOpenDay(): string {
  let day = addDays(todayInTimeZone('America/Mexico_City'), 1);
  while (dayOfWeek(day) === 0) day = addDays(day, 1);
  return toIsoDate(day);
}

/** Un indirizzo nuovo scelto da Google (place ID e coordinate dai campi nascosti del modulo). */
function orderTo(point: { latitude: number; longitude: number }, extra = {}) {
  return {
    [`qty.${itemId}`]: '1',
    fulfillmentMode: 'DELIVERY',
    scheduledDate: nextOpenDay(),
    window: '',
    buyerAddressId: '',
    addressLine1: 'Calle Prueba 1',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    placeId: `ChIJ_entrega_${Math.round(point.latitude * 10000)}`,
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    contactPhone: '449 555 0101',
    ...extra,
  };
}

beforeAll(async () => {
  shop = await createTestShop('Florería Distancia');
  other = await createTestShop('Florería Distancia Ajena');
  await updateTenantProfile(shop.owner, {
    displayName: 'Florería Distancia',
    contactEmail: '',
    contactPhone: '449 555 0100',
    timezone: 'America/Mexico_City',
  });
  await updatePrimaryLocation(shop.owner, {
    addressLine1: 'Av. Madero 1',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryRadiusKm: '',
    placeId: 'ChIJ_tienda_distancia',
    latitude: String(STORE.latitude),
    longitude: String(STORE.longitude),
  });
  await updateDeliverySettings(shop.owner, { closedWeekdays: ['0'], defaultFee: '50' });
  const item = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'BOUQUET',
      name: 'Ramo',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 50000,
      isOnline: true,
    }),
  );
  itemId = item.id;
  await updateOnlineStore(shop.owner, {
    description: '',
    paymentMethods: ['CASH'],
    paymentInstructions: '',
  });
  await setOnlineStorePublished(shop.owner, true);
  await updateOnlineOrderSettings(shop.owner, { ordersEnabled: 'on', minLeadDays: '1' });
  buyer = { userId: (await createTestUser(db)).id, country: 'MX' };
});

afterAll(async () => {
  await disconnectDb();
});

describe('fasce nelle impostazioni', () => {
  it('si aggiungono in ordine di distanza; doppioni, limite e permessi', async () => {
    expect((await getDeliverySettings(shop.owner)).origin).toEqual(STORE);
    await addDeliveryFeeTier(shop.manager, { upToKm: '6', fee: '120' });
    await addDeliveryFeeTier(shop.manager, { upToKm: '3', fee: '80' });
    const settings = await getDeliverySettings(shop.staff);
    expect(settings.feeTiers.map(({ maxKm, feeMinor }) => ({ maxKm, feeMinor }))).toEqual([
      { maxKm: 3, feeMinor: 8000 },
      { maxKm: 6, feeMinor: 12000 },
    ]);
    await expect(
      addDeliveryFeeTier(shop.owner, { upToKm: '3.0', fee: '90' }),
    ).rejects.toMatchObject({ reason: 'delivery_fee_tier_exists' });
    await expect(
      addDeliveryFeeTier(shop.staff, { upToKm: '9', fee: '200' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addDeliveryFeeTier(shop.owner, { upToKm: '200', fee: '200' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('al massimo 8 fasce', async () => {
    for (const km of ['10', '11', '12', '13', '14', '15']) {
      await addDeliveryFeeTier(other.owner, { upToKm: km, fee: '100' });
    }
    await addDeliveryFeeTier(other.owner, { upToKm: '16', fee: '100' });
    await addDeliveryFeeTier(other.owner, { upToKm: '17', fee: '100' });
    await expect(
      addDeliveryFeeTier(other.owner, { upToKm: '18', fee: '100' }),
    ).rejects.toMatchObject({ reason: 'delivery_fee_tier_limit' });
    // Le fasce di un'altra fioreria non si vedono e non si tolgono (404, mai 403).
    const [foreign] = (await getDeliverySettings(other.owner)).feeTiers;
    expect((await getDeliverySettings(shop.owner)).feeTiers).toHaveLength(2);
    await expect(removeDeliveryFeeTier(shop.owner, foreign!.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(ConflictError).toBeDefined();
  });
});

describe('ordine online', () => {
  it('il modulo riceve fasce e posizione della tienda per mostrare lo stesso calcolo', async () => {
    const form = await getCheckoutForm(buyer, shop.tenant.slug);
    expect(form!.delivery).toMatchObject({
      feeMinor: 5000,
      feeTiers: [
        { maxKm: 3, feeMinor: 8000 },
        { maxKm: 6, feeMinor: 12000 },
      ],
      origin: STORE,
    });
  });

  it('costo della fascia dalla distanza; fuori zona non si ordina', async () => {
    const near = await placeMarketplaceOrder(
      buyer,
      shop.tenant.slug,
      orderTo(north(2)),
      {
        fromSearch: false,
      },
      deps,
    );
    expect((await getOrder(shop.owner, near.orderId)).deliveryFeeMinor).toBe(8000);
    const far = await placeMarketplaceOrder(
      buyer,
      shop.tenant.slug,
      orderTo(north(4.5)),
      {
        fromSearch: false,
      },
      deps,
    );
    expect((await getOrder(shop.owner, far.orderId)).deliveryFeeMinor).toBe(12000);
    await expect(
      placeMarketplaceOrder(
        buyer,
        shop.tenant.slug,
        orderTo(north(8)),
        { fromSearch: false },
        deps,
      ),
    ).rejects.toMatchObject({ fieldErrors: { addressLine1: 'checkout_out_of_zone' } });
    // Ritirare in tienda si può sempre, senza costo di consegna.
    const pickup = await placeMarketplaceOrder(
      buyer,
      shop.tenant.slug,
      orderTo(north(8), { fulfillmentMode: 'PICKUP' }),
      { fromSearch: false },
      deps,
    );
    expect((await getOrder(shop.owner, pickup.orderId)).deliveryFeeMinor).toBe(0);
  });

  it('indirizzo senza posizione o salvato senza coordinate: il costo abituale', async () => {
    const other2: BuyerContext = { userId: (await createTestUser(db)).id, country: 'MX' };
    const typed = await placeMarketplaceOrder(
      other2,
      shop.tenant.slug,
      orderTo(north(8), { placeId: '', latitude: '', longitude: '' }),
      { fromSearch: false },
      deps,
    );
    expect((await getOrder(shop.owner, typed.orderId)).deliveryFeeMinor).toBe(5000);

    // Indirizzo salvato fuori zona: l'errore è sulla scelta dell'indirizzo.
    const { id } = await addBuyerAddress(other2, {
      addressLine1: 'Lejos 1',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      placeId: 'ChIJ_lejos',
      latitude: String(north(9).latitude),
      longitude: String(north(9).longitude),
    });
    await expect(
      placeMarketplaceOrder(
        other2,
        shop.tenant.slug,
        orderTo(north(1), { buyerAddressId: id }),
        { fromSearch: false },
        deps,
      ),
    ).rejects.toMatchObject({ fieldErrors: { buyerAddressId: 'checkout_out_of_zone' } });
  });

  it('coordinate della tienda scadute: il costo abituale, mai un calcolo con dati vecchi', async () => {
    await withTenantContext(db, shop.owner, (tx) =>
      tx.location.updateMany({
        where: { tenantId: shop.owner.tenantId, isPrimary: true },
        data: { coordinatesAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
      }),
    );
    expect((await getDeliverySettings(shop.owner)).origin).toBeNull();
    const third: BuyerContext = { userId: (await createTestUser(db)).id, country: 'MX' };
    const placed = await placeMarketplaceOrder(
      third,
      shop.tenant.slug,
      orderTo(north(8)),
      {
        fromSearch: false,
      },
      deps,
    );
    expect((await getOrder(shop.owner, placed.orderId)).deliveryFeeMinor).toBe(5000);
  });
});
