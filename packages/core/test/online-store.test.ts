import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
  createCatalogItem,
  getOnlineStoreSettings,
  getPublicStore,
  getPublicStoreItem,
  getPublicStoreItemPhoto,
  setCatalogItemArchived,
  setOnlineStorePublished,
  updateCatalogItem,
  updateOnlineStore,
  updateTenantProfile,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/** "Mi tienda en línea" e pagina pubblica della fioreria (blocco C2, ADR-065). */

const db = getDb();
let shop: TestShop;
let other: TestShop;
let bouquet: CatalogItemDto;
let plant: CatalogItemDto;
let rose: CatalogItemDto;
let foreign: CatalogItemDto;

async function setPhone(target: TestShop, phone: string) {
  await updateTenantProfile(target.owner, {
    displayName: `Florería ${target.tenant.slug}`,
    contactEmail: '',
    contactPhone: phone,
    timezone: 'America/Mexico_City',
  });
}

beforeAll(async () => {
  shop = await createTestShop('Florería Tienda');
  other = await createTestShop('Florería Tienda Ajena');
  rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', priceMinor: 3500, costMinor: 1400, isOnline: true }),
  );
  bouquet = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'BOUQUET',
      name: 'Ramo Primavera',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 69000,
      costMinor: 30000,
      isOnline: true,
    }),
  );
  plant = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'PLANT',
      name: 'Orquídea blanca',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 45000,
    }),
  );
  foreign = await createCatalogItem(
    other.owner,
    itemInput({
      type: 'BOUQUET',
      name: 'Ramo de la otra',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 50000,
      isOnline: true,
    }),
  );
});

afterAll(async () => {
  await disconnectDb();
});

describe('prodotti in linea', () => {
  it('solo ramos, piante, fiori e accessori; il resto resta fuori anche se chiesto', async () => {
    expect(bouquet.isOnline).toBe(true);
    expect(rose.isOnline).toBe(true);
    expect(plant.isOnline).toBe(false);
    const foliage = await createCatalogItem(
      shop.owner,
      itemInput({
        type: 'FOLIAGE',
        name: 'Eucalipto',
        canonicalFlowerId: null,
        variety: null,
        isOnline: true,
      }),
    );
    expect(foliage.isOnline).toBe(false);
    // Il database rifiuta comunque un materiale in linea.
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.catalogItem.update({ where: { id: foliage.id }, data: { isOnline: true } }),
      ),
    ).rejects.toThrow();
  });
});

describe('impostazioni della tienda', () => {
  it('descrizione e forme di pagamento; lo staff non le cambia', async () => {
    await updateOnlineStore(shop.owner, {
      description: 'Flores frescas en el centro de Aguascalientes.',
      paymentMethods: ['TRANSFER', 'CASH'],
      paymentInstructions: 'CLABE 012345678901234567 (BBVA)',
    });
    const settings = await getOnlineStoreSettings(shop.owner);
    expect(settings).toMatchObject({
      isPublished: false,
      description: 'Flores frescas en el centro de Aguascalientes.',
      paymentMethods: ['TRANSFER', 'CASH'],
      onlineItems: 2,
    });
    await expect(
      updateOnlineStore(shop.owner, { paymentMethods: ['BITCOIN'] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateOnlineStore(shop.staff, { description: 'x', paymentMethods: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setOnlineStorePublished(shop.staff, true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('si pubblica solo con il telefono e almeno un prodotto visibile', async () => {
    expect((await getOnlineStoreSettings(shop.owner)).blockers).toEqual(['store_needs_contact']);
    await expect(setOnlineStorePublished(shop.owner, true)).rejects.toMatchObject({
      reason: 'store_needs_contact',
    });
    await setPhone(shop, '449 555 0101');

    // L'altra fioreria non ha prodotti visibili... ma ne ha uno: lo togliamo.
    await setPhone(other, '449 555 0202');
    await updateCatalogItem(
      other.owner,
      foreign.id,
      itemInput({
        type: 'BOUQUET',
        name: 'Ramo de la otra',
        saleUnit: 'PIECE',
        canonicalFlowerId: null,
        variety: null,
        priceMinor: 50000,
        isOnline: false,
      }),
    );
    await expect(setOnlineStorePublished(other.owner, true)).rejects.toBeInstanceOf(ConflictError);

    await setOnlineStorePublished(shop.owner, true);
    const settings = await getOnlineStoreSettings(shop.owner);
    expect(settings.isPublished).toBe(true);
    expect(settings.publishedAt).toBeInstanceOf(Date);
    expect(settings.blockers).toEqual([]);
  });
});

describe('pagina pubblica', () => {
  it('mostra i dati pubblici e solo i prodotti attivi visibili, senza costi', async () => {
    const store = await getPublicStore(shop.tenant.slug);
    expect(store).not.toBeNull();
    expect(store).toMatchObject({
      slug: shop.tenant.slug,
      locale: 'es-MX',
      phone: '+524495550101',
      paymentMethods: ['TRANSFER', 'CASH'],
      paymentInstructions: 'CLABE 012345678901234567 (BBVA)',
      isDemo: true,
      address: { line: 'Calle de prueba 1', city: 'Aguascalientes', region: 'Aguascalientes' },
    });
    expect(store!.items.map((item) => item.name)).toEqual(['Ramo Primavera', 'Rosa roja']);
    const json = JSON.stringify(store);
    expect(json).not.toMatch(/costMinor|"sku"|30000|1400/);
    expect(json).not.toContain('Orquídea');
  });

  it('il dettaglio di un ramo dice di cosa è fatto; un prodotto non visibile non esiste', async () => {
    const detail = await getPublicStoreItem(shop.tenant.slug, bouquet.id);
    expect(detail?.item).toMatchObject({ name: 'Ramo Primavera', priceMinor: 69000 });
    expect(detail?.item.includes).toEqual([]);
    expect(JSON.stringify(detail)).not.toMatch(/costMinor|30000/);
    expect(await getPublicStoreItem(shop.tenant.slug, plant.id)).toBeNull();
    expect(await getPublicStoreItem(shop.tenant.slug, 'non-un-id')).toBeNull();
    expect(await getPublicStoreItemPhoto(shop.tenant.slug, bouquet.id, bouquet.id, 'full')).toBe(
      null,
    );
  });

  it('un prodotto archiviato sparisce dalla pagina', async () => {
    await setCatalogItemArchived(shop.owner, rose.id, true);
    const store = await getPublicStore(shop.tenant.slug);
    expect(store!.items.map((item) => item.name)).toEqual(['Ramo Primavera']);
    expect(await getPublicStoreItem(shop.tenant.slug, rose.id)).toBeNull();
  });

  it('isolamento A↔B: dallo slug di A non si vede nulla di B, né il contrario', async () => {
    // La pagina di B non è pubblicata: non esiste.
    expect(await getPublicStore(other.tenant.slug)).toBeNull();
    // Il prodotto di B (anche se tornasse visibile) non si apre dalla pagina di A.
    expect(await getPublicStoreItem(shop.tenant.slug, foreign.id)).toBeNull();
    expect(await getPublicStore('non-esiste-' + Date.now())).toBeNull();
    expect(await getPublicStore('../../etc')).toBeNull();
  });

  it('ritirata la tienda, la pagina non esiste più', async () => {
    await setOnlineStorePublished(shop.owner, false);
    expect(await getPublicStore(shop.tenant.slug)).toBeNull();
    expect(await getPublicStoreItem(shop.tenant.slug, bouquet.id)).toBeNull();
    expect((await getOnlineStoreSettings(shop.owner)).isPublished).toBe(false);
  });
});
