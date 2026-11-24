import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import {
  ConflictError,
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  ValidationError,
  createCatalogItem,
  getOnlineStoreSettings,
  getPublicStore,
  getPublicStoreImage,
  getStoreImage,
  getPublicStoreItem,
  getPublicStoreItemPhoto,
  removeStoreImage,
  setCatalogItemArchived,
  setCatalogItemOnline,
  setObjectStorage,
  setOnlineStorePublished,
  setStoreImage,
  updateCatalogItem,
  updateOnlineStore,
  updatePrimaryLocation,
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

const storage = new MemoryStorage();

async function jpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 80 } } })
      .jpeg()
      .toBuffer(),
  );
}

beforeAll(async () => {
  setObjectStorage(storage);
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
  setObjectStorage(null);
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

  it('dice se la sede è sulla mappa (chi cerca per indirizzo trova la tienda solo così)', async () => {
    const other = await createTestShop('Florería Sin Mapa');
    expect((await getOnlineStoreSettings(other.owner)).onMap).toBe(false);
    // Indirizzo scritto a mano: nessuna posizione.
    const typed = {
      addressLine1: 'Rancho Santa Mónica 3',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20286',
      deliveryRadiusKm: '',
    };
    await updatePrimaryLocation(other.owner, {
      ...typed,
      placeId: '',
      latitude: '',
      longitude: '',
    });
    expect((await getOnlineStoreSettings(other.owner)).onMap).toBe(false);
    // Scelto dai suggerimenti di Google: place ID e coordinate.
    await updatePrimaryLocation(other.owner, {
      ...typed,
      placeId: 'ChIJ_rancho_santa_monica',
      latitude: '21.9180',
      longitude: '-102.3240',
    });
    expect((await getOnlineStoreSettings(other.owner)).onMap).toBe(true);
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

  it("logo piccolo e copertina grande; sostituirli cambia l'indirizzo; si possono togliere", async () => {
    const logo = await setStoreImage(shop.owner, 'LOGO', await jpeg(1200, 1200));
    const cover = await setStoreImage(shop.owner, 'COVER', await jpeg(2400, 900));
    const store = await getPublicStore(shop.tenant.slug);
    expect(store).toMatchObject({ logoId: logo.id, coverId: cover.id });

    const logoImage = await getPublicStoreImage(shop.tenant.slug, 'LOGO', logo.id);
    expect((await sharp(logoImage!.bytes).metadata()).width).toBe(480);
    const coverImage = await getPublicStoreImage(shop.tenant.slug, 'COVER', cover.id);
    expect((await sharp(coverImage!.bytes).metadata()).width).toBe(1600);
    // L'ID di un'immagine non vale per l'altra, né un ID inventato.
    expect(await getPublicStoreImage(shop.tenant.slug, 'COVER', logo.id)).toBeNull();
    expect(await getPublicStoreImage(shop.tenant.slug, 'BANNER', logo.id)).toBeNull();

    const newLogo = await setStoreImage(shop.owner, 'LOGO', await jpeg(800, 800));
    expect(await getPublicStoreImage(shop.tenant.slug, 'LOGO', logo.id)).toBeNull();
    expect(await getPublicStoreImage(shop.tenant.slug, 'LOGO', newLogo.id)).not.toBeNull();
    // Anteprima nelle impostazioni (anche lo staff la vede).
    expect((await getStoreImage(shop.staff, 'LOGO')).contentType).toBe('image/jpeg');

    await removeStoreImage(shop.owner, 'COVER');
    expect((await getPublicStore(shop.tenant.slug))?.coverId).toBeNull();
    expect(await getPublicStoreImage(shop.tenant.slug, 'COVER', cover.id)).toBeNull();
  });

  it('immagini: file non validi rifiutati, lo staff non le cambia, B non le vede da A', async () => {
    await expect(
      setStoreImage(shop.owner, 'LOGO', new Uint8Array([1, 2, 3])),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(setStoreImage(shop.owner, 'LOGO', await jpeg(100, 100))).rejects.toMatchObject({
      fieldErrors: { file: 'image_too_small' },
    });
    await expect(setStoreImage(shop.owner, 'BANNER', await jpeg(800, 800))).rejects.toMatchObject({
      fieldErrors: { kind: 'invalid_option' },
    });
    await expect(setStoreImage(shop.staff, 'LOGO', await jpeg(800, 800))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(removeStoreImage(shop.staff, 'LOGO')).rejects.toBeInstanceOf(ForbiddenError);
    // L'altra fioreria (non pubblicata) con un logo suo: dal suo slug non si vede, né da quello di A.
    const foreignLogo = await setStoreImage(other.owner, 'LOGO', await jpeg(800, 800));
    expect(await getPublicStoreImage(other.tenant.slug, 'LOGO', foreignLogo.id)).toBeNull();
    expect(await getPublicStoreImage(shop.tenant.slug, 'LOGO', foreignLogo.id)).toBeNull();
  });

  it('ritirata la tienda, la pagina non esiste più', async () => {
    await setOnlineStorePublished(shop.owner, false);
    expect(await getPublicStore(shop.tenant.slug)).toBeNull();
    expect(await getPublicStoreItem(shop.tenant.slug, bouquet.id)).toBeNull();
    expect((await getOnlineStoreSettings(shop.owner)).isPublished).toBe(false);
    const { logoId } = await getOnlineStoreSettings(shop.owner);
    expect(await getPublicStoreImage(shop.tenant.slug, 'LOGO', logoId)).toBeNull();
  });
});

/** L'interruttore "En tu tienda en línea" nell'elenco del catalogo (24/11/2026). */
describe("visibilità nella tienda dall'elenco del catalogo", () => {
  it('si accende e si spegne; conta per la pubblicazione; registro di audit', async () => {
    const shopB = await createTestShop('Florería Interruptor');
    const tulip = await createCatalogItem(
      shopB.owner,
      itemInput({ name: 'Tulipán', isOnline: false }),
    );
    expect((await getOnlineStoreSettings(shopB.owner)).onlineItems).toBe(0);
    await setCatalogItemOnline(shopB.manager, tulip.id, true);
    expect((await getOnlineStoreSettings(shopB.owner)).onlineItems).toBe(1);
    // Ripetere lo stesso valore non scrive nulla.
    await setCatalogItemOnline(shopB.owner, tulip.id, true);
    await setCatalogItemOnline(shopB.owner, tulip.id, false);
    expect((await getOnlineStoreSettings(shopB.owner)).onlineItems).toBe(0);
    const audits = await withTenantContext(db, shopB.owner, (tx) =>
      tx.auditLog.count({
        where: {
          tenantId: shopB.owner.tenantId,
          entityId: tulip.id,
          action: 'catalog_item.updated',
        },
      }),
    );
    expect(audits).toBe(2);
  });

  it('solo i tipi che la tienda vende e solo i prodotti attivi; lo staff no; altra fioreria 404', async () => {
    const shopB = await createTestShop('Florería Interruptor Reglas');
    const paper = await createCatalogItem(
      shopB.owner,
      itemInput({
        name: 'Papel kraft',
        type: 'PACKAGING',
        saleUnit: 'PIECE',
        canonicalFlowerId: null,
        variety: null,
        colors: [],
      }),
    );
    await expect(setCatalogItemOnline(shopB.owner, paper.id, true)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const daisy = await createCatalogItem(shopB.owner, itemInput({ name: 'Margarita' }));
    await setCatalogItemArchived(shopB.owner, daisy.id, true);
    await expect(setCatalogItemOnline(shopB.owner, daisy.id, true)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(setCatalogItemOnline(shopB.staff, daisy.id, true)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setCatalogItemOnline(shopB.owner, daisy.id, 'on')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(setCatalogItemOnline(other.owner, daisy.id, true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
