import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import {
  addDeliveryFeeTier,
  createCatalogItem,
  listPublicStoreCities,
  listPublicStoreOccasions,
  listSitemapEntries,
  refreshStoreCoordinates,
  searchPublicStores,
  setCatalogItemOnline,
  setOnlineStorePublished,
  updateCatalogItem,
  updateOnlineOrderSettings,
  updateOnlineStore,
  setPlacesProvider,
  updatePrimaryLocation,
  updateTenantProfile,
  type PlacesProvider,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Ricerca delle fiorerie per chi compra (blocco C3, ADR-066). Città e coordinate inventate (in
 * mezzo all'oceano) per non incrociare le tiendas degli altri test nel database condiviso.
 */

const db = getDb();
const CITY = `Ciudad Prueba ${Date.now()}`;
const ORIGIN = { latitude: 10, longitude: -130 };
let near: TestShop;
let far: TestShop;
let unknown: TestShop;
let hidden: TestShop;
let empty: TestShop;

async function openStore(
  shop: TestShop,
  options: {
    readonly at?: { latitude: number; longitude: number };
    readonly radiusKm?: string;
    readonly publish?: boolean;
    readonly withItem?: boolean;
  },
) {
  await updateTenantProfile(shop.owner, {
    displayName: `Florería ${shop.tenant.slug}`,
    contactEmail: '',
    contactPhone: '449 555 0101',
    timezone: 'America/Mexico_City',
  });
  await updatePrimaryLocation(shop.owner, {
    addressLine1: 'Calle 1',
    city: CITY,
    region: 'AGU',
    postalCode: '20000',
    deliveryRadiusKm: options.radiusKm ?? '',
    ...(options.at
      ? {
          placeId: `ChIJ_prueba_${shop.tenant.slug}`,
          latitude: String(options.at.latitude),
          longitude: String(options.at.longitude),
        }
      : {}),
  });
  await createCatalogItem(
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
  if (options.publish !== false) await setOnlineStorePublished(shop.owner, true);
  if (options.withItem === false) {
    await withTenantContext(db, shop.owner, (tx) =>
      tx.catalogItem.updateMany({
        where: { tenantId: shop.owner.tenantId },
        data: { isOnline: false },
      }),
    );
  }
}

beforeAll(async () => {
  near = await createTestShop('Florería Cerca');
  far = await createTestShop('Florería Lejos');
  unknown = await createTestShop('Florería Sin Ubicación');
  hidden = await createTestShop('Florería Sin Publicar');
  empty = await createTestShop('Florería Sin Productos');
  await openStore(near, { at: { latitude: 10.01, longitude: -130 }, radiusKm: '5' });
  // ~11 km: fuori dal raggio di 5 km.
  await openStore(far, { at: { latitude: 10.1, longitude: -130 }, radiusKm: '5' });
  await openStore(unknown, {});
  await openStore(hidden, { at: { latitude: 10.01, longitude: -130 }, publish: false });
  await openStore(empty, { at: { latitude: 10.01, longitude: -130 }, withItem: false });
});

afterEach(() => {
  setPlacesProvider(undefined);
});

afterAll(async () => {
  await disconnectDb();
});

/** Solo le tiendas di questo giro: il database dei test non si svuota fra un'esecuzione e l'altra. */
const slugs = (items: readonly { slug: string }[]) => {
  const mine = new Set([near, far, unknown, hidden, empty].map((shop) => shop.tenant.slug));
  return items.map((item) => item.slug).filter((slug) => mine.has(slug));
};

describe('ricerca per indirizzo', () => {
  it('entra chi consegna fin lì; poi la stessa città senza posizione; mai le non pubblicate', async () => {
    const result = await searchPublicStores({
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      city: CITY,
    });
    expect(slugs(result.nearby)).toEqual([near.tenant.slug]);
    expect(result.nearby.find((item) => item.slug === near.tenant.slug)!.distanceKm).toBeCloseTo(
      1.1,
      1,
    );
    expect(slugs(result.sameCity)).toEqual([unknown.tenant.slug]);
    const all = JSON.stringify(result);
    expect(all).not.toContain(hidden.tenant.slug);
    expect(all).not.toContain(empty.tenant.slug);
    expect(all).not.toContain(far.tenant.slug);
    // Solo dati pubblici.
    expect(
      Object.keys(result.nearby.find((item) => item.slug === near.tenant.slug)!).sort(),
    ).toEqual(
      [
        'city',
        'distanceKm',
        'logoId',
        'name',
        'neighborhood',
        'onlineItems',
        'slug',
        // Schede (M1-2): dati che la vetrina mostra già.
        'currency',
        'fee',
        'firstDate',
        'occasions',
        'ordersOnline',
        'today',
      ].sort(),
    );
  });

  it('solo per città: tutte le tiendas pubblicate di quella città', async () => {
    const result = await searchPublicStores({ city: CITY.toUpperCase() });
    expect(result.nearby).toEqual([]);
    expect(slugs(result.sameCity).sort()).toEqual(
      [near.tenant.slug, far.tenant.slug, unknown.tenant.slug].sort(),
    );
    expect(await listPublicStoreCities()).toContain(CITY);
  });

  it('input vuoti o sbagliati non cercano nulla', async () => {
    expect(await searchPublicStores({})).toEqual({ nearby: [], sameCity: [] });
    expect(await searchPublicStores({ latitude: 'x', longitude: 500, city: '  ' })).toEqual({
      nearby: [],
      sameCity: [],
    });
  });
});

describe('coordinate delle tiendas', () => {
  it('senza la chiave di Google non si aggiorna nulla', async () => {
    setPlacesProvider(null);
    expect(await refreshStoreCoordinates()).toBe(0);
  });

  it('vecchie di 26 giorni: si richiedono a Google dal place ID', async () => {
    await withTenantContext(db, near.owner, (tx) =>
      tx.location.updateMany({
        where: { tenantId: near.owner.tenantId, isPrimary: true },
        data: { coordinatesAt: new Date(Date.now() - 26 * 24 * 60 * 60 * 1000) },
      }),
    );
    const asked: string[] = [];
    const fake: PlacesProvider = {
      id: 'fake',
      autocomplete: async () => [],
      details: async ({ placeId }) => {
        asked.push(placeId);
        return {
          placeId,
          addressLine1: 'Calle 1',
          addressLine2: null,
          neighborhood: null,
          postalCode: null,
          city: CITY,
          region: 'AGU',
          countryCode: 'MX',
          coordinates: { latitude: 10.02, longitude: -130 },
        };
      },
    };
    setPlacesProvider(fake);
    expect(await refreshStoreCoordinates()).toBeGreaterThanOrEqual(1);
    expect(asked).toContain(`ChIJ_prueba_${near.tenant.slug}`);
    // La tienda non pubblicata non si aggiorna (nessuna chiamata inutile a Google).
    expect(asked).not.toContain(`ChIJ_prueba_${hidden.tenant.slug}`);
    const location = await withTenantContext(db, near.owner, (tx) =>
      tx.location.findFirstOrThrow({
        where: { tenantId: near.owner.tenantId, isPrimary: true },
        select: { latitude: true, coordinatesAt: true },
      }),
    );
    expect(location.latitude).toBe(10.02);
    expect(Date.now() - location.coordinatesAt!.getTime()).toBeLessThan(60_000);
  });
});

/** Schede della ricerca, occasioni e sitemap (M1-2, ADR-087). */
describe('schede della ricerca e occasioni', () => {
  const ramo = (name: string, occasions: readonly string[], isOnline = true) =>
    itemInput({
      type: 'BOUQUET',
      name,
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 50000,
      isOnline,
      occasions,
    });

  it('ordini online, primo giorno e costo per l’indirizzo cercato', async () => {
    await updateOnlineStore(near.owner, {
      description: null,
      paymentMethods: ['TRANSFER'],
      paymentInstructions: null,
    });
    await updateOnlineOrderSettings(near.owner, { ordersEnabled: 'on', minLeadDays: '1' });
    await addDeliveryFeeTier(near.owner, { upToKm: '3', fee: '70' });
    const result = await searchPublicStores({ ...ORIGIN, city: CITY });
    const card = result.nearby.find((store) => store.slug === near.tenant.slug)!;
    expect(card.ordersOnline).toBe(true);
    expect(card.firstDate! > card.today).toBe(true);
    // ~1,1 km dall'indirizzo: la fascia fino a 3 km.
    expect(card.fee).toEqual({ summary: { kind: 'fixed', feeMinor: 7000 }, exact: true });
    // Senza ordini online e senza costo: solo WhatsApp, costo da confermare.
    const other = result.sameCity.find((store) => store.slug === unknown.tenant.slug)!;
    expect(other.ordersOnline).toBe(false);
    expect(other.fee).toEqual({ summary: { kind: 'to_confirm' }, exact: false });
  });

  it('un’occasione filtra fiorerie e città; contano solo i prodotti online', async () => {
    const birthday = await createCatalogItem(near.owner, ramo('Ramo de cumpleaños', ['BIRTHDAY']));
    // Un prodotto spento non porta la sua occasione nella ricerca.
    await createCatalogItem(far.owner, ramo('Ramo de condolencias', ['SYMPATHY'], false));
    const byCity = await searchPublicStores({ city: CITY, occasion: 'cumpleanos' });
    expect(slugs([...byCity.nearby, ...byCity.sameCity])).toEqual([near.tenant.slug]);
    expect(
      slugs((await searchPublicStores({ city: CITY, occasion: 'condolencias' })).sameCity),
    ).toEqual([]);
    expect(await listPublicStoreCities('cumpleanos')).toContain(CITY);
    expect(await listPublicStoreOccasions()).toContain('BIRTHDAY');
    // Un'occasione sconosciuta si ignora: tutte le fiorerie della città.
    const all = await searchPublicStores({ city: CITY, occasion: 'boda' });
    expect(slugs([...all.nearby, ...all.sameCity]).length).toBeGreaterThan(1);
    // Spento il prodotto, la fioreria esce dall'occasione.
    await setCatalogItemOnline(near.owner, birthday.id, false);
    const after = await searchPublicStores({ city: CITY, occasion: 'cumpleanos' });
    expect(slugs([...after.nearby, ...after.sameCity])).toEqual([]);
  });

  it('le occasioni si salvano senza doppioni; un valore sconosciuto è rifiutato, anche dal database', async () => {
    const item = await createCatalogItem(near.owner, ramo('Ramo de amor', ['LOVE', 'LOVE']));
    expect(item.occasions).toEqual(['LOVE']);
    // Senza la voce nel modulo, le occasioni restano.
    const { occasions: _omit, ...withoutOccasions } = ramo('Ramo de amor', []);
    const updated = await updateCatalogItem(near.owner, item.id, withoutOccasions);
    expect(updated.occasions).toEqual(['LOVE']);
    await expect(
      createCatalogItem(near.owner, ramo('Ramo raro', ['WEDDING'])),
    ).rejects.toMatchObject({ fieldErrors: { 'occasions.0': 'invalid_option' } });
    await expect(
      withTenantContext(db, near.owner, (tx) =>
        tx.catalogItem.update({ where: { id: item.id }, data: { occasions: ['WEDDING'] } }),
      ),
    ).rejects.toThrow();
  });

  it('sitemap: solo vetrine pubblicate con prodotti online, e i loro prodotti', async () => {
    const entries = (await listSitemapEntries()).filter((entry) =>
      [near, far, unknown, hidden, empty].some((shop) => shop.tenant.slug === entry.slug),
    );
    expect(entries.some((entry) => entry.slug === hidden.tenant.slug)).toBe(false);
    expect(entries.some((entry) => entry.slug === empty.tenant.slug)).toBe(false);
    expect(entries.some((entry) => entry.slug === near.tenant.slug && entry.itemId === null)).toBe(
      true,
    );
    expect(entries.some((entry) => entry.slug === near.tenant.slug && entry.itemId !== null)).toBe(
      true,
    );
  });
});
