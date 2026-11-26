import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  addDays,
  dayOfWeek,
  orderLinkExpiry,
  publicLinkExpiry,
  toIsoDate,
  todayInTimeZone,
  type CalendarDate,
} from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  NotFoundError,
  ValidationError,
  acceptOnlineOrder,
  addBuyerAddress,
  addDeliveryWindow,
  cancelOrder,
  changeOrderStatus,
  createCatalogItem,
  createCustomer,
  expireUnacceptedOrders,
  getCheckoutForm,
  getCustomer,
  getOnlineStoreSettings,
  getOrder,
  getPublicOrder,
  listBuyerOrders,
  openBuyerAccount,
  placeMarketplaceOrder,
  setOnlineStorePublished,
  updateDeliverySettings,
  updateOnlineOrderSettings,
  updateOnlineStore,
  updateCustomer,
  updateOrderFulfillment,
  updateTenantProfile,
  type BuyerContext,
  type CatalogItemDto,
  type OrderMailDeps,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Ordine del cliente dalla tienda en línea (blocco C4, ADR-067): prezzi decisi dal server, regole
 * di consegna della fioreria, cliente nel CRM, accettazione o rifiuto con email, scadenza, e
 * isolamento fra fiorerie e fra persone.
 */

const db = getDb();
const SECRET = 'segreto-di-prova-per-i-link-pubblici-0123456789';
const mailer = new MemoryMailer();
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

let shop: TestShop;
let other: TestShop;
let bouquet: CatalogItemDto;
let rose: CatalogItemDto;
let hidden: CatalogItemDto;
let soldOut: CatalogItemDto;
let foreign: CatalogItemDto;
let ana: BuyerContext & { email: string };
let beto: BuyerContext & { email: string };
let carla: BuyerContext & { email: string };

/** Il primo giorno ordinabile (anticipo 1) che non è domenica, più `extra` giorni aperti. */
function openDay(extra = 0): CalendarDate {
  let day = addDays(todayInTimeZone('America/Mexico_City'), 1);
  let left = extra;
  for (;;) {
    if (dayOfWeek(day) !== 0) {
      if (left === 0) return day;
      left -= 1;
    }
    day = addDays(day, 1);
  }
}

function nextSunday(): CalendarDate {
  let day = addDays(todayInTimeZone('America/Mexico_City'), 1);
  while (dayOfWeek(day) !== 0) day = addDays(day, 1);
  return day;
}

function orderForm(overrides: Record<string, unknown> = {}) {
  return {
    [`qty.${bouquet.id}`]: '1',
    [`qty.${rose.id}`]: '2',
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
    deliveryNotes: 'Portón verde',
    cardMessage: '¡Feliz cumpleaños!',
    cardSignature: 'Ana',
    contactPhone: '449 555 0101',
    ...overrides,
  };
}

async function openShop(target: TestShop, name: string) {
  await updateTenantProfile(target.owner, {
    displayName: name,
    contactEmail: `contacto-${target.tenant.slug}@example.com`,
    contactPhone: '449 555 0100',
    timezone: 'America/Mexico_City',
  });
}

async function buyer(name: string) {
  const user = await createTestUser(db, { name });
  return { userId: user.id, country: 'MX' as const, email: user.email };
}

beforeAll(async () => {
  shop = await createTestShop('Florería Pedidos');
  other = await createTestShop('Florería Pedidos Ajena');
  await openShop(shop, 'Florería Pedidos');
  await openShop(other, 'Florería Pedidos Ajena');
  const bouquetInput = {
    type: 'BOUQUET',
    saleUnit: 'PIECE',
    canonicalFlowerId: null,
    variety: null,
    isOnline: true,
  };
  bouquet = await createCatalogItem(
    shop.owner,
    itemInput({ ...bouquetInput, name: 'Ramo Primavera', priceMinor: 69000, costMinor: 30000 }),
  );
  rose = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Rosa roja', priceMinor: 3500, isOnline: true }),
  );
  hidden = await createCatalogItem(
    shop.owner,
    itemInput({ ...bouquetInput, name: 'Ramo de mostrador', priceMinor: 10000, isOnline: false }),
  );
  soldOut = await createCatalogItem(
    shop.owner,
    itemInput({
      ...bouquetInput,
      name: 'Ramo agotado',
      priceMinor: 20000,
      availability: 'OUT_OF_STOCK',
    }),
  );
  foreign = await createCatalogItem(
    other.owner,
    itemInput({ ...bouquetInput, name: 'Ramo ajeno', priceMinor: 100 }),
  );
  await updateDeliverySettings(shop.owner, { closedWeekdays: ['0'], defaultFee: '80' });
  await addDeliveryWindow(shop.owner, { start: '09:00', end: '12:00' });
  await setOnlineStorePublished(shop.owner, true);
  await setOnlineStorePublished(other.owner, true);
  ana = await buyer('Ana Compradora');
  beto = await buyer('Beto Comprador');
  carla = await buyer('Carla Compradora');
});

afterAll(async () => {
  await disconnectDb();
});

describe('impostazioni degli ordini online', () => {
  it('si accendono solo con un modo di pagare; staff no; spenti per tutte le fiorerie nuove', async () => {
    expect(await getOnlineStoreSettings(shop.owner)).toMatchObject({
      ordersEnabled: false,
      minLeadDays: 1,
      ordersBlockers: ['store_needs_payment'],
    });
    await expect(
      updateOnlineOrderSettings(shop.owner, { ordersEnabled: 'on', minLeadDays: '1' }),
    ).rejects.toMatchObject({ reason: 'store_needs_payment' });
    await updateOnlineStore(shop.owner, {
      description: '',
      paymentMethods: ['TRANSFER', 'CASH'],
      paymentInstructions: 'CLABE 012 180 0000 0000 0000',
    });
    await expect(
      updateOnlineOrderSettings(shop.staff, { ordersEnabled: 'on', minLeadDays: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await updateOnlineOrderSettings(shop.manager, { ordersEnabled: 'on', minLeadDays: '1' });
    expect(await getOnlineStoreSettings(shop.owner)).toMatchObject({
      ordersEnabled: true,
      ordersBlockers: [],
    });
    // Con gli ordini accesi non si tolgono tutte le forme di pagamento.
    await expect(
      updateOnlineStore(shop.owner, {
        description: '',
        paymentMethods: [],
        paymentInstructions: '',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateOnlineOrderSettings(shop.owner, { ordersEnabled: 'on', minLeadDays: '15' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("modulo d'ordine", () => {
  it('senza ordini online la tienda non ha il modulo', async () => {
    expect(await getCheckoutForm(ana, other.tenant.slug)).toBeNull();
    await expect(
      placeMarketplaceOrder(
        ana,
        other.tenant.slug,
        orderForm({ [`qty.${foreign.id}`]: '1' }),
        {
          fromSearch: false,
        },
        deps,
      ),
    ).rejects.toMatchObject({ reason: 'checkout_closed' });
    expect(await getCheckoutForm(ana, 'non-esiste-questa-tienda')).toBeNull();
  });

  it('solo prodotti visibili e disponibili, regole di consegna e dati di chi compra', async () => {
    const form = await getCheckoutForm(ana, shop.tenant.slug);
    expect(form).not.toBeNull();
    const ids = form!.items.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([bouquet.id, rose.id]));
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(soldOut.id);
    expect(ids).not.toContain(foreign.id);
    expect(form!.delivery).toMatchObject({
      windows: [{ start: '09:00', end: '12:00' }],
      closedWeekdays: [0],
      feeMinor: 8000,
      // Il primo giorno aperto (la domenica è chiusa): mai un giorno chiuso come minimo (M1).
      minDate: toIsoDate(openDay()),
      firstDate: toIsoDate(openDay()),
    });
    expect(form!.store.paymentMethods).toEqual(['TRANSFER', 'CASH']);
    expect(form!.store.policies).toEqual({
      changes: null,
      cancellations: null,
      substitutions: null,
    });
    expect(form!.buyer).toMatchObject({ email: ana.email, phone: null, addresses: [] });
    expect(form!.cart).toEqual({ lines: [], dropped: 0 });
    // Nessun costo nel modulo.
    expect(JSON.stringify(form)).not.toContain('costMinor');
  });

  it('il carrello del cookie vale solo per i prodotti ordinabili di questa fioreria (M1)', async () => {
    const form = await getCheckoutForm(ana, shop.tenant.slug, {
      cart: [
        { itemId: rose.id, quantity: 3 },
        { itemId: hidden.id, quantity: 1 },
        { itemId: soldOut.id, quantity: 1 },
        // L'ID di un'altra fioreria (A↔B): non c'è.
        { itemId: foreign.id, quantity: 2 },
        { itemId: bouquet.id, quantity: 1 },
      ],
    });
    expect(form!.cart).toEqual({
      lines: [
        { itemId: rose.id, quantity: 3 },
        { itemId: bouquet.id, quantity: 1 },
      ],
      dropped: 3,
    });
  });
});

describe("invio dell'ordine", () => {
  let orderId: string;
  let trackingPath: string;

  it('prezzi e costo di consegna dal server; "Por aceptar"; cliente nel CRM; email', async () => {
    mailer.sent.length = 0;
    const placed = await placeMarketplaceOrder(
      ana,
      shop.tenant.slug,
      // Prezzi inviati dal browser: si ignorano.
      orderForm({ priceMinor: '1', deliveryFee: '0', totalMinor: '1', saveAddress: 'on' }),
      { fromSearch: true },
      deps,
    );
    orderId = placed.orderId;
    trackingPath = placed.trackingPath;
    expect(placed.trackingPath).toMatch(/^\/pedido\/[\w-]+$/);

    const order = await getOrder(shop.owner, orderId);
    expect(order).toMatchObject({
      status: 'PENDING_ACCEPTANCE',
      placedOnline: true,
      subtotalMinor: 69000 + 2 * 3500,
      deliveryFeeMinor: 8000,
      totalMinor: 69000 + 2 * 3500 + 8000,
      acquisitionSource: 'MARKETPLACE_B2C',
      windowStart: '09:00',
      windowEnd: '12:00',
      recipientName: 'Lucía',
      cardMessage: '¡Feliz cumpleaños!',
      canAccept: true,
    });
    expect(order.customer).toMatchObject({ email: ana.email, phone: '+524495550101' });
    expect(order.lines.map((line) => line.unitPriceMinor).sort()).toEqual([3500, 69000]);
    // Accettare non è un passo del banco.
    expect(order.nextSteps).not.toContain('CONFIRMED');

    // Email: chi compra e propietario + gerente (non lo staff).
    const recipients = mailer.sent.map((mail) => mail.to);
    expect(recipients).toContain(ana.email);
    expect(recipients).toContain(shop.tenant.owner.email);
    expect(recipients).toContain(shop.managerUser.email);
    expect(recipients).not.toContain(shop.staffUser.email);
    const received = mailer.lastTo(ana.email)!;
    expect(received.category).toBe('online_order_received');
    expect(received.fromName).toBe('Florería Pedidos');
    expect(received.text).toContain(trackingPath);
    expect(mailer.lastTo(shop.tenant.owner.email)!.text).toContain(`/orders/${orderId}`);

    // Il telefono e l'indirizzo restano nel conto di chi compra.
    const account = await openBuyerAccount(ana);
    expect(account.phone).toBe('+524495550101');
    expect(account.addresses.map((address) => address.addressLine1)).toEqual(['Av. Madero 120']);

    // La pagina di tracciamento: in attesa, con il modo di pagare.
    const tracking = await getPublicOrder(SECRET, trackingPath.split('/').pop());
    expect(tracking).toMatchObject({
      status: 'PENDING_ACCEPTANCE',
      online: { paymentMethods: ['TRANSFER', 'CASH'], cancelReason: null },
    });
  });

  it('la seconda volta lo stesso cliente del CRM; il link della fioreria porta MERCHANT_DIRECT', async () => {
    const saved = (await openBuyerAccount(ana)).addresses[0]!;
    const placed = await placeMarketplaceOrder(
      ana,
      shop.tenant.slug,
      orderForm({ buyerAddressId: saved.id, addressLine1: '', window: '', recipientName: '' }),
      { fromSearch: false },
      deps,
    );
    const first = await getOrder(shop.owner, orderId);
    const second = await getOrder(shop.owner, placed.orderId);
    expect(second.customer.id).toBe(first.customer.id);
    expect(second).toMatchObject({
      acquisitionSource: 'MERCHANT_DIRECT',
      windowStart: null,
      deliveryAddress: { addressLine1: 'Av. Madero 120' },
    });
  });

  it('un cliente che la fioreria aveva già non diventa "portato da Gardelia"', async () => {
    const own = await createCustomer(shop.owner, {
      type: 'PERSON',
      displayName: 'Carla (cliente de siempre)',
      legalName: null,
      taxId: null,
      email: carla.email.toUpperCase(),
      phone: null,
      notes: null,
      preferences: null,
      restrictions: null,
      tags: [],
      acquisitionChannel: null,
      marketingConsent: false,
    });
    const placed = await placeMarketplaceOrder(
      carla,
      shop.tenant.slug,
      orderForm({ fulfillmentMode: 'PICKUP', window: '' }),
      { fromSearch: true },
      deps,
    );
    const order = await getOrder(shop.owner, placed.orderId);
    expect(order.customer.id).toBe(own.id);
    expect(order).toMatchObject({
      acquisitionSource: 'MERCHANT_DIRECT',
      fulfillmentMode: 'PICKUP',
      deliveryFeeMinor: 0,
      deliveryAddress: null,
    });
    // Non aveva un telefono: arriva quello dell'ordine (M0), così la fioreria la può chiamare.
    expect(order.customer.phone).toBe('+524495550101');
  });

  it('il telefono che la fioreria aveva già salvato non si tocca (M0)', async () => {
    const diana = await buyer('Diana Compradora');
    const own = await createCustomer(shop.owner, {
      type: 'PERSON',
      displayName: 'Diana (con teléfono)',
      legalName: null,
      taxId: null,
      email: diana.email,
      phone: '+524495550177',
      notes: null,
      preferences: null,
      restrictions: null,
      tags: [],
      acquisitionChannel: 'walk_in',
      marketingConsent: false,
    });
    const placed = await placeMarketplaceOrder(
      diana,
      shop.tenant.slug,
      orderForm({ fulfillmentMode: 'PICKUP', window: '' }),
      { fromSearch: false },
      deps,
    );
    const order = await getOrder(shop.owner, placed.orderId);
    expect(order.customer).toMatchObject({ id: own.id, phone: '+524495550177' });
    expect((await getCustomer(shop.owner, own.id)).acquisitionChannel).toBe('walk_in');
  });

  it('il canale «Tienda en línea» resta quando la fioreria modifica il cliente (M0)', async () => {
    const { customer } = await getOrder(shop.owner, orderId);
    const before = await getCustomer(shop.owner, customer.id);
    expect(before.acquisitionChannel).toBe('online_store');
    // Gli stessi dati del modulo della scheda, con una nota in più.
    await updateCustomer(shop.owner, customer.id, {
      type: before.type,
      displayName: before.displayName,
      legalName: before.legalName,
      taxId: before.taxId,
      email: before.email,
      phone: before.phone,
      notes: 'Prefiere entregas por la mañana',
      preferences: before.preferences,
      restrictions: before.restrictions,
      tags: [...before.tags],
      acquisitionChannel: before.acquisitionChannel,
      marketingConsent: before.marketingConsent,
    });
    const after = await getCustomer(shop.owner, customer.id);
    expect(after).toMatchObject({
      acquisitionChannel: 'online_store',
      notes: 'Prefiere entregas por la mañana',
    });
  });

  it('il link di un ordine lontano vale fino a 30 giorni dopo la consegna (M0)', async () => {
    const elena = await buyer('Elena Compradora');
    const far = openDay(40);
    const placed = await placeMarketplaceOrder(
      elena,
      shop.tenant.slug,
      orderForm({ scheduledDate: toIsoDate(far), fulfillmentMode: 'PICKUP', window: '' }),
      { fromSearch: false },
      deps,
    );
    const link = await withTenantContext(db, shop.owner, (tx) =>
      tx.publicLink.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, orderId: placed.orderId },
        select: { createdAt: true, expiresAt: true },
      }),
    );
    // Il giorno di consegna è la mezzanotte UTC della data (come lo salva l'ordine).
    const delivery = new Date(Date.UTC(far.year, far.month - 1, far.day));
    expect(link.expiresAt).toEqual(orderLinkExpiry(link.createdAt, delivery));
    expect(link.expiresAt > publicLinkExpiry(link.createdAt)).toBe(true);

    // La fioreria sposta la consegna ancora più in là: il link la segue.
    const later = addDays(far, 30);
    await updateOrderFulfillment(shop.owner, placed.orderId, {
      fulfillmentMode: 'PICKUP',
      scheduledDate: toIsoDate(later),
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
    const moved = await withTenantContext(db, shop.owner, (tx) =>
      tx.publicLink.findFirstOrThrow({
        where: { tenantId: shop.owner.tenantId, orderId: placed.orderId },
        select: { expiresAt: true },
      }),
    );
    const laterDelivery = new Date(Date.UTC(later.year, later.month - 1, later.day));
    expect(moved.expiresAt.getTime()).toBeGreaterThanOrEqual(
      laterDelivery.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
  });

  it('giorno, fascia e prodotti seguono le regole della fioreria', async () => {
    const fail = (overrides: Record<string, unknown>) =>
      placeMarketplaceOrder(
        beto,
        shop.tenant.slug,
        orderForm(overrides),
        { fromSearch: false },
        deps,
      );
    const today = toIsoDate(todayInTimeZone('America/Mexico_City'));
    await expect(fail({ scheduledDate: today })).rejects.toMatchObject({
      fieldErrors: { scheduledDate: 'checkout_date_too_soon' },
    });
    await expect(fail({ scheduledDate: toIsoDate(nextSunday()) })).rejects.toMatchObject({
      fieldErrors: { scheduledDate: 'checkout_closed_day' },
    });
    await expect(fail({ window: '15:00-18:00' })).rejects.toMatchObject({
      fieldErrors: { window: 'invalid_option' },
    });
    for (const item of [hidden, soldOut, foreign]) {
      // Il messaggio generale e quello accanto al prodotto da togliere (M0).
      await expect(fail({ [`qty.${item.id}`]: '1' })).rejects.toMatchObject({
        fieldErrors: {
          lines: 'checkout_item_unavailable',
          [`qty.${item.id}`]: 'checkout_item_gone',
        },
      });
    }
    await expect(
      fail({ [`qty.${bouquet.id}`]: '0', [`qty.${rose.id}`]: '' }),
    ).rejects.toMatchObject({ fieldErrors: { lines: 'checkout_no_items' } });
    await expect(fail({ contactPhone: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(fail({ addressLine1: '' })).rejects.toBeInstanceOf(ValidationError);
  });

  it("l'indirizzo salvato di un'altra persona non si può usare", async () => {
    const { id } = await addBuyerAddress(carla, {
      addressLine1: 'Calle de Carla 1',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
    });
    await expect(
      placeMarketplaceOrder(
        beto,
        shop.tenant.slug,
        orderForm({ buyerAddressId: id }),
        {
          fromSearch: false,
        },
        deps,
      ),
    ).rejects.toMatchObject({ fieldErrors: { buyerAddressId: 'invalid_option' } });
  });

  it('al massimo 3 ordini in attesa per persona e fioreria', async () => {
    for (let index = 0; index < 3; index += 1) {
      await placeMarketplaceOrder(beto, shop.tenant.slug, orderForm(), { fromSearch: false }, deps);
    }
    await expect(
      placeMarketplaceOrder(beto, shop.tenant.slug, orderForm(), { fromSearch: false }, deps),
    ).rejects.toMatchObject({ reason: 'checkout_pending_limit' });
    expect((await getCheckoutForm(beto, shop.tenant.slug))!.pendingCount).toBe(3);
  });

  it('"Mis pedidos": ognuno vede solo i propri', async () => {
    const anaOrders = await listBuyerOrders(ana, SECRET);
    const betoOrders = await listBuyerOrders(beto, SECRET);
    expect(anaOrders).toHaveLength(2);
    expect(betoOrders).toHaveLength(3);
    expect(anaOrders.map((order) => order.orderId)).toContain(orderId);
    expect(betoOrders.map((order) => order.orderId)).not.toContain(orderId);
    expect(anaOrders.find((order) => order.orderId === orderId)).toMatchObject({
      shopSlug: shop.tenant.slug,
      shopName: 'Florería Pedidos',
      status: 'PENDING_ACCEPTANCE',
      currency: 'MXN',
      trackingPath,
    });
    expect((await listBuyerOrders(carla, SECRET)).map((order) => order.fulfillmentMode)).toEqual([
      'PICKUP',
    ]);
  });

  describe('la fioreria risponde', () => {
    it('"Aceptar pedido": confermato, email con il totale e come pagare', async () => {
      await expect(changeOrderStatus(shop.owner, orderId, 'CONFIRMED')).rejects.toMatchObject({
        reason: 'order_needs_acceptance',
      });
      await expect(acceptOnlineOrder(shop.staff, orderId, deps)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      // Un'altra fioreria non lo vede (404, mai 403).
      await expect(acceptOnlineOrder(other.owner, orderId, deps)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect((await getOrder(shop.staff, orderId)).canAccept).toBe(false);

      mailer.sent.length = 0;
      await acceptOnlineOrder(shop.manager, orderId, deps);
      expect((await getOrder(shop.owner, orderId)).status).toBe('CONFIRMED');
      const mail = mailer.lastTo(ana.email)!;
      expect(mail.category).toBe('online_order_accepted');
      expect(mail.text).toContain('Transferencia, Efectivo');
      expect(mail.text).toContain('CLABE 012 180');
      expect(mail.replyTo).toBe(`contacto-${shop.tenant.slug}@example.com`);
      await expect(acceptOnlineOrder(shop.owner, orderId, deps)).rejects.toMatchObject({
        reason: 'order_not_pending',
      });
    });

    it('"Rechazar": annullato con il motivo, che chi compra legge', async () => {
      const [pending] = (await listBuyerOrders(beto, SECRET)).filter(
        (order) => order.status === 'PENDING_ACCEPTANCE',
      );
      mailer.sent.length = 0;
      await cancelOrder(shop.owner, pending!.orderId, { reason: 'No tenemos girasoles' }, deps);
      const mail = mailer.lastTo(beto.email)!;
      expect(mail.category).toBe('online_order_cancelled');
      expect(mail.subject).toContain('no puede atender');
      expect(mail.text).toContain('No tenemos girasoles');
      const tracking = await getPublicOrder(SECRET, pending!.trackingPath!.split('/').pop());
      expect(tracking).toMatchObject({
        status: 'CANCELLED',
        online: { cancelReason: 'No tenemos girasoles' },
      });
      // Liberato un posto: Beto può ordinare di nuovo.
      expect((await getCheckoutForm(beto, shop.tenant.slug))!.pendingCount).toBe(2);
    });

    it('senza risposta in 3 giorni si annulla da solo (una sola volta)', async () => {
      const [pending] = (await listBuyerOrders(beto, SECRET)).filter(
        (order) => order.status === 'PENDING_ACCEPTANCE',
      );
      await withTenantContext(db, shop.owner, (tx) =>
        tx.order.updateMany({
          where: { tenantId: shop.owner.tenantId, id: pending!.orderId },
          data: { createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
        }),
      );
      mailer.sent.length = 0;
      expect(await expireUnacceptedOrders(deps)).toBeGreaterThanOrEqual(1);
      const expired = await getOrder(shop.owner, pending!.orderId);
      expect(expired.status).toBe('CANCELLED');
      expect(mailer.lastTo(beto.email)!.text).toContain('no confirmó a tiempo');
      // M3: anche proprietari e gerenti lo sanno, con il link all'ordine; lo staff no.
      const toShop = mailer.sent.filter(
        (m) =>
          m.category === 'online_order_expired_shop' && m.subject.includes(expired.numberLabel),
      );
      expect(toShop.map((m) => m.to).sort()).toEqual(
        [shop.tenant.owner.email, shop.managerUser.email].sort(),
      );
      expect(toShop[0]!.text).toContain('Beto Comprador');
      expect(toShop[0]!.text).toContain(`/orders/${pending!.orderId}`);
      // Il resto degli ordini in attesa di Beto è recente: resta com'è.
      const stillPending = (await listBuyerOrders(beto, SECRET)).filter(
        (order) => order.status === 'PENDING_ACCEPTANCE',
      );
      expect(stillPending).toHaveLength(1);
      mailer.sent.length = 0;
      await expireUnacceptedOrders(deps);
      expect(mailer.lastTo(beto.email)).toBeUndefined();
    });
  });
});

describe('«Aceptar pedido» con la consegna a 0 (M0)', () => {
  it('a domicilio senza costo si accetta solo confermando che è gratis', async () => {
    const fabi = await buyer('Fabiola Compradora');
    await updateDeliverySettings(shop.owner, { closedWeekdays: ['0'], defaultFee: '0' });
    try {
      const placed = await placeMarketplaceOrder(
        fabi,
        shop.tenant.slug,
        orderForm(),
        { fromSearch: false },
        deps,
      );
      expect(await getOrder(shop.owner, placed.orderId)).toMatchObject({
        fulfillmentMode: 'DELIVERY',
        deliveryFeeMinor: 0,
      });
      await expect(acceptOnlineOrder(shop.owner, placed.orderId, deps)).rejects.toMatchObject({
        reason: 'order_free_delivery_unconfirmed',
      });
      await expect(
        acceptOnlineOrder(shop.owner, placed.orderId, deps, { freeDeliveryConfirmed: '' }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect((await getOrder(shop.owner, placed.orderId)).status).toBe('PENDING_ACCEPTANCE');

      await acceptOnlineOrder(shop.owner, placed.orderId, deps, { freeDeliveryConfirmed: 'on' });
      expect((await getOrder(shop.owner, placed.orderId)).status).toBe('CONFIRMED');
      const audit = await withTenantContext(db, shop.owner, (tx) =>
        tx.auditLog.findFirstOrThrow({
          where: {
            tenantId: shop.owner.tenantId,
            entityId: placed.orderId,
            action: 'order.accepted',
          },
          select: { metadata: true },
        }),
      );
      expect(audit.metadata).toMatchObject({ freeDelivery: true });
    } finally {
      await updateDeliverySettings(shop.owner, { closedWeekdays: ['0'], defaultFee: '80' });
    }
  });
});

describe('errori', () => {
  it('tienda non pubblicata o slug inventato: non esiste', async () => {
    await expect(
      placeMarketplaceOrder(ana, 'tienda-inventada', orderForm(), { fromSearch: false }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(ConflictError).toBeDefined();
  });
});
