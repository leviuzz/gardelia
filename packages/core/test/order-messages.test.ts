import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  addDays,
  dayOfWeek,
  isPendingOrderExpired,
  parseCsv,
  toIsoDate,
  todayInTimeZone,
  type CalendarDate,
} from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  MemoryStorage,
  NotFoundError,
  ValidationError,
  acceptOnlineOrder,
  addDeliveryWindow,
  askOrderChange,
  buyerReorderLines,
  cancelOrder,
  changeOrderStatus,
  countPendingOnlineOrders,
  createCatalogItem,
  declineBuyerOrderChange,
  exportBuyerData,
  exportTenantData,
  getBuyerOrder,
  getBuyerOrderMessagePhoto,
  getOrder,
  getOrderInbox,
  getOrderMessagePhotoImage,
  getOrderThread,
  listBuyerOrders,
  listOrders,
  markBuyerOrderRead,
  markOrderThreadRead,
  notifyOrderCustomer,
  placeMarketplaceOrder,
  postBuyerOrderMessage,
  postOrderMessage,
  purgeOrderMessagePhotos,
  remindPendingOrders,
  removeOrderMessagePhoto,
  setObjectStorage,
  setOnlineStorePublished,
  updateDeliverySettings,
  updateOnlineOrderSettings,
  updateOnlineStore,
  updateOrderFulfillment,
  updateOrderLineQuantity,
  updateTenantProfile,
  type BuyerContext,
  type CatalogItemDto,
  type OrderMailDeps,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Marketplace M3-1 (ADR-088): i messaggi fra chi compra e la fioreria su un ordine online, gli
 * avvisi per email (al primo da leggere, di nuovo dopo 6 ore), le email dei passi una volta sola,
 * «Tu pedido cambió», i motivi di rifiuto, «Da gestire», il promemoria, la regola della scadenza
 * uguale nel dominio e nel database, le foto cancellate, «Pedir de nuevo», i dati della persona e
 * l'isolamento fra fiorerie e fra persone.
 *
 * L'annullamento automatico (globale) si prova in `marketplace-orders.test.ts`, così due file non
 * si contendono gli stessi ordini scaduti.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const APP = 'http://localhost:3000';
const SECRET = 'segreto-di-prova-per-i-link-pubblici-0123456789';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const mailer = new MemoryMailer();
const storage = new MemoryStorage();
const deps: OrderMailDeps = {
  mailer,
  appUrl: APP,
  secret: SECRET,
  links: {
    order: (slug, id) => `${APP}/app/${slug}/orders/${id}`,
    account: `${APP}/cuenta`,
    search: `${APP}/`,
    buyerOrder: (id) => `${APP}/cuenta/pedidos/${id}`,
  },
};
const key = () => crypto.randomUUID();

let shop: TestShop;
let other: TestShop;
let bouquet: CatalogItemDto;
let foreignBouquet: CatalogItemDto;
/** Chi segue il filo principale (e il cui «Scarica i miei dati» si controlla alla fine). */
let ana: BuyerContext & { email: string };

/** Il primo giorno ordinabile (anticipo 1) che non è domenica, più `extra` giorni aperti. */
function openDay(extra = 0): CalendarDate {
  let day = addDays(todayInTimeZone(TZ), 1);
  let left = extra;
  for (;;) {
    if (dayOfWeek(day) !== 0) {
      if (left === 0) return day;
      left -= 1;
    }
    day = addDays(day, 1);
  }
}

function orderForm(item: CatalogItemDto) {
  return {
    [`qty.${item.id}`]: '2',
    fulfillmentMode: 'DELIVERY',
    scheduledDate: toIsoDate(openDay()),
    window: '09:00-12:00',
    buyerAddressId: '',
    addressLine1: 'Av. Madero 120',
    addressLine2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    recipientName: 'Lucía',
    recipientPhone: '449 555 0199',
    deliveryNotes: '',
    cardMessage: '',
    cardSignature: '',
    contactPhone: '449 555 0101',
  };
}

async function openShop(target: TestShop, name: string): Promise<void> {
  await updateTenantProfile(target.owner, {
    displayName: name,
    contactEmail: `contacto-${target.tenant.slug}@example.com`,
    contactPhone: '449 555 0100',
    timezone: TZ,
  });
  await updateDeliverySettings(target.owner, { closedWeekdays: ['0'], defaultFee: '80' });
  await addDeliveryWindow(target.owner, { start: '09:00', end: '12:00' });
  await updateOnlineStore(target.owner, {
    description: '',
    paymentMethods: ['TRANSFER'],
    paymentInstructions: 'CLABE 012 180 0000 0000 0000',
  });
  await updateOnlineOrderSettings(target.owner, { ordersEnabled: 'on', minLeadDays: '1' });
}

/** Una persona nuova: ognuna ha al massimo 3 ordini da accettare per fioreria. */
async function buyer(name = 'Cliente Mensajes'): Promise<BuyerContext & { email: string }> {
  const user = await createTestUser(db, { name });
  return { userId: user.id, country: 'MX', email: user.email };
}

async function place(
  who: BuyerContext,
  target: TestShop = shop,
  item: CatalogItemDto = bouquet,
): Promise<string> {
  const placed = await placeMarketplaceOrder(
    who,
    target.tenant.slug,
    orderForm(item),
    { fromSearch: false },
    deps,
  );
  return placed.orderId;
}

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: '#3f6b4f' } })
      .jpeg()
      .toBuffer(),
  );
}

/** Le email mandate fin qui (e svuota la casella). */
function drain() {
  return mailer.sent.splice(0);
}

/** Sposta indietro le date di un ordine (come se fosse passato del tempo). */
async function backdate(
  orderId: string,
  data: { createdAt?: Date; statusChangedAt?: Date },
): Promise<void> {
  await withTenantContext(db, shop.owner, (tx) =>
    tx.order.updateMany({ where: { tenantId: shop.owner.tenantId, id: orderId }, data }),
  );
}

async function crossTenantEvents(entityId: string) {
  const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
    tx.auditLog.findMany({ where: { tenantId: null, entityId } }),
  );
  return events.filter((event) => event.action === 'security.cross_tenant_access_attempt');
}

beforeAll(async () => {
  setObjectStorage(storage);
  shop = await createTestShop('Florería Mensajes');
  other = await createTestShop('Florería Mensajes Ajena');
  await openShop(shop, 'Florería Mensajes');
  await openShop(other, 'Florería Mensajes Ajena');
  const bouquetInput = {
    type: 'BOUQUET',
    saleUnit: 'PIECE',
    canonicalFlowerId: null,
    variety: null,
    isOnline: true,
  };
  bouquet = await createCatalogItem(
    shop.owner,
    itemInput({ ...bouquetInput, name: 'Ramo Mensajes', priceMinor: 50000 }),
  );
  foreignBouquet = await createCatalogItem(
    other.owner,
    itemInput({ ...bouquetInput, name: 'Ramo Ajeno', priceMinor: 40000 }),
  );
  // Si pubblica con almeno un prodotto online.
  await setOnlineStorePublished(shop.owner, true);
  await setOnlineStorePublished(other.owner, true);
  ana = await buyer('Ana Mensajes');
  drain();
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('il nuovo ordine arriva completo alla fioreria', () => {
  it('prodotti, zona, chi riceve, scadenza e «Ver y aceptar», mai l’indirizzo intero', async () => {
    const orderId = await place(await buyer('Carla Mensajes'));
    const toShop = drain().filter((m) => m.category === 'online_order_new');
    expect(toShop.length).toBeGreaterThan(0);
    const text = toShop[0]!.text;
    expect(text).toContain('Carla Mensajes hizo el pedido');
    expect(text).toContain('2 × Ramo Mensajes');
    expect(text).toContain('Entrega en Centro, Aguascalientes.');
    expect(text).toContain('Recibe: Lucía.');
    expect(text).toContain('Acéptalo o recházalo antes del');
    expect(text).toContain(`Ver y aceptar: ${APP}/app/${shop.tenant.slug}/orders/${orderId}`);
    expect(text).not.toContain('Av. Madero 120');
  });
});

describe('messaggi fra chi compra e la fioreria', () => {
  let orderId: string;

  beforeAll(async () => {
    orderId = await place(ana);
    drain();
  });

  it('chi compra scrive: avviso alla fioreria al primo da leggere, non al secondo', async () => {
    const first = await postBuyerOrderMessage(
      ana,
      orderId,
      { body: '¿Pueden poner girasoles?', submitKey: key() },
      null,
      deps,
    );
    expect(first).toMatchObject({ duplicate: false, notified: true });
    const mails = drain();
    expect(mails.length).toBeGreaterThan(0);
    expect(mails.every((m) => m.category === 'order_message_shop')).toBe(true);
    // Mai il testo del messaggio nell'email.
    expect(mails.map((m) => m.text).join('\n')).not.toContain('girasoles');

    const second = await postBuyerOrderMessage(
      ana,
      orderId,
      { body: 'Gracias', submitKey: key() },
      null,
      deps,
    );
    expect(second.notified).toBe(false);
    expect(drain()).toEqual([]);
  });

  it('ancora da leggere dopo 6 ore: un altro avviso', async () => {
    await withTenantContext(db, shop.owner, (tx) =>
      tx.orderNotice.updateMany({
        where: { tenantId: shop.owner.tenantId, orderId, kind: 'MESSAGE_TO_SHOP' },
        data: { sentAt: new Date(Date.now() - 7 * HOUR) },
      }),
    );
    const third = await postBuyerOrderMessage(
      ana,
      orderId,
      { body: '¿Me confirman?', submitKey: key() },
      null,
      deps,
    );
    expect(third.notified).toBe(true);
    drain();
  });

  it('lo stesso invio due volte scrive un solo messaggio; un messaggio vuoto no', async () => {
    const submitKey = key();
    const a = await postBuyerOrderMessage(ana, orderId, { body: 'Uno', submitKey }, null, deps);
    const b = await postBuyerOrderMessage(ana, orderId, { body: 'Uno', submitKey }, null, deps);
    expect(b).toMatchObject({ id: a.id, duplicate: true, notified: false });
    await expect(
      postBuyerOrderMessage(ana, orderId, { body: '   ', submitKey: key() }, null, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    drain();
  });

  it('la squadra legge (anche lo staff) e segna come letto per tutti', async () => {
    const thread = await getOrderThread(shop.staff, orderId);
    expect(thread).toMatchObject({ open: true, buyerName: 'Ana Mensajes', canRemovePhotos: false });
    expect(thread!.unreadCount).toBe(4);
    expect(thread!.messages.map((m) => m.body)).toEqual([
      '¿Pueden poner girasoles?',
      'Gracias',
      '¿Me confirman?',
      'Uno',
    ]);
    expect(thread!.messages.every((m) => m.authorKind === 'BUYER' && m.unread)).toBe(true);
    expect((await getOrder(shop.staff, orderId)).unreadMessages).toBe(4);
    expect(await markOrderThreadRead(shop.staff, orderId)).toBe(4);
    expect((await getOrder(shop.staff, orderId)).unreadMessages).toBe(0);
    expect((await getOrderThread(shop.owner, orderId))!.unreadCount).toBe(0);
    // Letto tutto: il prossimo messaggio di chi compra avvisa di nuovo.
    const after = await postBuyerOrderMessage(
      ana,
      orderId,
      { body: 'Otra cosa', submitKey: key() },
      null,
      deps,
    );
    expect(after.notified).toBe(true);
    drain();
  });

  it('la fioreria scrive: avviso a chi compra al primo da leggere, poi niente finché non legge', async () => {
    const first = await postOrderMessage(
      shop.staff,
      orderId,
      { body: 'Sí, con girasoles', submitKey: key() },
      null,
      deps,
    );
    expect(first.notified).toBe(true);
    const toBuyer = drain();
    expect(toBuyer).toHaveLength(1);
    expect(toBuyer[0]).toMatchObject({ category: 'order_message_buyer', to: ana.email });
    expect(toBuyer[0]!.subject).toContain('Florería Mensajes te escribió sobre tu pedido');
    expect(toBuyer[0]!.text).toContain(`${APP}/cuenta/pedidos/${orderId}`);
    expect(toBuyer[0]!.text).not.toContain('girasoles');

    const second = await postOrderMessage(
      shop.owner,
      orderId,
      { body: 'Llega a las 10', submitKey: key() },
      null,
      deps,
    );
    expect(second.notified).toBe(false);
    let page = await getBuyerOrder(ana, orderId, { secret: SECRET });
    expect(page.thread.unreadCount).toBe(2);
    expect(page.thread.messages.filter((m) => m.unread).map((m) => m.body)).toEqual([
      'Sí, con girasoles',
      'Llega a las 10',
    ]);
    const listed = (await listBuyerOrders(ana, SECRET)).find((o) => o.orderId === orderId);
    expect(listed?.newMessages).toBe(2);
    await markBuyerOrderRead(ana, orderId);
    page = await getBuyerOrder(ana, orderId, { secret: SECRET });
    expect(page.thread.unreadCount).toBe(0);
    const third = await postOrderMessage(
      shop.owner,
      orderId,
      { body: 'Ya salió', submitKey: key() },
      null,
      deps,
    );
    expect(third.notified).toBe(true);
    drain();
  });

  it('la pagina di chi compra: la fioreria, la scadenza, «Annulla» e il link di stato', async () => {
    const page = await getBuyerOrder(ana, orderId, { secret: SECRET });
    expect(page).toMatchObject({
      orderId,
      canCancel: true,
      canReorder: false,
      shop: { slug: shop.tenant.slug, name: 'Florería Mensajes' },
      order: { status: 'PENDING_ACCEPTANCE' },
    });
    expect(page.deadline).toBeInstanceOf(Date);
    expect(page.trackingPath).toMatch(/^\/pedido\//);
  });

  it('una foto: la vedono tutti e due; chi gestisce gli ordini la toglie e i file si cancellano', async () => {
    const posted = await postBuyerOrderMessage(
      ana,
      orderId,
      { body: '', submitKey: key() },
      await jpeg(),
      deps,
    );
    drain();
    const thumb = await getOrderMessagePhotoImage(shop.staff, orderId, posted.id, 'thumb');
    expect(thumb.contentType).toBe('image/jpeg');
    expect(await getBuyerOrderMessagePhoto(ana, orderId, posted.id, 'full')).not.toBeNull();
    const files = [...storage.objects.keys()].filter((k) => k.includes(`${orderId}-`));
    expect(files).toHaveLength(2);
    expect(files.every((k) => k.startsWith(`tenants/${shop.owner.tenantId}/order-messages/`))).toBe(
      true,
    );

    await expect(removeOrderMessagePhoto(shop.staff, orderId, posted.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await removeOrderMessagePhoto(shop.owner, orderId, posted.id);
    expect(files.some((k) => storage.objects.has(k))).toBe(false);
    expect(await getBuyerOrderMessagePhoto(ana, orderId, posted.id, 'full')).toBeNull();
    await expect(
      getOrderMessagePhotoImage(shop.owner, orderId, posted.id, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    const thread = await getOrderThread(shop.owner, orderId, 5);
    expect(thread!.messages.find((m) => m.id === posted.id)).toMatchObject({
      hasPhoto: false,
      photoGone: true,
    });
  });

  it('30 messaggi al giorno da chi compra, poi basta (la squadra non ha tetto)', async () => {
    const beto = await buyer('Beto Mensajes');
    const order = await place(beto);
    await withTenantContext(db, shop.owner, (tx) =>
      tx.orderMessage.createMany({
        data: Array.from({ length: 30 }, (_, index) => ({
          tenantId: shop.owner.tenantId,
          orderId: order,
          authorKind: 'BUYER' as const,
          authorUserId: beto.userId,
          body: `Mensaje ${index}`,
          submitKey: key(),
        })),
      }),
    );
    await expect(
      postBuyerOrderMessage(beto, order, { body: 'Uno más', submitKey: key() }, null, deps),
    ).rejects.toMatchObject({ reason: 'order_message_daily_limit' });
    await postOrderMessage(shop.owner, order, { body: 'Te leemos', submitKey: key() }, null, deps);
    drain();
  });

  it('7 giorni dopo la chiusura il filo si legge e basta', async () => {
    const beto = await buyer('Beto Cerrado');
    const order = await place(beto);
    await cancelOrder(shop.owner, order, { reasonCode: 'NO_AVAILABILITY', detail: '' }, deps);
    await postBuyerOrderMessage(
      beto,
      order,
      { body: '¿Y otro día?', submitKey: key() },
      null,
      deps,
    );
    await backdate(order, { statusChangedAt: new Date(Date.now() - 8 * DAY) });
    await expect(
      postBuyerOrderMessage(beto, order, { body: '¿Por qué?', submitKey: key() }, null, deps),
    ).rejects.toMatchObject({ reason: 'order_message_closed' });
    await expect(
      postOrderMessage(shop.owner, order, { body: 'Perdón', submitKey: key() }, null, deps),
    ).rejects.toMatchObject({ reason: 'order_message_closed' });
    const thread = await getOrderThread(shop.owner, order);
    expect(thread).toMatchObject({ open: false });
    expect(thread!.messages.map((m) => m.body)).toEqual(['¿Y otro día?']);
    expect((await getBuyerOrder(beto, order, { secret: SECRET })).thread.open).toBe(false);
    drain();
  });
});

describe('isolamento fra persone e fra fiorerie (A↔B)', () => {
  let orderId: string;
  let messageId: string;
  let foreignOrder: string;
  let intruder: BuyerContext;
  let foreignBuyer: BuyerContext;

  beforeAll(async () => {
    const owner = await buyer('Dueña Aislada');
    orderId = await place(owner);
    const posted = await postBuyerOrderMessage(
      owner,
      orderId,
      { body: 'Solo para mi florería', submitKey: key() },
      await jpeg(),
      deps,
    );
    messageId = posted.id;
    intruder = await buyer('Intruso');
    foreignBuyer = await buyer('Cliente Ajeno');
    foreignOrder = await place(foreignBuyer, other, foreignBouquet);
    drain();
  });

  it("l'ordine di un'altra persona risponde 404, come uno che non c'è", async () => {
    await expect(getBuyerOrder(intruder, orderId, { secret: SECRET })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      postBuyerOrderMessage(intruder, orderId, { body: 'Hola', submitKey: key() }, null, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(markBuyerOrderRead(intruder, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(buyerReorderLines(intruder, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getBuyerOrderMessagePhoto(intruder, orderId, messageId, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getBuyerOrder(intruder, crypto.randomUUID(), { secret: SECRET }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Anche un suo ordine vero, ma di un'altra fioreria, non apre l'ordine di questa.
    await expect(getBuyerOrder(foreignBuyer, orderId, { secret: SECRET })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(drain()).toEqual([]);
  });

  it("dalla fioreria B l'ordine e il messaggio di A non esistono (404 con l'evento di sicurezza)", async () => {
    await expect(getOrderThread(other.owner, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      postOrderMessage(other.owner, orderId, { body: 'Hola', submitKey: key() }, null, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(markOrderThreadRead(other.owner, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getOrderMessagePhotoImage(other.owner, orderId, messageId, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeOrderMessagePhoto(other.owner, orderId, messageId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await crossTenantEvents(orderId)).length).toBeGreaterThan(0);
    expect((await crossTenantEvents(messageId)).length).toBeGreaterThan(0);
    // Niente è cambiato nell'ordine di A.
    const thread = await getOrderThread(shop.owner, orderId);
    expect(thread!.messages.map((m) => [m.body, m.hasPhoto])).toEqual([
      ['Solo para mi florería', true],
    ]);
    expect(thread!.unreadCount).toBe(1);
    // E B vede solo i suoi numeri.
    expect((await getOrderInbox(other.owner)).unreadMessages).toBe(0);
    expect((await getOrderThread(other.owner, foreignOrder))!.messages).toEqual([]);
    expect(drain()).toEqual([]);
  });
});

describe('avvisi dei passi e dei cambi a chi compra', () => {
  it('un passo avvisa una volta sola, anche avanti e indietro; «Pronto» di una consegna no', async () => {
    const who = await buyer('Cliente Pasos');
    const orderId = await place(who);
    await acceptOnlineOrder(shop.owner, orderId, deps);
    drain();
    await changeOrderStatus(shop.staff, orderId, 'IN_PREPARATION', { mail: deps });
    const preparing = drain();
    expect(preparing.map((m) => [m.category, m.to])).toEqual([['online_order_step', who.email]]);
    expect(preparing[0]!.subject).toContain('Estamos preparando tu pedido');
    await changeOrderStatus(shop.staff, orderId, 'CONFIRMED', { mail: deps });
    await changeOrderStatus(shop.staff, orderId, 'IN_PREPARATION', { mail: deps });
    await changeOrderStatus(shop.staff, orderId, 'READY', { mail: deps, confirmShortage: true });
    expect(drain()).toEqual([]);
    await changeOrderStatus(shop.staff, orderId, 'OUT_FOR_DELIVERY', { mail: deps });
    await changeOrderStatus(shop.staff, orderId, 'READY', { mail: deps });
    await changeOrderStatus(shop.staff, orderId, 'OUT_FOR_DELIVERY', { mail: deps });
    await changeOrderStatus(shop.staff, orderId, 'DELIVERED', { mail: deps });
    const mails = drain();
    expect(mails.map((m) => m.subject)).toEqual([
      expect.stringContaining('va en camino'),
      expect.stringContaining('Entregamos tu pedido'),
    ]);
  });

  it('«Tu pedido cambió» solo con la casella o con il pulsante; lo staff non avvisa', async () => {
    const who = await buyer('Cliente Cambios');
    const orderId = await place(who);
    await acceptOnlineOrder(shop.owner, orderId, deps);
    drain();
    const base = {
      fulfillmentMode: 'DELIVERY',
      scheduledDate: toIsoDate(openDay(1)),
      windowStart: '12:00',
      windowEnd: '15:00',
      customerAddressId: '',
      addressLine1: 'Av. Madero 120',
      addressLine2: '',
      neighborhood: 'Centro',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      recipientName: 'Lucía',
      recipientPhone: '449 555 0199',
      deliveryNotes: '',
      cardMessage: '',
      cardSignature: '',
      deliveryFee: '80',
      notes: '',
    };
    await updateOrderFulfillment(shop.owner, orderId, base, deps);
    expect(drain()).toEqual([]);
    // Con la casella ma senza cambi che chi compra vede (solo le note interne): niente email.
    await updateOrderFulfillment(
      shop.owner,
      orderId,
      { ...base, notes: 'Llamar antes', notifyCustomer: 'on' },
      deps,
    );
    expect(drain()).toEqual([]);
    await updateOrderFulfillment(
      shop.owner,
      orderId,
      { ...base, windowStart: '15:00', windowEnd: '18:00', notifyCustomer: 'on' },
      deps,
    );
    const changed = drain();
    expect(changed.map((m) => [m.category, m.to])).toEqual([['online_order_changed', who.email]]);
    expect(changed[0]!.text).toContain('15:00');
    expect(changed[0]!.text).toContain(`${APP}/cuenta/pedidos/${orderId}`);

    expect((await getOrder(shop.owner, orderId)).canNotifyCustomer).toBe(true);
    expect((await getOrder(shop.staff, orderId)).canNotifyCustomer).toBe(false);
    await notifyOrderCustomer(shop.owner, orderId, deps);
    expect(drain().map((m) => m.category)).toEqual(['online_order_changed']);
    await expect(notifyOrderCustomer(shop.staff, orderId, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const audit = await withTenantContext(db, shop.owner, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: shop.owner.tenantId, entityId: orderId },
        select: { action: true, metadata: true },
      }),
    );
    expect(audit.map((row) => row.action)).toContain('order.customer_notified');
    expect(
      audit.filter(
        (row) =>
          row.action === 'order.updated' &&
          (row.metadata as Record<string, unknown>).customerNotified === true,
      ),
    ).toHaveLength(1);
  });

  it('un ordine da accettare non si «avvisa dei cambi»: lo fa l’accettazione', async () => {
    const orderId = await place(await buyer('Cliente Pendiente'));
    drain();
    expect((await getOrder(shop.owner, orderId)).canNotifyCustomer).toBe(false);
    await expect(notifyOrderCustomer(shop.owner, orderId, deps)).rejects.toMatchObject({
      reason: 'order_not_notifiable',
    });
    expect(drain()).toEqual([]);
  });
});

describe('«Rifiuta» con un motivo pronto', () => {
  it('chi compra legge la frase nella lingua del mercato; il registro tiene solo il tipo', async () => {
    const who = await buyer('Cliente Rechazado');
    const orderId = await place(who);
    drain();
    await cancelOrder(
      shop.owner,
      orderId,
      { reasonCode: 'OUT_OF_AREA', detail: 'Solo entregamos en el centro.' },
      deps,
    );
    expect((await getOrder(shop.owner, orderId)).cancelReason).toBe(
      'No llegamos a esa dirección. Solo entregamos en el centro.',
    );
    expect(mailer.lastTo(who.email)!.text).toContain('No llegamos a esa dirección.');
    const audit = await withTenantContext(db, shop.owner, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId: shop.owner.tenantId, entityId: orderId, action: 'order.cancelled' },
      }),
    );
    expect(audit?.metadata).toMatchObject({ reasonCode: 'OUT_OF_AREA' });
    expect(JSON.stringify(audit?.metadata)).not.toContain('centro');
    drain();
  });

  it('«Altro motivo» senza testo non si manda', async () => {
    const orderId = await place(await buyer('Cliente Otro Motivo'));
    drain();
    await expect(
      cancelOrder(shop.owner, orderId, { reasonCode: 'OTHER', detail: '' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await getOrder(shop.owner, orderId)).status).toBe('PENDING_ACCEPTANCE');
    expect(drain()).toEqual([]);
  });
});

describe('«Da gestire», elenco, promemoria e regola della scadenza', () => {
  it('i numeri: ordini da accettare con la prima scadenza, messaggi da leggere', async () => {
    const inbox = await getOrderInbox(shop.owner);
    expect(inbox.pendingOnline).toBeGreaterThan(0);
    expect(inbox.firstDeadline).toBeInstanceOf(Date);
    expect(inbox.unreadMessages).toBeGreaterThan(0);
    expect(inbox.unreadOrders).toBeGreaterThan(0);
    // Lo staff vede gli stessi numeri.
    expect(await getOrderInbox(shop.staff)).toEqual(inbox);
    // Il numero nel menu: solo per chi può accettare (proprietario e gerente).
    expect(await countPendingOnlineOrders(shop.owner)).toBe(inbox.pendingOnline);
    expect(await countPendingOnlineOrders(shop.manager)).toBe(inbox.pendingOnline);
    expect(await countPendingOnlineOrders(shop.staff)).toBe(0);
    expect(await countPendingOnlineOrders(other.owner)).toBeLessThan(inbox.pendingOnline);

    const list = await listOrders(shop.owner, { messages: 'unread', when: 'all' });
    expect(list.messagesFilter).toBe(true);
    expect(list.unreadOrdersCount).toBe(inbox.unreadOrders);
    expect(list.items).toHaveLength(inbox.unreadOrders);
    expect(list.items.every((item) => item.placedOnline && item.unreadMessages > 0)).toBe(true);
    const total = list.items.reduce((sum, item) => sum + item.unreadMessages, 0);
    expect(total).toBe(inbox.unreadMessages);
    const pending = list.items.find((item) => item.status === 'PENDING_ACCEPTANCE');
    // La scadenza si vede nell'elenco e nella pagina dell'ordine, uguale.
    expect(pending!.onlineDeadline).toBeInstanceOf(Date);
    expect((await getOrder(shop.owner, pending!.id)).onlineDeadline).toEqual(
      pending!.onlineDeadline,
    );
    expect(
      list.items
        .filter((item) => item.status !== 'PENDING_ACCEPTANCE')
        .every((item) => item.onlineDeadline === null),
    ).toBe(true);
  });

  it('il promemoria parte una volta sola, per gli ordini che scadono prima del prossimo giro', async () => {
    const orderId = await place(await buyer('Cliente Recordatorio'));
    const fresh = await place(await buyer('Cliente Reciente'));
    const numberOf = async (id: string) => (await getOrder(shop.owner, id)).numberLabel;
    const [label, freshLabel] = [await numberOf(orderId), await numberOf(fresh)];
    drain();
    // Inviato 2 giorni e mezzo fa: scade fra 12 ore, prima del prossimo giro.
    await backdate(orderId, { createdAt: new Date(Date.now() - 2.5 * DAY) });
    await remindPendingOrders(deps);
    const forOrder = (number: string) =>
      drain().filter((m) => m.category === 'online_order_reminder' && m.subject.includes(number));
    const reminders = forOrder(label);
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders[0]!.subject).toBe(`El pedido ${label} se cancela pronto`);
    expect(reminders[0]!.text).toContain('se cancela solo');
    expect(reminders[0]!.text).toContain(`${APP}/app/${shop.tenant.slug}/orders/${orderId}`);
    await remindPendingOrders(deps);
    expect(forOrder(label)).toEqual([]);
    // Quello appena arrivato non ha ancora bisogno del promemoria.
    await remindPendingOrders(deps);
    expect(forOrder(freshLabel)).toEqual([]);
  });

  it('M3-2: mentre aspetta chi compra il promemoria va a lui, ed è uno per scadenza', async () => {
    const who = await buyer('Cliente Recordatorio Cambios');
    const orderId = await place(who);
    const placed = await getOrder(shop.owner, orderId);
    await updateOrderLineQuantity(shop.owner, orderId, placed.lines[0]!.id, '3');
    await askOrderChange(shop.owner, orderId, {}, deps);
    // Chiesto 2 giorni e mezzo fa, con la consegna più avanti: scade fra 12 ore.
    await withTenantContext(db, shop.owner, async (tx) => {
      await tx.order.updateMany({
        where: { tenantId: shop.owner.tenantId, id: orderId },
        data: {
          createdAt: new Date(Date.now() - 3 * DAY),
          scheduledDate: new Date(`${toIsoDate(openDay(10))}T00:00:00Z`),
        },
      });
      await tx.orderChangeRequest.updateMany({
        where: { tenantId: shop.owner.tenantId, orderId },
        data: { askedAt: new Date(Date.now() - 2.5 * DAY) },
      });
    });
    drain();
    await remindPendingOrders(deps);
    const forOrder = (category: string) =>
      drain().filter((m) => m.category === category && m.subject.includes(placed.numberLabel));
    const toBuyer = forOrder('online_order_change_reminder');
    expect(toBuyer.map((m) => m.to)).toEqual([who.email]);
    expect(toBuyer[0]!.subject).toBe(`Confirma los cambios de tu pedido ${placed.numberLabel}`);
    await remindPendingOrders(deps);
    expect(forOrder('online_order_change_reminder')).toEqual([]);

    // «No, gracias» dopo quel promemoria, 2 giorni e mezzo fa: il conto è ripartito e il
    // promemoria nuovo va alla fioreria.
    await declineBuyerOrderChange(who, orderId, { round: '1' }, deps);
    await withTenantContext(db, shop.owner, async (tx) => {
      await tx.orderNotice.updateMany({
        where: { tenantId: shop.owner.tenantId, orderId, kind: 'EXPIRY_REMINDER' },
        data: { sentAt: new Date(Date.now() - 2.7 * DAY) },
      });
      await tx.orderChangeRequest.updateMany({
        where: { tenantId: shop.owner.tenantId, orderId },
        data: { answeredAt: new Date(Date.now() - 2.5 * DAY) },
      });
    });
    drain();
    await remindPendingOrders(deps);
    expect(forOrder('online_order_reminder').length).toBeGreaterThan(0);
  });

  it('la funzione SQL della scadenza sceglie come la regola del dominio', async () => {
    const now = Date.now();
    const today = todayInTimeZone(TZ);
    const candidates = [
      // 4 giorni senza risposta: scaduto anche se il giorno è lontano.
      { createdAt: new Date(now - 4 * DAY), scheduledDate: openDay(10) },
      // Il giorno della consegna è passato: scaduto anche se è appena arrivato.
      { createdAt: new Date(now), scheduledDate: addDays(today, -1) },
      // Consegna oggi: si accetta ancora fino a mezzanotte.
      { createdAt: new Date(now - 2 * DAY), scheduledDate: today },
      // Appena arrivato, consegna fra qualche giorno.
      { createdAt: new Date(now), scheduledDate: openDay(2) },
    ];
    const ids: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      ids.push(await place(await buyer('Cliente Vencimiento')));
    }
    drain();
    class Rollback extends Error {}
    let picked = new Set<string>();
    // Date cambiate e lettura nella stessa transazione, poi annullata: gli altri test (anche di
    // altri file, che girano insieme) non vedono mai questi ordini scaduti.
    await expect(
      withTenantContext(db, shop.owner, async (tx) => {
        for (const [index, candidate] of candidates.entries()) {
          await tx.order.updateMany({
            where: { tenantId: shop.owner.tenantId, id: ids[index]! },
            data: {
              createdAt: candidate.createdAt,
              scheduledDate: new Date(`${toIsoDate(candidate.scheduledDate)}T00:00:00Z`),
            },
          });
        }
        const rows = await tx.$queryRaw<{ order_id: string }[]>`
          SELECT order_id FROM app_pending_orders_to_expire(3, 100000)`;
        picked = new Set(rows.map((row) => row.order_id));
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    const expected = candidates.map((candidate) =>
      isPendingOrderExpired(candidate, new Date(), TZ),
    );
    expect(expected).toEqual([true, true, false, false]);
    expect(ids.map((id) => picked.has(id))).toEqual(expected);
  });
});

describe('foto cancellate, «Pedir de nuevo» e dati della persona', () => {
  it('le foto dei messaggi si cancellano 30 giorni dopo la chiusura; il testo resta', async () => {
    const who = await buyer('Cliente Fotos');
    const orderId = await place(who);
    const posted = await postBuyerOrderMessage(
      who,
      orderId,
      { body: 'Así lo quiero', submitKey: key() },
      await jpeg(),
      deps,
    );
    const stillOpen = await place(await buyer('Cliente Foto Abierta'));
    const kept = await postOrderMessage(
      shop.owner,
      stillOpen,
      { body: 'Esta foto se queda', submitKey: key() },
      await jpeg(),
      deps,
    );
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba de fotos' }, deps);
    await backdate(orderId, { statusChangedAt: new Date(Date.now() - 31 * DAY) });
    drain();
    expect(await purgeOrderMessagePhotos()).toBeGreaterThan(0);
    const rows = await withTenantContext(db, shop.owner, (tx) =>
      tx.orderMessage.findMany({
        where: { tenantId: shop.owner.tenantId, id: { in: [posted.id, kept.id] } },
        select: { id: true, body: true, photoKey: true, photoDeletedAt: true },
      }),
    );
    const purged = rows.find((row) => row.id === posted.id)!;
    expect(purged.photoDeletedAt).toBeInstanceOf(Date);
    expect(purged.body).toBe('Así lo quiero');
    expect(purged.photoKey).not.toBeNull();
    expect(storage.objects.has(purged.photoKey!)).toBe(false);
    expect(await getBuyerOrderMessagePhoto(who, orderId, posted.id, 'full')).toBeNull();
    // L'ordine ancora aperto tiene la sua foto.
    const open = rows.find((row) => row.id === kept.id)!;
    expect(open.photoDeletedAt).toBeNull();
    expect(storage.objects.has(open.photoKey!)).toBe(true);
  });

  it('«Pedir de nuevo» solo per un ordine chiuso, con i prodotti del catalogo', async () => {
    const who = await buyer('Cliente Repetir');
    const orderId = await place(who);
    drain();
    await expect(buyerReorderLines(who, orderId)).rejects.toBeInstanceOf(ConflictError);
    expect((await getBuyerOrder(who, orderId, { secret: SECRET })).canReorder).toBe(false);
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba de pedir de nuevo' }, deps);
    drain();
    expect((await getBuyerOrder(who, orderId, { secret: SECRET })).canReorder).toBe(true);
    expect(await buyerReorderLines(who, orderId)).toEqual({
      shopSlug: shop.tenant.slug,
      lines: [{ itemId: bouquet.id, quantity: 2 }],
      skipped: 0,
    });
  });

  it('«Scarica i miei dati» ha i messaggi scritti dalla persona, solo i suoi', async () => {
    const data = await exportBuyerData(ana);
    const texts = data.orderMessages.map((m) => m.text);
    expect(texts).toContain('¿Pueden poner girasoles?');
    expect(texts).not.toContain('Sí, con girasoles');
    expect(data.orderMessages.every((m) => m.shop === 'Florería Mensajes')).toBe(true);
    expect(data.orderMessages.some((m) => m.withPhoto)).toBe(true);
    const otherData = await exportBuyerData(await buyer('Cliente Sin Mensajes'));
    expect(otherData.orderMessages).toEqual([]);
  });

  it('chi elimina il conto: i messaggi restano alla fioreria senza nome, il filo si chiude', async () => {
    const who = await buyer('Cliente Que Se Va');
    const orderId = await place(who);
    await postBuyerOrderMessage(who, orderId, { body: 'Adiós', submitKey: key() }, null, deps);
    await markBuyerOrderRead(who, orderId);
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba de cuenta eliminada' }, deps);
    drain();
    await db.user.delete({ where: { id: who.userId } });
    const thread = await getOrderThread(shop.owner, orderId);
    expect(thread).toMatchObject({ open: false, buyerName: '' });
    expect(thread!.messages).toEqual([
      expect.objectContaining({ body: 'Adiós', authorKind: 'BUYER', authorName: null }),
    ]);
    await expect(
      postOrderMessage(shop.owner, orderId, { body: '¿Sigues ahí?', submitKey: key() }, null, deps),
    ).rejects.toMatchObject({ reason: 'order_message_closed' });
    expect(drain()).toEqual([]);
  });

  it('lo ZIP della fioreria ha `pedidos_mensajes.csv`, solo con i suoi messaggi', async () => {
    const rowsOf = async (target: TestShop) => {
      const entries = unzipSync((await exportTenantData(target.owner)).bytes);
      const [header, ...rows] = parseCsv(
        strFromU8(entries['pedidos_mensajes.csv']!).replace(/^\uFEFF/, ''),
        ',',
      );
      return rows.map((row) => Object.fromEntries(header!.map((k, i) => [k, row[i] ?? ''])));
    };
    const rows = await rowsOf(shop);
    expect(rows.find((row) => row.Mensaje === '¿Pueden poner girasoles?')).toMatchObject({
      Escribió: 'Cliente',
      Persona: 'Ana Mensajes',
      Foto: 'no',
    });
    expect(rows.find((row) => row.Mensaje === 'Sí, con girasoles')).toMatchObject({
      Escribió: 'Florería',
    });
    expect(rows.some((row) => row.Mensaje === 'Solo para mi florería')).toBe(true);
    expect((await rowsOf(other)).some((row) => row.Mensaje === 'Solo para mi florería')).toBe(
      false,
    );
  });
});
