import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  addDays,
  dayOfWeek,
  formatMoney,
  parseCsv,
  toIsoDate,
  todayInTimeZone,
  type CalendarDate,
} from '@floral/domain';
import {
  ForbiddenError,
  MemoryMailer,
  MemoryStorage,
  NotFoundError,
  ValidationError,
  acceptOnlineOrder,
  addDeliveryWindow,
  askOrderChange,
  assignOrder,
  cancelOrder,
  confirmOrderCashCollection,
  confirmPaymentProof,
  countPendingOnlineOrders,
  createCatalogItem,
  exportBuyerData,
  exportTenantData,
  getBuyerOrder,
  getBuyerPaymentProofPhoto,
  getCheckoutForm,
  getDayPrintout,
  getDeliveryRoute,
  getOnlineStoreSettings,
  getOrder,
  getOrderInbox,
  getOrderMoney,
  getPaymentProofImage,
  getPublicStore,
  listOrders,
  placeMarketplaceOrder,
  purgeOrderPaymentProofPhotos,
  recordOrderPayment,
  refundOrderPayment,
  rejectOrderCashCollection,
  rejectPaymentProof,
  reverseOrderPayment,
  setObjectStorage,
  setOnlineStorePublished,
  submitBuyerPaymentProof,
  submitOrderCashCollection,
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
 * Marketplace M3-3 «Soldi e squadra» (ADR-088): i dati per pagare solo a ordine accettato, le prove
 * di pagamento di chi compra (conferma = pagamento, rifiuto con il motivo, foto privata e cancellata
 * dopo 30 giorni), l'email del pagamento registrato, il rimborso su un ordine annullato, lo storno
 * che non porta il pagato sotto zero, i contanti di chi consegna, lo staff che accetta con
 * l'impostazione, l'avviso a chi consegna, la stampa del giorno, «Da gestire», le esportazioni e
 * l'isolamento fra fiorerie e fra persone.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const APP = 'http://localhost:3000';
const SECRET = 'segreto-di-prova-per-i-link-pubblici-0123456789';
const DAY = 24 * 60 * 60 * 1000;
const CLABE = 'CLABE 012 180 0000 0000 0000';
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
const mxn = (minor: number) => formatMoney(minor, 'MXN', 'es-MX');

let shop: TestShop;
let other: TestShop;
let bouquet: CatalogItemDto;
let foreignBouquet: CatalogItemDto;

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

function orderForm(item: CatalogItemDto, day: CalendarDate, card = '') {
  return {
    [`qty.${item.id}`]: '2',
    fulfillmentMode: 'DELIVERY',
    scheduledDate: toIsoDate(day),
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
    cardMessage: card,
    cardSignature: card ? 'Ana' : '',
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
    paymentMethods: ['TRANSFER', 'CASH'],
    paymentInstructions: CLABE,
  });
  await updateOnlineOrderSettings(target.owner, { ordersEnabled: 'on', minLeadDays: '1' });
}

/** Una persona nuova: ognuna ha al massimo 3 ordini da accettare per fioreria. */
async function buyer(name: string): Promise<BuyerContext & { email: string }> {
  const user = await createTestUser(db, { name });
  return { userId: user.id, country: 'MX', email: user.email };
}

/** Un ordine online (2 ramos da $500 + $80 di consegna = $1,080) per il giorno `day`. */
async function place(
  who: BuyerContext,
  options: { readonly day?: CalendarDate; readonly card?: string } = {},
): Promise<string> {
  const placed = await placeMarketplaceOrder(
    who,
    shop.tenant.slug,
    orderForm(bouquet, options.day ?? openDay(3), options.card ?? ''),
    { fromSearch: false },
    deps,
  );
  return placed.orderId;
}

/** Un ordine online già accettato dalla fioreria. */
async function accepted(
  who: BuyerContext,
  options: { readonly day?: CalendarDate; readonly card?: string } = {},
): Promise<string> {
  const orderId = await place(who, options);
  await acceptOnlineOrder(shop.owner, orderId, deps);
  drain();
  return orderId;
}

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: '#2f5d8a' } })
      .jpeg()
      .toBuffer(),
  );
}

/** Le email mandate fin qui (e svuota la casella). */
function drain() {
  return mailer.sent.splice(0);
}

async function auditOf(orderId: string, action: string) {
  return withSystemContext(db, { reason: 'test: registro dei soldi' }, (tx) =>
    tx.auditLog.findMany({ where: { entityId: orderId, action }, orderBy: { createdAt: 'asc' } }),
  );
}

async function crossTenantEvents(entityId: string) {
  const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
    tx.auditLog.findMany({ where: { tenantId: null, entityId } }),
  );
  return events.filter((event) => event.action === 'security.cross_tenant_access_attempt');
}

/** Sposta indietro le date di un ordine (come se fosse passato del tempo). */
async function backdate(orderId: string, data: { statusChangedAt: Date }): Promise<void> {
  await withTenantContext(db, shop.owner, (tx) =>
    tx.order.updateMany({ where: { tenantId: shop.owner.tenantId, id: orderId }, data }),
  );
}

/** La prova di pagamento di chi compra, con la foto. */
async function proof(who: BuyerContext, orderId: string, amount: string, note = '') {
  return submitBuyerPaymentProof(
    who,
    orderId,
    { amount, note, submitKey: key() },
    await jpeg(),
    deps,
  );
}

/** «Confermo» come lo propone la pagina: Bonifico, «Comprobante del cliente». */
function confirmForm(amount: string) {
  return {
    amount,
    method: 'TRANSFER',
    kind: 'BALANCE',
    paidOn: '',
    reference: 'Comprobante del cliente',
  };
}

beforeAll(async () => {
  setObjectStorage(storage);
  shop = await createTestShop('Florería Dinero');
  other = await createTestShop('Florería Dinero Ajena');
  await openShop(shop, 'Florería Dinero');
  await openShop(other, 'Florería Dinero Ajena');
  const bouquetInput = {
    type: 'BOUQUET',
    saleUnit: 'PIECE',
    canonicalFlowerId: null,
    variety: null,
    isOnline: true,
  };
  bouquet = await createCatalogItem(
    shop.owner,
    itemInput({ ...bouquetInput, name: 'Ramo Dinero', priceMinor: 50000 }),
  );
  foreignBouquet = await createCatalogItem(
    other.owner,
    itemInput({ ...bouquetInput, name: 'Ramo Ajeno', priceMinor: 40000 }),
  );
  await setOnlineStorePublished(shop.owner, true);
  await setOnlineStorePublished(other.owner, true);
  drain();
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('i dati per pagare solo a ordine accettato', () => {
  it('mai nella vetrina né nel modulo; nel pedido e nell’email solo dopo «Accetta»', async () => {
    const store = await getPublicStore(shop.tenant.slug);
    expect(store?.paymentMethods).toEqual(['TRANSFER', 'CASH']);
    expect(store).not.toHaveProperty('paymentInstructions');
    expect(JSON.stringify(store)).not.toContain('CLABE');

    const who = await buyer('Cliente Datos');
    const form = await getCheckoutForm(who, shop.tenant.slug);
    expect(form?.store.paymentMethods).toEqual(['TRANSFER', 'CASH']);
    expect(JSON.stringify(form)).not.toContain('CLABE');

    const orderId = await place(who);
    const pending = await getBuyerOrder(who, orderId, { secret: SECRET });
    expect(pending.order.online?.paymentInstructions).toBeNull();
    expect(JSON.stringify(pending)).not.toContain('CLABE');
    // La conferma dell'invio non dice ancora come pagare.
    expect(drain().every((mail) => !mail.text.includes('CLABE'))).toBe(true);

    await acceptOnlineOrder(shop.owner, orderId, deps);
    const acceptedMail = drain().find((mail) => mail.to === who.email);
    expect(acceptedMail?.text).toContain(CLABE);
    const confirmed = await getBuyerOrder(who, orderId, { secret: SECRET });
    expect(confirmed.order.online?.paymentInstructions).toBe(CLABE);

    await cancelOrder(shop.owner, orderId, { reason: 'Prueba de los datos' }, deps);
    drain();
    const cancelled = await getBuyerOrder(who, orderId, { secret: SECRET });
    expect(cancelled.order.online?.paymentInstructions).toBeNull();
  });
});

describe('«Registramos tu pago»', () => {
  it('ogni pagamento registrato su un ordine online avvisa chi compra; lo storno no', async () => {
    const who = await buyer('Cliente Pago');
    const orderId = await accepted(who);
    await recordOrderPayment(
      shop.owner,
      orderId,
      { amount: '300', method: 'CASH', kind: 'DEPOSIT', paidOn: '' },
      deps,
    );
    const [mail, ...rest] = drain();
    expect(rest).toEqual([]);
    expect(mail).toMatchObject({
      to: who.email,
      category: 'online_order_payment',
      subject: expect.stringMatching(/^Registramos tu pago de \$300\.00 del pedido PED-\d{4}$/),
    });
    expect(mail!.text).toContain(`Pagado: ${mxn(30000)}. Por pagar: ${mxn(78000)}.`);
    expect(mail!.text).toContain('no es un comprobante fiscal');
    expect(mail!.text).toContain(`${APP}/cuenta/pedidos/${orderId}#pagos`);

    const payment = (await getOrder(shop.owner, orderId)).payments[0]!;
    await reverseOrderPayment(shop.owner, orderId, payment.id);
    expect(drain()).toEqual([]);
  });
});

describe('prove di pagamento di chi compra', () => {
  it('solo dopo l’accettazione, con la foto e fino a quanto manca', async () => {
    const who = await buyer('Cliente Comprobante');
    const orderId = await place(who);
    await expect(proof(who, orderId, '1080')).rejects.toMatchObject({
      reason: 'order_not_payable',
    });
    expect((await getBuyerOrder(who, orderId, { secret: SECRET })).money.canSubmitProof).toBe(
      false,
    );
    await acceptOnlineOrder(shop.owner, orderId, deps);
    drain();
    expect((await getBuyerOrder(who, orderId, { secret: SECRET })).money).toMatchObject({
      canSubmitProof: true,
      proofs: [],
      pendingProofs: 0,
      refundedMinor: 0,
    });

    await expect(
      submitBuyerPaymentProof(who, orderId, { amount: '100', submitKey: key() }, null, deps),
    ).rejects.toMatchObject({ fieldErrors: { photo: 'file_required' } });
    await expect(proof(who, orderId, '1080.01')).rejects.toMatchObject({
      fieldErrors: { amount: 'payment_exceeds_balance' },
    });
    await expect(
      submitBuyerPaymentProof(who, orderId, { amount: 'mil', submitKey: key() }, null, deps),
    ).rejects.toMatchObject({
      fieldErrors: { amount: expect.any(String), photo: 'file_required' },
    });
    expect(drain()).toEqual([]);
  });

  it('la prova arriva alla fioreria; «Confermo» la fa diventare un pagamento', async () => {
    const who = await buyer('Cliente Transferencia');
    const orderId = await accepted(who);
    const submitKey = key();
    const sent = await submitBuyerPaymentProof(
      who,
      orderId,
      { amount: '1080', note: 'SPEI desde BBVA', submitKey },
      await jpeg(),
      deps,
    );
    expect(sent.duplicate).toBe(false);
    // Lo stesso invio (doppio clic) non scrive una seconda prova e non lascia file.
    const files = [...storage.objects.keys()].filter((name) =>
      name.includes(`/order-payment-proofs/${orderId}-`),
    );
    expect(files).toHaveLength(2);
    const again = await submitBuyerPaymentProof(
      who,
      orderId,
      { amount: '1080', note: 'SPEI desde BBVA', submitKey },
      await jpeg(),
      deps,
    );
    expect(again).toEqual({ id: sent.id, duplicate: true });
    expect(
      [...storage.objects.keys()].filter((name) =>
        name.includes(`/order-payment-proofs/${orderId}-`),
      ),
    ).toEqual(files);

    const shopMails = drain();
    expect(shopMails.length).toBeGreaterThan(0);
    for (const mail of shopMails) {
      expect(mail.category).toBe('online_order_proof_received');
      expect(mail.subject).toMatch(/^Comprobante de pago del pedido PED-\d{4}$/);
      expect(mail.text).not.toContain('SPEI desde BBVA');
      expect(mail.text).toContain(`${APP}/app/${shop.tenant.slug}/orders/${orderId}#pagos`);
    }
    expect(shopMails.map((mail) => mail.to)).not.toContain(shop.staffUser.email);

    // Il registro: chi compra come autore, l'importo, mai la nota.
    const [submitted] = await auditOf(orderId, 'order.payment_proof_submitted');
    expect(submitted).toMatchObject({ actorUserId: who.userId });
    expect(submitted!.metadata).toMatchObject({ amountMinor: 108000 });
    expect(JSON.stringify(submitted!.metadata)).not.toContain('BBVA');

    // La vede chi gestisce i soldi; lo staff no (contiene dati bancari).
    const money = await getOrderMoney(shop.owner, orderId);
    expect(money).toMatchObject({ canReview: true, canConfirm: true, balanceMinor: 108000 });
    expect(money.proofs).toEqual([
      expect.objectContaining({
        id: sent.id,
        status: 'PENDING',
        amountMinor: 108000,
        note: 'SPEI desde BBVA',
        buyerName: 'Cliente Transferencia',
        photo: { width: 640, height: 480 },
      }),
    ]);
    const staffView = await getOrderMoney(shop.staff, orderId);
    expect(staffView).toMatchObject({ proofs: [], canReview: false, canConfirm: false });
    const image = await getPaymentProofImage(shop.manager, orderId, sent.id, 'thumb');
    expect(image.contentType).toBe('image/jpeg');
    await expect(getPaymentProofImage(shop.staff, orderId, sent.id, 'full')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await getBuyerPaymentProofPhoto(who, orderId, sent.id, 'full')).not.toBeNull();

    // «Da gestire» e il filtro dell'elenco, solo per chi gestisce i soldi.
    expect((await getOrderInbox(shop.owner)).pendingProofs).toBeGreaterThanOrEqual(1);
    expect((await getOrderInbox(shop.staff)).pendingProofs).toBe(0);
    const filtered = await listOrders(shop.owner, { when: 'all', money: 'proofs' });
    expect(filtered.moneyFilter).toBe('proofs');
    expect(filtered.items.map((item) => item.id)).toContain(orderId);
    expect(filtered.pendingProofOrdersCount).toBeGreaterThanOrEqual(1);
    expect((await listOrders(shop.staff, { when: 'all' })).pendingProofOrdersCount).toBe(0);

    // Lo staff non conferma; il proprietario sì, fino a quanto manca.
    await expect(
      confirmPaymentProof(shop.staff, orderId, sent.id, confirmForm('1080'), deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      confirmPaymentProof(shop.owner, orderId, sent.id, confirmForm('1100'), deps),
    ).rejects.toMatchObject({ fieldErrors: { amount: 'payment_exceeds_balance' } });
    const { paymentId } = await confirmPaymentProof(
      shop.owner,
      orderId,
      sent.id,
      confirmForm('1080'),
      deps,
    );
    const order = await getOrder(shop.owner, orderId);
    expect(order).toMatchObject({ paidMinor: 108000, balanceMinor: 0, paymentStatus: 'PAID' });
    expect(order.payments).toEqual([
      expect.objectContaining({
        id: paymentId,
        kind: 'BALANCE',
        method: 'TRANSFER',
        amountMinor: 108000,
        reference: 'Comprobante del cliente',
      }),
    ]);
    const [buyerMail] = drain();
    expect(buyerMail).toMatchObject({
      to: who.email,
      subject: expect.stringMatching(/^Registramos tu pago de \$1,080\.00 del pedido/),
    });
    // Una volta sola: una seconda conferma (doppio clic) non crea un altro pagamento.
    await expect(
      confirmPaymentProof(shop.owner, orderId, sent.id, confirmForm('1'), deps),
    ).rejects.toMatchObject({ reason: 'money_already_reviewed' });
    expect((await getOrder(shop.owner, orderId)).payments).toHaveLength(1);

    const view = await getBuyerOrder(who, orderId, { secret: SECRET });
    expect(view.money).toMatchObject({ canSubmitProof: false, pendingProofs: 0 });
    expect(view.money.proofs).toEqual([
      expect.objectContaining({ id: sent.id, status: 'CONFIRMED', hasPhoto: true }),
    ]);
    const [confirmedAudit] = await auditOf(orderId, 'order.payment_proof_confirmed');
    expect(confirmedAudit!.metadata).toMatchObject({
      amountMinor: 108000,
      proofAmountMinor: 108000,
      method: 'TRANSFER',
    });
  });

  it('«Non lo trovo» con il motivo, per email; al massimo 3 in attesa', async () => {
    const who = await buyer('Cliente Rechazo');
    const orderId = await accepted(who);
    const first = await proof(who, orderId, '500');
    await proof(who, orderId, '200');
    await proof(who, orderId, '100');
    await expect(proof(who, orderId, '50')).rejects.toMatchObject({
      reason: 'payment_proofs_pending_limit',
    });
    expect((await getBuyerOrder(who, orderId, { secret: SECRET })).money).toMatchObject({
      pendingProofs: 3,
      canSubmitProof: false,
    });
    drain();

    await expect(
      rejectPaymentProof(shop.owner, orderId, first.id, { reason: ' ' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await rejectPaymentProof(
      shop.manager,
      orderId,
      first.id,
      { reason: 'No aparece en el banco' },
      deps,
    );
    const [mail, ...rest] = drain();
    expect(rest).toEqual([]);
    expect(mail).toMatchObject({
      to: who.email,
      category: 'online_order_proof_rejected',
      subject: expect.stringMatching(/^No encontramos tu pago del pedido PED-\d{4}$/),
    });
    expect(mail!.text).toContain('No aparece en el banco');
    const [rejected] = await auditOf(orderId, 'order.payment_proof_rejected');
    expect(JSON.stringify(rejected!.metadata)).not.toContain('banco');
    await expect(
      rejectPaymentProof(shop.owner, orderId, first.id, { reason: 'Otra vez' }, deps),
    ).rejects.toMatchObject({ reason: 'money_already_reviewed' });

    // Con una in meno in attesa se ne può caricare un'altra.
    const view = await getBuyerOrder(who, orderId, { secret: SECRET });
    expect(view.money).toMatchObject({ pendingProofs: 2, canSubmitProof: true });
    expect(view.money.proofs.find((item) => item.id === first.id)).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'No aparece en el banco',
    });
    expect((await getOrder(shop.owner, orderId)).paidMinor).toBe(0);
  });

  it('isolamento: un’altra fioreria e un’altra persona rispondono 404', async () => {
    const who = await buyer('Cliente Aislado');
    const orderId = await accepted(who);
    const sent = await proof(who, orderId, '100');
    drain();

    // La persona sbagliata: 404 come un ordine che non c'è, senza la sonda fra fiorerie.
    const stranger = await buyer('Cliente Extraño');
    await expect(proof(stranger, orderId, '100')).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getBuyerPaymentProofPhoto(stranger, orderId, sent.id, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);

    // L'altra fioreria con l'ordine di questa: 404 e l'evento di sicurezza.
    await expect(
      confirmPaymentProof(other.owner, orderId, sent.id, confirmForm('100'), deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await crossTenantEvents(orderId)).not.toHaveLength(0);
    // …con un suo ordine e la prova di questa: 404 e l'evento sulla prova.
    const theirs = await placeMarketplaceOrder(
      await buyer('Cliente Ajeno'),
      other.tenant.slug,
      orderForm(foreignBouquet, openDay(3)),
      { fromSearch: false },
      deps,
    );
    await expect(
      rejectPaymentProof(other.owner, theirs.orderId, sent.id, { reason: 'No' }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getPaymentProofImage(other.owner, orderId, sent.id, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await crossTenantEvents(sent.id)).not.toHaveLength(0);
    const untouched = await getOrderMoney(shop.owner, orderId);
    expect(untouched.proofs[0]).toMatchObject({ id: sent.id, status: 'PENDING' });
    drain();
  });

  it('le foto delle prove si cancellano 30 giorni dopo la chiusura; la prova resta', async () => {
    const who = await buyer('Cliente Foto');
    const orderId = await accepted(who);
    const sent = await proof(who, orderId, '400');
    await cancelOrder(shop.owner, orderId, { reason: 'Prueba de fotos' }, deps);
    drain();
    const keeper = await buyer('Cliente Foto Abierta');
    const stillOpen = await accepted(keeper);
    const kept = await proof(keeper, stillOpen, '400');
    await backdate(orderId, { statusChangedAt: new Date(Date.now() - 31 * DAY) });
    drain();

    expect(await purgeOrderPaymentProofPhotos()).toBeGreaterThan(0);
    const rows = await withTenantContext(db, shop.owner, (tx) =>
      tx.orderPaymentProof.findMany({
        where: { tenantId: shop.owner.tenantId, id: { in: [sent.id, kept.id] } },
        select: { id: true, status: true, photoKey: true, photoDeletedAt: true },
      }),
    );
    const purged = rows.find((row) => row.id === sent.id)!;
    expect(purged).toMatchObject({ status: 'PENDING', photoDeletedAt: expect.any(Date) });
    expect(storage.objects.has(purged.photoKey)).toBe(false);
    expect(await getBuyerPaymentProofPhoto(who, orderId, sent.id, 'full')).toBeNull();
    await expect(getPaymentProofImage(shop.owner, orderId, sent.id, 'full')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getOrderMoney(shop.owner, orderId)).proofs[0]?.photo).toBeNull();
    // L'ordine ancora aperto tiene la sua foto.
    const open = rows.find((row) => row.id === kept.id)!;
    expect(open.photoDeletedAt).toBeNull();
    expect(storage.objects.has(open.photoKey)).toBe(true);
    // Su un ordine annullato una prova in attesa non si conferma più.
    await expect(
      confirmPaymentProof(shop.owner, orderId, sent.id, confirmForm('400'), deps),
    ).rejects.toMatchObject({ reason: 'order_closed' });
    drain();
  });
});

describe('rimborso e storno', () => {
  it('rimborso solo su un ordine annullato, fino al pagato, con l’email', async () => {
    const who = await buyer('Cliente Reembolso');
    const orderId = await accepted(who);
    await recordOrderPayment(
      shop.owner,
      orderId,
      { amount: '500', method: 'TRANSFER', kind: 'DEPOSIT', paidOn: '' },
      deps,
    );
    drain();
    const refund = { amount: '200', method: 'TRANSFER', paidOn: '', reference: 'SPEI 991' };
    await expect(refundOrderPayment(shop.owner, orderId, refund, deps)).rejects.toMatchObject({
      reason: 'refund_not_cancelled',
    });
    expect((await getOrder(shop.owner, orderId)).canRefund).toBe(false);

    await cancelOrder(shop.owner, orderId, { reason: 'Sin flores para esa fecha' }, deps);
    drain();
    expect(await getOrder(shop.owner, orderId)).toMatchObject({
      canRefund: true,
      paidMinor: 50000,
    });
    await expect(refundOrderPayment(shop.staff, orderId, refund, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      refundOrderPayment(shop.owner, orderId, { ...refund, amount: '500.01' }, deps),
    ).rejects.toMatchObject({ fieldErrors: { amount: 'refund_exceeds_paid' } });

    await refundOrderPayment(shop.owner, orderId, refund, deps);
    const [mail, ...rest] = drain();
    expect(rest).toEqual([]);
    expect(mail).toMatchObject({
      to: who.email,
      category: 'online_order_refund',
      subject: expect.stringMatching(/^Te reembolsamos \$200\.00 del pedido PED-\d{4}$/),
    });
    let order = await getOrder(shop.owner, orderId);
    expect(order).toMatchObject({ paidMinor: 30000, refundedMinor: 20000, canRefund: true });
    const refundRow = order.payments.find((payment) => payment.kind === 'REFUND')!;
    expect(refundRow).toMatchObject({ amountMinor: -20000, reversed: true, reference: 'SPEI 991' });
    // Un rimborso non si storna.
    await expect(reverseOrderPayment(shop.owner, orderId, refundRow.id)).rejects.toMatchObject({
      reason: 'payment_not_reversible',
    });

    await refundOrderPayment(shop.owner, orderId, { ...refund, amount: '300' }, deps);
    drain();
    order = await getOrder(shop.owner, orderId);
    expect(order).toMatchObject({ paidMinor: 0, refundedMinor: 50000, canRefund: false });
    await expect(refundOrderPayment(shop.owner, orderId, refund, deps)).rejects.toMatchObject({
      reason: 'refund_nothing_paid',
    });
    // Stornare l'acconto già rimborsato porterebbe il pagato sotto zero.
    const deposit = order.payments.find((payment) => payment.kind === 'DEPOSIT')!;
    await expect(reverseOrderPayment(shop.owner, orderId, deposit.id)).rejects.toMatchObject({
      reason: 'reversal_below_zero',
    });
    expect((await getBuyerOrder(who, orderId, { secret: SECRET })).money.refundedMinor).toBe(50000);
    const [audit] = await auditOf(orderId, 'order.payment_refunded');
    expect(audit!.metadata).toMatchObject({ amountMinor: 20000, method: 'TRANSFER' });

    // L'altra fioreria: 404 con l'evento.
    await expect(refundOrderPayment(other.owner, orderId, refund, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // `pagos.csv`: il rimborso col suo segno.
    const zip = unzipSync((await exportTenantData(shop.owner)).bytes);
    const payments = parseCsv(strFromU8(zip['pagos.csv']!).replace(/^\uFEFF/, ''));
    const header = payments[0]!;
    const refunds = payments.filter((row) => row[header.indexOf('Tipo')] === 'Reembolso');
    expect(refunds.map((row) => row[header.indexOf('Importe')])).toEqual(
      expect.arrayContaining(['-200.00', '-300.00']),
    );
  });
});

describe('contanti di chi consegna', () => {
  it('lo staff li segna; il proprietario conferma fino a quanto segnato', async () => {
    const who = await buyer('Cliente Efectivo');
    const pendingId = await place(who);
    const cash = (amount: string, submitKey = key()) => ({ amount, note: '', submitKey });
    await expect(
      submitOrderCashCollection(shop.staff, pendingId, cash('100')),
    ).rejects.toMatchObject({ reason: 'order_not_payable' });

    const orderId = await accepted(who);
    await expect(
      submitOrderCashCollection(shop.staff, orderId, cash('1080.50')),
    ).rejects.toMatchObject({ fieldErrors: { amount: 'payment_exceeds_balance' } });
    const submitKey = key();
    const first = await submitOrderCashCollection(shop.staff, orderId, {
      amount: '1080',
      note: 'Me pagó con billete de 500',
      submitKey,
    });
    expect(first.duplicate).toBe(false);
    expect(await submitOrderCashCollection(shop.staff, orderId, cash('1080', submitKey))).toEqual({
      id: first.id,
      duplicate: true,
    });
    await expect(
      submitOrderCashCollection(shop.manager, orderId, cash('100')),
    ).rejects.toMatchObject({ reason: 'cash_collection_pending' });

    const staffView = await getOrderMoney(shop.staff, orderId);
    expect(staffView).toMatchObject({ canCollectCash: false, canReview: false });
    expect(staffView.cash).toEqual([
      expect.objectContaining({ id: first.id, status: 'PENDING', amountMinor: 108000, mine: true }),
    ]);
    expect((await getOrderMoney(shop.owner, orderId)).cash[0]).toMatchObject({ mine: false });
    expect((await getOrderInbox(shop.owner)).pendingCash).toBeGreaterThanOrEqual(1);
    expect((await getOrderInbox(shop.staff)).pendingCash).toBe(0);
    expect(
      (await listOrders(shop.owner, { when: 'all', money: 'cash' })).items.map((item) => item.id),
    ).toContain(orderId);

    await expect(
      confirmOrderCashCollection(shop.staff, orderId, first.id, { amount: '1080' }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      confirmOrderCashCollection(shop.owner, orderId, first.id, { amount: '1081' }, deps),
    ).rejects.toMatchObject({ fieldErrors: { amount: 'cash_exceeds_collected' } });
    drain();
    const { paymentId } = await confirmOrderCashCollection(
      shop.owner,
      orderId,
      first.id,
      { amount: '1000', reference: 'Caja del día' },
      deps,
    );
    const order = await getOrder(shop.owner, orderId);
    expect(order).toMatchObject({ paidMinor: 100000, balanceMinor: 8000 });
    expect(order.payments).toEqual([
      expect.objectContaining({
        id: paymentId,
        kind: 'BALANCE',
        method: 'CASH',
        amountMinor: 100000,
        paidOn: toIsoDate(todayInTimeZone(TZ)),
        reference: 'Caja del día',
      }),
    ]);
    expect(drain()).toEqual([
      expect.objectContaining({
        to: who.email,
        subject: expect.stringMatching(/^Registramos tu pago de \$1,000\.00/),
      }),
    ]);
    expect((await getOrderMoney(shop.owner, orderId)).cash[0]).toMatchObject({
      status: 'CONFIRMED',
      amountMinor: 108000,
      confirmedMinor: 100000,
    });
    await expect(
      confirmOrderCashCollection(shop.owner, orderId, first.id, { amount: '1' }, deps),
    ).rejects.toMatchObject({ reason: 'money_already_reviewed' });
    const [audit] = await auditOf(orderId, 'order.cash_confirmed');
    expect(audit!.metadata).toMatchObject({ amountMinor: 100000, collectedMinor: 108000 });

    // Un'altra volta, rifiutati con il motivo (mai nel registro).
    const second = await submitOrderCashCollection(shop.staff, orderId, cash('80'));
    await rejectOrderCashCollection(shop.owner, orderId, second.id, {
      reason: 'No llegó a la caja',
    });
    const money = await getOrderMoney(shop.staff, orderId);
    expect(money.cash.find((row) => row.id === second.id)).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'No llegó a la caja',
    });
    expect(money.canCollectCash).toBe(true);
    // Proprietario e gerente registrano il pagamento direttamente: niente «Ho incassato».
    expect((await getOrderMoney(shop.owner, orderId)).canCollectCash).toBe(false);
    const [rejected] = await auditOf(orderId, 'order.cash_rejected');
    expect(JSON.stringify(rejected!.metadata)).not.toContain('caja');

    // L'altra fioreria: 404 con l'evento sui contanti.
    await expect(
      rejectOrderCashCollection(other.owner, orderId, second.id, { reason: 'No' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      submitOrderCashCollection(other.staff, orderId, cash('10')),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await crossTenantEvents(orderId)).not.toHaveLength(0);
  });

  it('«Le mie consegne» mostra cosa incassare e i contanti già segnati', async () => {
    const day = openDay(6);
    const who = await buyer('Cliente Ruta');
    const orderId = await accepted(who, { day });
    await assignOrder(shop.owner, orderId, shop.staff.membershipId, deps);
    drain();
    let route = await getDeliveryRoute(shop.staff, toIsoDate(day), { mine: true });
    expect(route.stops.find((stop) => stop.id === orderId)).toMatchObject({
      balanceMinor: 108000,
      pendingCashMinor: null,
      canCollectCash: true,
    });
    await submitOrderCashCollection(shop.staff, orderId, {
      amount: '1080',
      note: '',
      submitKey: key(),
    });
    route = await getDeliveryRoute(shop.staff, toIsoDate(day), { mine: true });
    expect(route.stops.find((stop) => stop.id === orderId)).toMatchObject({
      pendingCashMinor: 108000,
      canCollectCash: false,
    });
  });
});

describe('squadra', () => {
  it('l’avviso a chi riceve la consegna, non a chi la prende per sé', async () => {
    const orderId = await accepted(await buyer('Cliente Asignado'));
    await assignOrder(shop.owner, orderId, shop.staff.membershipId, deps);
    const [mail, ...rest] = drain();
    expect(rest).toEqual([]);
    expect(mail).toMatchObject({
      to: shop.staffUser.email,
      category: 'order_assigned',
      subject: expect.stringMatching(/^Te asignaron la entrega del pedido PED-\d{4} para el /),
    });
    expect(mail!.text).toContain('Centro, Aguascalientes');
    expect(mail!.text).not.toContain('Av. Madero');
    // Di nuovo alla stessa persona: niente; a sé stessi: niente.
    await assignOrder(shop.owner, orderId, shop.staff.membershipId, deps);
    await assignOrder(shop.owner, orderId, shop.owner.membershipId, deps);
    expect(drain()).toEqual([]);
  });

  it('lo staff accetta e rifiuta gli ordini online solo con l’impostazione', async () => {
    const who = await buyer('Cliente Personal');
    const first = await place(who);
    const second = await place(who);
    drain();
    expect(await getOrder(shop.staff, first)).toMatchObject({
      canAccept: false,
      editable: false,
      linesEditable: false,
      canCancel: false,
      canProposeDate: false,
    });
    expect(await countPendingOnlineOrders(shop.staff)).toBe(0);
    await expect(acceptOnlineOrder(shop.staff, first, deps)).rejects.toBeInstanceOf(ForbiddenError);
    const line = (await getOrder(shop.owner, first)).lines[0]!;
    await expect(updateOrderLineQuantity(shop.staff, first, line.id, '3')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      cancelOrder(shop.staff, first, { reason: 'No hay flores' }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(askOrderChange(shop.staff, first, {}, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Il proprietario la accende: cambia l'impostazione con il registro.
    await updateOnlineOrderSettings(shop.owner, {
      ordersEnabled: 'on',
      minLeadDays: '1',
      staffCanAccept: 'on',
    });
    try {
      expect((await getOnlineStoreSettings(shop.owner)).staffCanAccept).toBe(true);
      const [setting] = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
        tx.auditLog.findMany({
          where: { tenantId: shop.owner.tenantId, action: 'store.orders_updated' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        }),
      );
      expect(setting!.metadata).toMatchObject({
        changes: { staffCanAccept: { from: false, to: true } },
      });
      expect(await countPendingOnlineOrders(shop.staff)).toBeGreaterThanOrEqual(2);
      expect(await getOrder(shop.staff, first)).toMatchObject({
        canAccept: true,
        editable: true,
        linesEditable: true,
        canCancel: true,
        canProposeDate: true,
        canRecordPayments: false,
      });
      await updateOrderLineQuantity(shop.staff, first, line.id, '3');
      await updateOrderLineQuantity(shop.staff, first, line.id, '2');
      await acceptOnlineOrder(shop.staff, first, deps);
      expect((await getOrder(shop.owner, first)).status).toBe('CONFIRMED');
      await cancelOrder(shop.staff, second, { reason: 'No llegamos a esa zona' }, deps);
      expect((await getOrder(shop.owner, second)).status).toBe('CANCELLED');

      // Dopo l'accettazione l'ordine è di proprietario e gerente, come gli altri.
      expect(await getOrder(shop.staff, first)).toMatchObject({
        editable: false,
        linesEditable: false,
        canCancel: false,
      });
      await expect(updateOrderLineQuantity(shop.staff, first, line.id, '3')).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        cancelOrder(shop.staff, first, { reason: 'Cambio de planes' }, deps),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        updateOrderFulfillment(shop.staff, first, {
          fulfillmentMode: 'PICKUP',
          scheduledDate: toIsoDate(openDay(3)),
          windowStart: '09:00',
          windowEnd: '12:00',
          customerAddressId: '',
          recipientName: '',
          recipientPhone: '',
          deliveryNotes: '',
          cardMessage: '',
          cardSignature: '',
          deliveryFee: '',
          notes: '',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        recordOrderPayment(shop.staff, first, {
          amount: '10',
          method: 'CASH',
          kind: 'DEPOSIT',
          paidOn: '',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      await updateOnlineOrderSettings(shop.owner, { ordersEnabled: 'on', minLeadDays: '1' });
      drain();
    }
    expect((await getOnlineStoreSettings(shop.owner)).staffCanAccept).toBe(false);
  });

  it('la stampa del giorno: gli ordini da preparare, con le righe e i biglietti', async () => {
    const day = openDay(8);
    const ready = await accepted(await buyer('Cliente Comanda'), {
      day,
      card: '¡Feliz cumpleaños!',
    });
    const waiting = await place(await buyer('Cliente Sin Aceptar'), { day });
    drain();
    const printout = await getDayPrintout(shop.staff, toIsoDate(day));
    expect(printout.date).toBe(toIsoDate(day));
    const ids = printout.orders.map((order) => order.id);
    expect(ids).toContain(ready);
    expect(ids).not.toContain(waiting);
    expect(printout.orders.find((order) => order.id === ready)).toMatchObject({
      fulfillmentMode: 'DELIVERY',
      windowStart: '09:00',
      windowEnd: '12:00',
      recipientName: 'Lucía',
      address: expect.stringContaining('Av. Madero 120'),
      card: { message: '¡Feliz cumpleaños!', signature: 'Ana' },
      placedOnline: true,
      balanceMinor: 108000,
      lines: [expect.objectContaining({ description: 'Ramo Dinero', quantity: 2 })],
    });
    // Un'altra fioreria non vede gli ordini di questa.
    expect(
      (await getDayPrintout(other.staff, toIsoDate(day))).orders.map((o) => o.id),
    ).not.toContain(ready);
  });
});

describe('dati scaricati', () => {
  it('le prove in «Descargar mis datos»; prove e contanti nello ZIP della fioreria', async () => {
    const who = await buyer('Cliente Datos Descargados');
    const orderId = await accepted(who);
    const sent = await proof(who, orderId, '250', 'Pagué en OXXO');
    await rejectPaymentProof(shop.owner, orderId, sent.id, { reason: 'Falta la referencia' }, deps);
    const cash = await submitOrderCashCollection(shop.staff, orderId, {
      amount: '100',
      note: 'Cambio exacto',
      submitKey: key(),
    });
    drain();

    const mine = await exportBuyerData(who);
    expect(mine.orderPaymentProofs).toEqual([
      expect.objectContaining({
        shop: 'Florería Dinero',
        amountMinor: 25000,
        currency: 'MXN',
        note: 'Pagué en OXXO',
        status: 'REJECTED',
        rejectReason: 'Falta la referencia',
      }),
    ]);

    const zip = unzipSync((await exportTenantData(shop.owner)).bytes);
    const table = (name: string) => {
      const rows = parseCsv(strFromU8(zip[name]!).replace(/^\uFEFF/, ''));
      const header = rows[0]!;
      return rows.slice(1).map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
    };
    expect(table('pedidos_comprobantes.csv').find((row) => row.id === sent.id)).toMatchObject({
      Cliente: 'Cliente Datos Descargados',
      Importe: '250.00',
      'Nota del cliente': 'Pagué en OXXO',
      Estado: 'Rechazado',
      Motivo: 'Falta la referencia',
      Foto: 'sí',
    });
    expect(table('pedidos_efectivo.csv').find((row) => row.id === cash.id)).toMatchObject({
      Importe: '100.00',
      Nota: 'Cambio exacto',
      Estado: 'En revisión',
    });
    // Lo ZIP dell'altra fioreria non ha niente di questa.
    const foreign = unzipSync((await exportTenantData(other.owner)).bytes);
    expect(strFromU8(foreign['pedidos_comprobantes.csv']!)).not.toContain(sent.id);
    expect(strFromU8(foreign['pedidos_efectivo.csv']!)).not.toContain(cash.id);
  });
});

describe('controlli di base', () => {
  it('senza permesso 403 prima di tutto; un ID che non c’è risponde 404', async () => {
    await expect(getOrderMoney(shop.owner, 'non-un-uuid')).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      confirmPaymentProof(shop.owner, crypto.randomUUID(), 'x', confirmForm('1'), deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      submitOrderCashCollection(shop.staff, crypto.randomUUID(), {
        amount: '1',
        submitKey: key(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      rejectOrderCashCollection(shop.staff, crypto.randomUUID(), crypto.randomUUID(), {
        reason: 'No',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      submitBuyerPaymentProof(
        await buyer('Cliente Sin Pedido'),
        crypto.randomUUID(),
        { amount: '1', submitKey: key() },
        await jpeg(),
        deps,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
