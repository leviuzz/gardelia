import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  MemoryStorage,
  NotFoundError,
  ValidationError,
  addCatalogItemPhoto,
  addCatalogItemToOrder,
  cancelMarketplaceOrder,
  cancelOrder,
  confirmDraftOrder,
  createCatalogItem,
  createCustomer,
  createDraftOrder,
  exportBuyerData,
  getTenantDeletionOverview,
  listBuyerOrders,
  listTenantsPendingDeletion,
  listUserTenants,
  placeMarketplaceOrder,
  purgeDeletedTenants,
  requestTenantDeletion,
  resolveTenantContext,
  restoreTenant,
  setObjectStorage,
  setOnlineStorePublished,
  updateOnlineOrderSettings,
  updateOnlineStore,
  updateTenantProfile,
  type ObjectStorage,
  type OrderMailDeps,
  type TenantContext,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * "Eliminar florería" (ADR-074): solo il titolare, scrivendo il nome, senza ordini in corso; la
 * fioreria sparisce subito per tutti, si recupera per 30 giorni, poi la manutenzione la cancella con
 * i suoi file. Isolamento: il titolare di un'altra fioreria non la vede e non la recupera.
 */

const db = getDb();
const storage = new MemoryStorage();
const mailer = new MemoryMailer();
const mail = { mailer, restoreUrl: 'http://localhost:3000/app' };

function tomorrow(): string {
  const today = todayInTimeZone('America/Mexico_City');
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return date.toISOString().slice(0, 10);
}

const pickup = () => ({
  fulfillmentMode: 'PICKUP',
  scheduledDate: tomorrow(),
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
});

async function confirmedOrder(shop: TestShop): Promise<string> {
  const customer = await createCustomer(shop.owner, {
    type: 'PERSON',
    displayName: 'Cliente Eliminación',
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550199',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });
  const item = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa de prueba' }));
  const { id } = await createDraftOrder(shop.owner, { customerId: customer.id });
  await addCatalogItemToOrder(shop.owner, id, { catalogItemId: item.id, quantity: '3' });
  await confirmDraftOrder(shop.owner, id, pickup());
  return id;
}

async function tenantExists(tenantId: string): Promise<boolean> {
  const count = await withSystemContext(db, { reason: 'test: esiste la fioreria?' }, (tx) =>
    tx.tenant.count({ where: { id: tenantId } }),
  );
  return count === 1;
}

/** La data della cancellazione è passata (come dopo 30 giorni). */
async function makeDue(tenantId: string): Promise<void> {
  const past = new Date(Date.now() - 60 * 1000);
  await withSystemContext(db, { reason: 'test: 30 giorni passati' }, (tx) =>
    tx.tenant.update({
      where: { id: tenantId },
      data: { deletionRequestedAt: new Date(past.getTime() - 31 * 86_400_000), deleteAfter: past },
    }),
  );
}

let other: TestShop;

beforeAll(() => {
  setObjectStorage(storage);
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('chi può eliminare e quando', () => {
  let shop: TestShop;

  beforeAll(async () => {
    shop = await createTestShop('Florería Para Eliminar');
    other = await createTestShop('Florería Vecina');
  });

  it('solo il titolare; un ordine in corso blocca finché non si chiude', async () => {
    await expect(getTenantDeletionOverview(shop.manager)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requestTenantDeletion(shop.manager, { confirmName: 'Florería Para Eliminar' }, null),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const orderId = await confirmedOrder(shop);
    expect(await getTenantDeletionOverview(shop.owner)).toMatchObject({
      blockers: ['tenant_deletion_open_orders'],
      openOrders: 1,
      graceDays: 30,
    });
    await expect(
      requestTenantDeletion(shop.owner, { confirmName: 'Florería Para Eliminar' }, null),
    ).rejects.toMatchObject({ reason: 'tenant_deletion_open_orders' });
    expect(ConflictError).toBeDefined();

    await cancelOrder(shop.owner, orderId, { reason: 'Prueba de eliminación' });
    expect((await getTenantDeletionOverview(shop.owner)).blockers).toEqual([]);
  });

  it('si conferma scrivendo il nome della fioreria', async () => {
    await expect(
      requestTenantDeletion(shop.owner, { confirmName: 'Florería Vecina' }, null),
    ).rejects.toMatchObject({ fieldErrors: { confirmName: 'tenant_deletion_name_mismatch' } });
    expect(ValidationError).toBeDefined();
  });

  it("dopo la richiesta sparisce per tutti, la tienda si spegne e i titolari ricevono un'email", async () => {
    const { deleteAfter } = await requestTenantDeletion(
      shop.owner,
      { confirmName: '  florería para eliminar ' },
      mail,
    );
    const days = (deleteAfter.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const slug = shop.tenant.slug;
    for (const ctx of [shop.owner, shop.manager, shop.staff]) {
      expect(await resolveTenantContext({ userId: ctx.userId, slug })).toBeNull();
    }
    expect((await listUserTenants(shop.owner.userId)).map((t) => t.slug)).not.toContain(slug);
    // Solo il titolare la vede, per recuperarla; il manager no.
    expect(await listTenantsPendingDeletion(shop.owner.userId)).toEqual([
      expect.objectContaining({ slug, displayName: 'Florería Para Eliminar' }),
    ]);
    expect(await listTenantsPendingDeletion(shop.manager.userId)).toEqual([]);

    const store = await withSystemContext(db, { reason: 'test: tienda spenta' }, (tx) =>
      tx.onlineStore.findMany({ where: { tenantId: shop.owner.tenantId } }),
    );
    expect(store.every((row) => !row.isPublished)).toBe(true);
    const email = mailer.sent.find((message) => message.category === 'tenant_deletion_scheduled');
    expect(email?.subject).toContain('Florería Para Eliminar se eliminará el');
    expect(email?.text).toContain('http://localhost:3000/app');
  });

  it("la recupera solo il titolare, non il manager né il titolare di un'altra fioreria", async () => {
    const slug = shop.tenant.slug;
    await expect(restoreTenant({ userId: shop.manager.userId, slug })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(restoreTenant({ userId: other.owner.userId, slug })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(restoreTenant({ userId: shop.owner.userId, slug })).resolves.toEqual({ slug });
    expect(await resolveTenantContext({ userId: shop.staff.userId, slug })).not.toBeNull();
    expect(await listTenantsPendingDeletion(shop.owner.userId)).toEqual([]);
    // Una seconda volta non c'è più niente da recuperare.
    await expect(restoreTenant({ userId: shop.owner.userId, slug })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('cancellazione definitiva (manutenzione)', () => {
  async function jpeg(): Promise<Uint8Array> {
    return new Uint8Array(
      await sharp({
        create: { width: 900, height: 900, channels: 3, background: { r: 190, g: 40, b: 60 } },
      })
        .jpeg()
        .toBuffer(),
    );
  }

  it("dopo 30 giorni si cancellano dati e foto; resta solo l'evento di piattaforma", async () => {
    const shop = await createTestShop('Florería Que Se Va');
    const rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa con foto' }));
    await addCatalogItemPhoto(shop.owner, rose.id, await jpeg(), {});
    const prefix = `tenants/${shop.owner.tenantId}/`;
    expect([...storage.objects.keys()].some((key) => key.startsWith(prefix))).toBe(true);
    // M3: la foto di un messaggio di un ordine va via con la fioreria.
    const orderId = await confirmedOrder(shop);
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba de eliminación' });
    const messageKeys = [
      `${prefix}order-messages/${orderId}-foto.jpg`,
      `${prefix}order-messages/${orderId}-foto-thumb.jpg`,
    ];
    for (const key of messageKeys) await storage.put(key, await jpeg());
    await withTenantContext(db, shop.owner, (tx) =>
      tx.orderMessage.create({
        data: {
          tenantId: shop.owner.tenantId,
          orderId,
          authorKind: 'SHOP',
          authorUserId: shop.owner.userId,
          body: '',
          photoKey: messageKeys[0]!,
          photoThumbKey: messageKeys[1]!,
          photoWidth: 900,
          photoHeight: 900,
          submitKey: crypto.randomUUID(),
        },
      }),
    );
    // M3-2: una domanda con la sua risposta e una richiesta di cambi vanno via con la fioreria.
    await withTenantContext(db, shop.owner, async (tx) => {
      const question = await tx.orderMessage.create({
        data: {
          tenantId: shop.owner.tenantId,
          orderId,
          authorKind: 'SHOP',
          kind: 'QUESTION',
          body: '¿Te parece el sábado?',
          submitKey: crypto.randomUUID(),
        },
      });
      await tx.orderMessage.create({
        data: {
          tenantId: shop.owner.tenantId,
          orderId,
          authorKind: 'BUYER',
          kind: 'ANSWER',
          answer: 'YES',
          answersMessageId: question.id,
          submitKey: crypto.randomUUID(),
        },
      });
      await tx.orderChangeRequest.create({
        data: { tenantId: shop.owner.tenantId, orderId, before: {} },
      });
    });

    await requestTenantDeletion(shop.owner, { confirmName: 'Florería Que Se Va' }, null);
    // Prima della data non si tocca nulla.
    await purgeDeletedTenants();
    expect(await tenantExists(shop.owner.tenantId)).toBe(true);

    await makeDue(shop.owner.tenantId);
    expect(await purgeDeletedTenants()).toBeGreaterThanOrEqual(1);
    expect(await tenantExists(shop.owner.tenantId)).toBe(false);
    expect([...storage.objects.keys()].some((key) => key.startsWith(prefix))).toBe(false);
    expect(messageKeys.some((key) => storage.objects.has(key))).toBe(false);
    const event = await withSystemContext(db, { reason: 'test: evento' }, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId: null, action: 'platform.tenant_purged', entityId: shop.owner.tenantId },
      }),
    );
    expect(event).toMatchObject({ actorUserId: shop.owner.userId, entityType: 'Tenant' });
    // L'altra fioreria è intatta.
    expect(
      await resolveTenantContext({ userId: other.owner.userId, slug: other.tenant.slug }),
    ).not.toBeNull();
  });

  it("se l'archivio dei file non risponde, la fioreria resta e si riprova", async () => {
    const shop = await createTestShop('Florería Archivio Caído');
    const rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa archivio' }));
    await addCatalogItemPhoto(shop.owner, rose.id, await jpeg(), {});
    await requestTenantDeletion(shop.owner, { confirmName: 'Florería Archivio Caído' }, null);
    await makeDue(shop.owner.tenantId);

    const failing: ObjectStorage = {
      driver: 'memory',
      put: (key, bytes) => storage.put(key, bytes),
      get: (key) => storage.get(key),
      delete: async () => {
        throw new Error('R2 non raggiungibile');
      },
    };
    setObjectStorage(failing);
    try {
      await purgeDeletedTenants();
    } finally {
      setObjectStorage(storage);
    }
    expect(await tenantExists(shop.owner.tenantId)).toBe(true);
    await purgeDeletedTenants();
    expect(await tenantExists(shop.owner.tenantId)).toBe(false);
  });

  it('una fioreria recuperata non si cancella', async () => {
    const shop = await createTestShop('Florería Que Se Queda');
    await requestTenantDeletion(shop.owner, { confirmName: 'Florería Que Se Queda' }, null);
    await restoreTenant({ userId: shop.owner.userId, slug: shop.tenant.slug });
    await purgeDeletedTenants();
    expect(await tenantExists(shop.owner.tenantId)).toBe(true);
    const ctx: TenantContext | null = await resolveTenantContext({
      userId: shop.owner.userId,
      slug: shop.tenant.slug,
    });
    expect(ctx?.tenantId).toBe(shop.owner.tenantId);
  });
});

describe('chi compra e una fioreria in eliminazione', () => {
  const SECRET = 'segreto-di-prova-per-i-link-pubblici-0123456789';
  const deps: OrderMailDeps = {
    mailer,
    appUrl: 'http://localhost:3000',
    secret: SECRET,
    links: {
      order: (slug, id) => `http://localhost:3000/app/${slug}/orders/${id}`,
      account: 'http://localhost:3000/cuenta',
      search: 'http://localhost:3000/',
    },
  };

  it('"Mis pedidos" la nasconde finché non si recupera; "Descargar mis datos" la tiene', async () => {
    const shop = await createTestShop('Florería Del Comprador');
    await updateTenantProfile(shop.owner, {
      displayName: 'Florería Del Comprador',
      contactEmail: `contacto-${shop.tenant.slug}@example.com`,
      contactPhone: '449 555 0100',
      timezone: 'America/Mexico_City',
    });
    const rose = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Rosa en línea', priceMinor: 3500, isOnline: true }),
    );
    await updateOnlineStore(shop.owner, {
      description: '',
      paymentMethods: ['CASH'],
      paymentInstructions: '',
    });
    await updateOnlineOrderSettings(shop.owner, { ordersEnabled: 'on', minLeadDays: '1' });
    await setOnlineStorePublished(shop.owner, true);
    const user = await createTestUser(db, { name: 'Diana Compradora' });
    const buyer = { userId: user.id, country: 'MX' as const };
    const { orderId } = await placeMarketplaceOrder(
      buyer,
      shop.tenant.slug,
      {
        [`qty.${rose.id}`]: '2',
        fulfillmentMode: 'PICKUP',
        scheduledDate: tomorrow(),
        window: '',
        contactPhone: '449 555 0101',
      },
      { fromSearch: false },
      deps,
    );
    // Un ordine in attesa blocca: la fioreria lo chiude prima di eliminarsi.
    await cancelOrder(shop.owner, orderId, { reason: 'Cerramos la florería' });
    await requestTenantDeletion(shop.owner, { confirmName: 'Florería Del Comprador' }, null);

    expect((await listBuyerOrders(buyer, SECRET)).map((order) => order.orderId)).toEqual([]);
    await expect(cancelMarketplaceOrder(buyer, orderId, null)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await exportBuyerData(buyer)).orders).toEqual([
      expect.objectContaining({ shop: 'Florería Del Comprador', status: 'CANCELLED' }),
    ]);

    await restoreTenant({ userId: shop.owner.userId, slug: shop.tenant.slug });
    expect((await listBuyerOrders(buyer, SECRET)).map((order) => order.orderId)).toEqual([orderId]);
  });
});
