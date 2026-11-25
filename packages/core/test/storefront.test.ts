import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { STORE_LIMITS, newId, toIsoDate, todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  addCatalogItemPhoto,
  createCatalogItem,
  getOnlineStoreSettings,
  getPublicStore,
  getPublicStoreItem,
  getPublicStorefront,
  listCatalogItems,
  listFeaturedItems,
  moveCatalogItemPhoto,
  setCatalogItemArchived,
  setCatalogItemFeatured,
  setCatalogItemOnline,
  setCatalogItemsOnline,
  setObjectStorage,
  setOnlineStorePublished,
  updateCatalogItem,
  updateDeliverySettings,
  updateOnlineOrderSettings,
  updateOnlineStore,
  updateStorePolicies,
  updateTenantProfile,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Vetrina della fioreria (marketplace, blocco M1, ADR-087): pagine, ricerca, riga «Destacados»,
 * testata con primo giorno e costo, politiche, cura delle piante, ordine delle foto, limiti e
 * isolamento fra fiorerie.
 */

const db = getDb();
const storage = new MemoryStorage();
let shop: TestShop;
let other: TestShop;
const bouquets: CatalogItemDto[] = [];
let plant: CatalogItemDto;
let globe: CatalogItemDto;
let soldOut: CatalogItemDto;
let hidden: CatalogItemDto;
let foreign: CatalogItemDto;

const bouquetInput = (name: string, priceMinor: number, overrides: Record<string, unknown> = {}) =>
  itemInput({
    type: 'BOUQUET',
    name,
    saleUnit: 'PIECE',
    canonicalFlowerId: null,
    variety: null,
    priceMinor,
    isOnline: true,
    ...overrides,
  });

async function openShop(target: TestShop, name: string) {
  await updateTenantProfile(target.owner, {
    displayName: name,
    contactEmail: '',
    contactPhone: '449 555 0100',
    timezone: 'America/Mexico_City',
  });
}

async function jpeg(color: string): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 400, height: 400, channels: 3, background: color } })
      .jpeg()
      .toBuffer(),
  );
}

beforeAll(async () => {
  setObjectStorage(storage);
  shop = await createTestShop('Florería Vitrina');
  other = await createTestShop('Florería Vitrina Ajena');
  await openShop(shop, 'Florería Vitrina');
  await openShop(other, 'Florería Vitrina Ajena');
  for (let index = 1; index <= 26; index += 1) {
    bouquets.push(
      await createCatalogItem(
        shop.owner,
        bouquetInput(`Ramo ${String(index).padStart(2, '0')}`, 50000 + index * 100),
      ),
    );
  }
  const peaceLily = await db.canonicalFlower.findFirstOrThrow({
    where: { slug: 'cuna-de-moises' },
    select: { id: true },
  });
  plant = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'PLANT',
      name: 'Cuna de Moisés en maceta',
      saleUnit: 'PIECE',
      canonicalFlowerId: peaceLily.id,
      variety: null,
      priceMinor: 45000,
      isOnline: true,
    }),
  );
  globe = await createCatalogItem(
    shop.owner,
    itemInput({
      type: 'ACCESSORY',
      name: 'Globo metálico',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 9000,
      isOnline: true,
    }),
  );
  soldOut = await createCatalogItem(
    shop.owner,
    bouquetInput('Arreglo agotado', 1000, { availability: 'OUT_OF_STOCK' }),
  );
  hidden = await createCatalogItem(
    shop.owner,
    bouquetInput('Ramo de mostrador', 2000, { isOnline: false }),
  );
  foreign = await createCatalogItem(other.owner, bouquetInput('Ramo ajeno', 100));
  await updateOnlineStore(shop.owner, {
    description: null,
    paymentMethods: ['TRANSFER'],
    paymentInstructions: null,
  });
  await setOnlineStorePublished(shop.owner, true);
  await setOnlineStorePublished(other.owner, true);
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('vetrina pubblica', () => {
  it('pagine da 24, schede con i conteggi, esauriti in fondo, nascosti fuori', async () => {
    const first = await getPublicStorefront(shop.tenant.slug, {});
    expect(first).toMatchObject({ total: 29, onlineCount: 29, page: 1, pageCount: 2 });
    expect(first!.items).toHaveLength(24);
    expect(first!.categories).toEqual([
      { category: 'ramos', count: 27 },
      { category: 'plantas', count: 1 },
      { category: 'accesorios', count: 1 },
    ]);
    const second = await getPublicStorefront(shop.tenant.slug, { pagina: '2' });
    // L'esaurito è l'ultimo, anche se costa meno di tutti.
    expect(second!.items.at(-1)!.id).toBe(soldOut.id);
    const names = [...first!.items, ...second!.items].map((item) => item.name);
    expect(names).not.toContain('Ramo de mostrador');
    expect(names).toHaveLength(29);
    expect(JSON.stringify(first)).not.toMatch(/costMinor|"sku"/);
  });

  it('ricerca senza accenti e per scheda', async () => {
    const plants = await getPublicStorefront(shop.tenant.slug, { q: 'cuna de moises' });
    expect(plants!.items.map((item) => item.id)).toEqual([plant.id]);
    const accessories = await getPublicStorefront(shop.tenant.slug, { categoria: 'accesorios' });
    expect(accessories!.items.map((item) => item.id)).toEqual([globe.id]);
    const cheap = await getPublicStorefront(shop.tenant.slug, { orden: 'precio-asc' });
    expect(cheap!.items[0]!.id).toBe(globe.id);
  });

  it('testata: primo giorno senza i giorni chiusi, costo, politiche', async () => {
    await updateDeliverySettings(shop.owner, { closedWeekdays: ['0'], defaultFee: '80' });
    await updateOnlineOrderSettings(shop.owner, { ordersEnabled: 'on', minLeadDays: '1' });
    const store = await getPublicStore(shop.tenant.slug);
    expect(store!.delivery.feeSummary).toEqual({ kind: 'fixed', feeMinor: 8000 });
    expect(store!.delivery.firstDate).not.toBeNull();
    const first = new Date(`${store!.delivery.firstDate}T12:00:00Z`);
    expect(first.getUTCDay()).not.toBe(0);
    expect(store!.delivery.firstDate! > toIsoDate(todayInTimeZone('America/Mexico_City'))).toBe(
      true,
    );
    expect(store!.policies).toEqual({ changes: null, cancellations: null, substitutions: null });
  });

  it('la barra «Tu pedido»: prezzi di oggi, solo prodotti ordinabili di questa fioreria', async () => {
    const view = await getPublicStorefront(
      shop.tenant.slug,
      {},
      {
        cart: [
          { itemId: globe.id, quantity: 2 },
          { itemId: soldOut.id, quantity: 1 },
          { itemId: hidden.id, quantity: 1 },
          // A↔B: l'ID di un'altra fioreria non conta.
          { itemId: foreign.id, quantity: 3 },
        ],
      },
    );
    expect(view!.cart).toEqual({ lines: 1, units: 2, subtotalMinor: 2 * 9000 });
    expect((await getPublicStorefront(shop.tenant.slug, {}))!.cart).toBeNull();
    const item = await getPublicStoreItem(shop.tenant.slug, globe.id, {
      cart: [{ itemId: globe.id, quantity: 1 }],
    });
    expect(item!.cart).toEqual({ lines: 1, units: 1, subtotalMinor: 9000 });
  });

  it('il prodotto di una pianta ha la cura e cani e gatti dai nostri dati; un ramo no', async () => {
    const detail = await getPublicStoreItem(shop.tenant.slug, plant.id);
    expect(detail!.item.species).toMatchObject({
      slug: 'cuna-de-moises',
      care: { petToxicity: 'TOXIC' },
    });
    expect((await getPublicStoreItem(shop.tenant.slug, bouquets[0]!.id))!.item.species).toBeNull();
  });
});

describe('in evidenza', () => {
  it('al massimo 8, solo prodotti online; riga «Destacados» nella prima pagina', async () => {
    for (const item of bouquets.slice(0, 8)) {
      await setCatalogItemFeatured(shop.manager, item.id, true);
    }
    await expect(setCatalogItemFeatured(shop.owner, bouquets[8]!.id, true)).rejects.toMatchObject({
      reason: 'store_featured_limit',
    });
    await expect(setCatalogItemFeatured(shop.owner, hidden.id, true)).rejects.toMatchObject({
      reason: 'store_featured_not_online',
    });
    expect((await listFeaturedItems(shop.staff)).map((item) => item.id)).toEqual(
      bouquets.slice(0, 8).map((item) => item.id),
    );

    const home = await getPublicStorefront(shop.tenant.slug, {});
    expect(home!.featured.map((item) => item.id)).toEqual(bouquets.slice(0, 8).map((i) => i.id));
    expect(home!.items.some((item) => item.featured)).toBe(false);
    // Con un filtro niente riga: chi è in evidenza viene prima, con il segno.
    const ramos = await getPublicStorefront(shop.tenant.slug, { categoria: 'ramos' });
    expect(ramos!.featured).toEqual([]);
    expect(ramos!.items[0]).toMatchObject({ id: bouquets[0]!.id, featured: true });
  });

  it('chi esce dal negozio perde l’evidenza (spento, modificato, archiviato)', async () => {
    await setCatalogItemOnline(shop.owner, bouquets[0]!.id, false);
    await updateCatalogItem(
      shop.owner,
      bouquets[1]!.id,
      bouquetInput(bouquets[1]!.name, bouquets[1]!.priceMinor, { isOnline: false }),
    );
    await setCatalogItemArchived(shop.owner, bouquets[2]!.id, true);
    const left = (await listFeaturedItems(shop.owner)).map((item) => item.id);
    expect(left).toEqual(bouquets.slice(3, 8).map((item) => item.id));
    // Tornati online, non sono più in evidenza.
    await setCatalogItemOnline(shop.owner, bouquets[0]!.id, true);
    expect((await listFeaturedItems(shop.owner)).map((item) => item.id)).not.toContain(
      bouquets[0]!.id,
    );
  });

  it('due stelle insieme sull’ultimo posto: ne passa una sola', async () => {
    const featuredNow = (await listFeaturedItems(shop.owner)).length;
    // Riempie fino a 7, poi due richieste contemporanee per l'ottavo posto.
    const free = bouquets.slice(9, 9 + (STORE_LIMITS.featured - 1 - featuredNow));
    for (const item of free) await setCatalogItemFeatured(shop.owner, item.id, true);
    const results = await Promise.allSettled([
      setCatalogItemFeatured(shop.owner, bouquets[20]!.id, true),
      setCatalogItemFeatured(shop.owner, bouquets[21]!.id, true),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await listFeaturedItems(shop.owner)).toHaveLength(STORE_LIMITS.featured);
  });

  it('lo staff non sceglie; l’ID di un’altra fioreria non esiste', async () => {
    await expect(setCatalogItemFeatured(shop.staff, bouquets[5]!.id, false)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setCatalogItemFeatured(shop.owner, foreign.id, true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      setCatalogItemFeatured(other.owner, bouquets[5]!.id, false),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('foto del prodotto', () => {
  it('«Usa come copertina» e le frecce cambiano la foto della vetrina', async () => {
    const item = bouquets[10]!;
    const green = await addCatalogItemPhoto(shop.owner, item.id, await jpeg('#2e7d32'), {});
    const pink = await addCatalogItemPhoto(shop.owner, item.id, await jpeg('#f2a7b9'), {});
    const blue = await addCatalogItemPhoto(shop.owner, item.id, await jpeg('#1565c0'), {});
    const cover = async () => (await getPublicStoreItem(shop.tenant.slug, item.id))!.item;
    expect((await cover()).photoIds).toEqual([green.id, pink.id, blue.id]);

    await moveCatalogItemPhoto(shop.manager, blue.id, 'first');
    expect((await cover()).photoId).toBe(blue.id);
    await moveCatalogItemPhoto(shop.owner, green.id, 'later');
    expect((await cover()).photoIds).toEqual([blue.id, pink.id, green.id]);
    // Ai bordi resta com'è.
    await moveCatalogItemPhoto(shop.owner, green.id, 'later');
    expect((await cover()).photoIds).toEqual([blue.id, pink.id, green.id]);

    await expect(moveCatalogItemPhoto(shop.staff, pink.id, 'first')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(moveCatalogItemPhoto(other.owner, pink.id, 'first')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(moveCatalogItemPhoto(shop.owner, pink.id, 'sideways')).rejects.toMatchObject({
      fieldErrors: { move: 'invalid_option' },
    });
  });
});

describe('politiche della fioreria', () => {
  it('si salvano e si vedono nella testata; nel registro solo quali sono cambiate', async () => {
    await updateStorePolicies(shop.owner, {
      policyChanges: '',
      policyCancellations: 'Puedes cancelar hasta 24 horas antes.',
      policySubstitutions: 'Si falta una flor, la cambiamos por otra del mismo color.',
    });
    const store = await getPublicStore(shop.tenant.slug);
    expect(store!.policies).toEqual({
      changes: null,
      cancellations: 'Puedes cancelar hasta 24 horas antes.',
      substitutions: 'Si falta una flor, la cambiamos por otra del mismo color.',
    });
    const audit = await withTenantContext(db, shop.owner, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, action: 'store.policies_updated' },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      }),
    );
    expect(audit.metadata).toEqual({
      changedFields: ['policyCancellations', 'policySubstitutions'],
    });
    await expect(updateStorePolicies(shop.staff, { policyChanges: 'x' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // La fioreria B non vede le politiche di A.
    expect((await getPublicStore(other.tenant.slug))!.policies.cancellations).toBeNull();
  });
});

describe('limite dei prodotti online', () => {
  it('al 501° prodotto online la fioreria lo sa (niente tagli silenziosi)', async () => {
    const big = await createTestShop('Florería Grande');
    await withTenantContext(db, big.owner, (tx) =>
      tx.catalogItem.createMany({
        data: Array.from({ length: STORE_LIMITS.onlineItems }, (_, index) => ({
          id: newId(),
          tenantId: big.owner.tenantId,
          type: 'BOUQUET' as const,
          name: `Ramo ${index}`,
          saleUnit: 'PIECE' as const,
          priceMinor: 10000,
          currency: 'MXN',
          isOnline: true,
        })),
      }),
    );
    await expect(
      createCatalogItem(big.owner, bouquetInput('Uno más', 10000)),
    ).rejects.toBeInstanceOf(ConflictError);
    const offline = await createCatalogItem(
      big.owner,
      bouquetInput('Fuera de línea', 10000, { isOnline: false }),
    );
    await expect(setCatalogItemOnline(big.owner, offline.id, true)).rejects.toMatchObject({
      reason: 'store_online_limit',
    });
  });
});

/** Più prodotti insieme e filtro «Negozio online» del Catalogo (M1-2, ADR-087). */
describe('più prodotti insieme', () => {
  it('«Mostra nel negozio» accende i vendibili, salta archiviati e materiali, registra ognuno', async () => {
    const offline = await createCatalogItem(
      shop.owner,
      bouquetInput('Ramo por encender', 30000, { isOnline: false }),
    );
    const archived = await createCatalogItem(
      shop.owner,
      bouquetInput('Ramo archivado', 30000, { isOnline: false }),
    );
    await setCatalogItemArchived(shop.owner, archived.id, true);
    const foliage = await createCatalogItem(
      shop.owner,
      itemInput({ type: 'FOLIAGE', name: 'Eucalipto', canonicalFlowerId: null, isOnline: false }),
    );
    const result = await setCatalogItemsOnline(
      shop.owner,
      [offline.id, archived.id, foliage.id, bouquets[0]!.id, offline.id],
      true,
    );
    expect(result).toEqual({ changed: 1, skipped: 2 });
    const rows = await withTenantContext(db, shop.owner, (tx) =>
      tx.catalogItem.findMany({
        where: { id: { in: [offline.id, archived.id, foliage.id] } },
        select: { id: true, isOnline: true },
      }),
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.isOnline]))).toEqual({
      [offline.id]: true,
      [archived.id]: false,
      [foliage.id]: false,
    });
    const audit = await withTenantContext(db, shop.owner, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: offline.id, action: 'catalog_item.updated' },
        select: { metadata: true },
      }),
    );
    expect(audit.map((entry) => entry.metadata)).toContainEqual({
      name: 'Ramo por encender',
      changes: { isOnline: { from: false, to: true } },
    });
    // Spento insieme: torna fuori e il registro lo dice.
    expect(await setCatalogItemsOnline(shop.owner, [offline.id], false)).toEqual({
      changed: 1,
      skipped: 0,
    });
  });

  it('«Togli dal negozio» toglie anche la stella «Destacados»', async () => {
    // Una fioreria a parte: in questa le 8 stelle sono già usate dai test sopra.
    const lone = await createTestShop('Florería Una Estrella');
    const starred = await createCatalogItem(lone.owner, bouquetInput('Ramo con estrella', 30000));
    await setCatalogItemFeatured(lone.owner, starred.id, true);
    await setCatalogItemsOnline(lone.owner, [starred.id], false);
    const row = await withTenantContext(db, lone.owner, (tx) =>
      tx.catalogItem.findUniqueOrThrow({
        where: { id: starred.id },
        select: { isOnline: true, featuredAt: true },
      }),
    );
    expect(row).toEqual({ isOnline: false, featuredAt: null });
    // Riacceso, non torna in evidenza da solo.
    await setCatalogItemsOnline(lone.owner, [starred.id], true);
    expect(await listFeaturedItems(lone.owner)).toEqual([]);
  });

  it('oltre i 500 non accende niente; lo staff non può; scelte vuote o troppe respinte', async () => {
    const full = await createTestShop('Florería Casi Llena');
    await withTenantContext(db, full.owner, (tx) =>
      tx.catalogItem.createMany({
        data: Array.from({ length: STORE_LIMITS.onlineItems - 1 }, (_, index) => ({
          id: newId(),
          tenantId: full.owner.tenantId,
          type: 'BOUQUET' as const,
          name: `Ramo ${index}`,
          saleUnit: 'PIECE' as const,
          priceMinor: 10000,
          currency: 'MXN',
          isOnline: true,
        })),
      }),
    );
    const first = await createCatalogItem(
      full.owner,
      bouquetInput('Último lugar', 10000, { isOnline: false }),
    );
    const second = await createCatalogItem(
      full.owner,
      bouquetInput('Sin lugar', 10000, { isOnline: false }),
    );
    await expect(
      setCatalogItemsOnline(full.owner, [first.id, second.id], true),
    ).rejects.toMatchObject({ reason: 'store_online_limit' });
    // Tutto o niente: nemmeno il primo si è acceso.
    expect(
      (await listCatalogItems(full.owner, { online: 'no' })).items.map((item) => item.name).sort(),
    ).toEqual(['Sin lugar', 'Último lugar']);
    expect(await setCatalogItemsOnline(full.owner, [first.id], true)).toEqual({
      changed: 1,
      skipped: 0,
    });

    await expect(
      setCatalogItemsOnline(shop.staff, [bouquets[0]!.id], false),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setCatalogItemsOnline(shop.owner, [], true)).rejects.toMatchObject({
      fieldErrors: { items: 'catalog_bulk_empty' },
    });
    await expect(
      setCatalogItemsOnline(
        shop.owner,
        bouquets.slice(0, 21).map((item) => item.id),
        true,
      ),
    ).rejects.toMatchObject({ fieldErrors: { items: 'catalog_bulk_too_many' } });
  });

  it('un ID di un’altra fioreria respinge tutto con l’evento di sicurezza (A↔B)', async () => {
    const states = () =>
      withSystemContext(db, { reason: 'test: stato dei prodotti di A e B' }, (tx) =>
        tx.catalogItem.findMany({
          where: { id: { in: [bouquets[3]!.id, foreign.id] } },
          orderBy: { id: 'asc' },
          select: { id: true, isOnline: true, updatedAt: true },
        }),
      );
    const before = await states();
    await expect(
      setCatalogItemsOnline(shop.owner, [bouquets[3]!.id, foreign.id], false),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setCatalogItemsOnline(other.owner, [bouquets[3]!.id], false),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Né il prodotto di A né quello di B sono stati toccati.
    expect(await states()).toEqual(before);
    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({ where: { tenantId: null, entityId: foreign.id } }),
    );
    expect(events.some((event) => event.action === 'security.cross_tenant_access_attempt')).toBe(
      true,
    );
  });
});

describe('filtro «Negozio online» e vetrina completa', () => {
  it('sì, no (solo i vendibili) e online senza foto', async () => {
    const yes = await listCatalogItems(shop.owner, { online: 'yes' });
    expect(yes.items.every((item) => item.isOnline)).toBe(true);
    const no = await listCatalogItems(shop.owner, { online: 'no' });
    expect(no.items.map((item) => item.name)).toContain('Ramo de mostrador');
    expect(no.items.some((item) => item.type === 'FOLIAGE')).toBe(false);
    const noPhoto = await listCatalogItems(shop.owner, { online: 'no_photo' });
    expect(noPhoto.items.every((item) => item.isOnline && item.coverPhotoId === null)).toBe(true);
    const [target] = (await listCatalogItems(shop.owner, { online: 'no_photo', q: 'Globo' })).items;
    expect(target?.name).toBe('Globo metálico');
    await addCatalogItemPhoto(shop.owner, target!.id, await jpeg('#c62828'), {});
    const after = await listCatalogItems(shop.owner, { online: 'no_photo' });
    expect(after.total).toBe(noPhoto.total - 1);
    expect((await listCatalogItems(shop.owner, { online: 'no_photo', q: 'Globo' })).total).toBe(0);
    // Un'altra fioreria non vede i prodotti di questa (A↔B).
    const theirs = await listCatalogItems(other.owner, { online: 'yes' });
    expect(theirs.items.map((item) => item.id)).toEqual([foreign.id]);
  });

  it('i passi di «Completa la tua vetrina» seguono i dati della fioreria', async () => {
    const before = await getOnlineStoreSettings(shop.owner);
    const done = (step: string) =>
      before.readiness.steps.find((entry) => entry.step === step)!.done;
    expect(done('products')).toBe(true);
    expect(done('payment')).toBe(true);
    expect(done('description')).toBe(false);
    expect(done('photos')).toBe(false);
    expect(before.onlineWithoutPhoto).toBe(
      (await listCatalogItems(shop.owner, { online: 'no_photo' })).total,
    );
    await updateOnlineStore(shop.owner, {
      description: 'Flores de temporada.',
      paymentMethods: ['TRANSFER'],
      paymentInstructions: null,
    });
    const after = await getOnlineStoreSettings(shop.owner);
    expect(after.readiness.steps.find((entry) => entry.step === 'description')!.done).toBe(true);
    expect(after.readiness.missing).toBe(before.readiness.missing - 1);
  });
});
