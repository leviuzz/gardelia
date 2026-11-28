import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  addDays,
  dayOfWeek,
  isPendingOrderExpired,
  parseCsv,
  pendingOrderDeadline,
  pendingOrderNeedsReminder,
  toIsoDate,
  todayInTimeZone,
  type CalendarDate,
} from '@floral/domain';
import {
  ForbiddenError,
  MemoryMailer,
  NotFoundError,
  ValidationError,
  acceptOnlineOrder,
  addDeliveryWindow,
  addRecipeLine,
  answerBuyerOrderQuestion,
  askOrderChange,
  askSubstitutionInApp,
  confirmBuyerOrderChange,
  countPendingOnlineOrders,
  createCatalogItem,
  declineBuyerOrderChange,
  exportBuyerData,
  exportTenantData,
  getBuyerOrder,
  getOrder,
  getOnlineStoreSettings,
  getOrderInbox,
  getOrderSubstitutions,
  getOrderThread,
  listBuyerOrders,
  listOrders,
  placeMarketplaceOrder,
  postOrderMessage,
  proposeOrderDate,
  setCatalogItemAvailability,
  setOnlineStorePublished,
  updateDeliverySettings,
  updateOnlineOrderSettings,
  updateOnlineStore,
  updateOrderLineQuantity,
  updateRecipeDetails,
  updateTenantProfile,
  type BuyerContext,
  type CatalogItemDto,
  type OrderMailDeps,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Marketplace M3-2 «Cambi da confermare» (ADR-088): il primo cambio salva com'era, «Accetta» non
 * vale con dei cambi, «Chiedi conferma» e «Proponi un'altra data», la richiesta ritirata da un
 * cambio dopo, «Confirmar» e «No, gracias» di chi compra, «Da gestire» e il menu, la scadenza e il
 * promemoria con la richiesta (anche contro le funzioni SQL), le domande «sì / no», «Chiedi
 * nell'app» in «Mancano fiori», i dati scaricati e l'isolamento fra fiorerie e fra persone.
 *
 * L'annullamento automatico (globale) di un ordine che aspetta chi compra si prova in
 * `marketplace-orders.test.ts`, con gli altri ordini scaduti.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const APP = 'http://localhost:3000';
const SECRET = 'segreto-di-prova-per-i-link-pubblici-0123456789';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const mailer = new MemoryMailer();
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

function orderForm(item: CatalogItemDto, day: CalendarDate = openDay(4)) {
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
  await addDeliveryWindow(target.owner, { start: '16:00', end: '20:00' });
  await updateOnlineStore(target.owner, {
    description: '',
    paymentMethods: ['TRANSFER'],
    paymentInstructions: 'CLABE 012 180 0000 0000 0000',
  });
  await updateOnlineOrderSettings(target.owner, { ordersEnabled: 'on', minLeadDays: '1' });
}

/** Una persona nuova: ognuna ha al massimo 3 ordini da accettare per fioreria. */
async function buyer(name = 'Cliente Cambios'): Promise<BuyerContext & { email: string }> {
  const user = await createTestUser(db, { name });
  return { userId: user.id, country: 'MX', email: user.email };
}

async function place(
  who: BuyerContext,
  item: CatalogItemDto = bouquet,
  day?: CalendarDate,
): Promise<string> {
  const placed = await placeMarketplaceOrder(
    who,
    shop.tenant.slug,
    orderForm(item, day),
    { fromSearch: false },
    deps,
  );
  return placed.orderId;
}

/** Cambia la quantità della prima riga dell'ordine. */
async function setQuantity(orderId: string, quantity: number): Promise<void> {
  const order = await getOrder(shop.owner, orderId);
  await updateOrderLineQuantity(shop.owner, orderId, order.lines[0]!.id, String(quantity));
}

/** Le email mandate fin qui (e svuota la casella). */
function drain() {
  return mailer.sent.splice(0);
}

async function changeRow(orderId: string) {
  return withTenantContext(db, shop.owner, (tx) =>
    tx.orderChangeRequest.findFirst({ where: { tenantId: shop.owner.tenantId, orderId } }),
  );
}

async function auditOf(orderId: string, action: string) {
  return withSystemContext(db, { reason: 'test: registro dei cambi' }, (tx) =>
    tx.auditLog.findMany({ where: { entityId: orderId, action }, orderBy: { createdAt: 'asc' } }),
  );
}

async function crossTenantEvents(entityId: string) {
  const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
    tx.auditLog.findMany({ where: { tenantId: null, entityId } }),
  );
  return events.filter((event) => event.action === 'security.cross_tenant_access_attempt');
}

beforeAll(async () => {
  shop = await createTestShop('Florería Cambios');
  other = await createTestShop('Florería Cambios Ajena');
  await openShop(shop, 'Florería Cambios');
  await openShop(other, 'Florería Cambios Ajena');
  bouquet = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Ramo Cambios',
      type: 'BOUQUET',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 50000,
      isOnline: true,
    }),
  );
  const foreign = await createCatalogItem(
    other.owner,
    itemInput({
      name: 'Ramo Ajeno',
      type: 'BOUQUET',
      saleUnit: 'PIECE',
      canonicalFlowerId: null,
      variety: null,
      priceMinor: 40000,
      isOnline: true,
    }),
  );
  expect(foreign.id).toBeTruthy();
  await setOnlineStorePublished(shop.owner, true);
  await setOnlineStorePublished(other.owner, true);
  drain();
});

afterAll(async () => {
  await disconnectDb();
});

describe('cambi su un ordine online da accettare', () => {
  it('il primo cambio salva com’era; con dei cambi «Accetta» non vale', async () => {
    const orderId = await place(await buyer());
    const fresh = await getOrder(shop.owner, orderId);
    expect(fresh).toMatchObject({ change: null, canAccept: true, canAskChange: false });
    expect(fresh.linesEditable).toBe(true);

    await setQuantity(orderId, 3);
    const changed = await getOrder(shop.owner, orderId);
    expect(changed.change).toMatchObject({ status: 'EDITING', hasChanges: true, round: 0 });
    expect(changed.change!.diff!.lines).toEqual([
      expect.objectContaining({
        change: 'changed',
        description: 'Ramo Cambios',
        before: expect.objectContaining({ quantity: 2 }),
        after: expect.objectContaining({ quantity: 3 }),
      }),
    ]);
    expect(changed).toMatchObject({ canAccept: false, canAskChange: true, canProposeDate: true });
    await expect(acceptOnlineOrder(shop.owner, orderId, deps)).rejects.toMatchObject({
      reason: 'order_change_needs_confirmation',
    });

    // Un secondo cambio non tocca «com'era»; tornato com'era, si accetta come sempre.
    await setQuantity(orderId, 4);
    expect((await getOrder(shop.owner, orderId)).change!.diff!.lines[0]!.before!.quantity).toBe(2);
    await setQuantity(orderId, 2);
    const back = await getOrder(shop.owner, orderId);
    expect(back).toMatchObject({ canAccept: true, canAskChange: false });
    expect(back.change!.hasChanges).toBe(false);
    await expect(askOrderChange(shop.owner, orderId, {}, deps)).rejects.toMatchObject({
      reason: 'order_change_nothing',
    });

    // Lo staff vede, ma non cambia né chiede.
    expect((await getOrder(shop.staff, orderId)).canAskChange).toBe(false);
    await expect(askOrderChange(shop.staff, orderId, {}, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('«Chiedi conferma»: email con i cambi (mai il messaggio), registro senza testi', async () => {
    const who = await buyer('Cliente Confirma');
    const orderId = await place(who);
    await setQuantity(orderId, 3);
    drain();
    await askOrderChange(shop.owner, orderId, { message: 'Nos quedan solo tres' }, deps);
    const order = await getOrder(shop.owner, orderId);
    expect(order.change).toMatchObject({ status: 'ASKED', round: 1 });
    expect(order).toMatchObject({ canAccept: false, canAskChange: false });
    await expect(askOrderChange(shop.owner, orderId, {}, deps)).rejects.toMatchObject({
      reason: 'order_change_waiting',
    });

    const mails = drain().filter((m) => m.category === 'online_order_change_asked');
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: who.email, fromName: 'Florería Cambios' });
    expect(mails[0]!.subject).toBe(
      `Florería Cambios cambió tu pedido ${order.numberLabel}: confírmalo`,
    );
    expect(mails[0]!.text).toContain('• Ramo Cambios: 2 → 3');
    expect(mails[0]!.text).toContain('• Total: $1,080.00 → $1,580.00');
    expect(mails[0]!.text).toContain(`${APP}/cuenta/pedidos/${orderId}#cambios`);
    expect(mails[0]!.text).not.toContain('Nos quedan solo tres');

    const [audit] = await auditOf(orderId, 'order.change_asked');
    expect(audit!.metadata).toEqual({
      number: order.numberLabel,
      round: 1,
      fields: ['lines', 'total'],
    });

    // Chi compra vede prima e dopo, il messaggio e il segno in «Mis pedidos».
    const detail = await getBuyerOrder(who, orderId, { secret: SECRET });
    expect(detail.change).toMatchObject({
      status: 'ASKED',
      round: 1,
      message: 'Nos quedan solo tres',
    });
    expect(detail.change!.diff!.total).toEqual({ before: 108000, after: 158000 });
    const rows = await listBuyerOrders(who, SECRET);
    expect(rows.find((row) => row.orderId === orderId)?.changesToConfirm).toBe(true);

    // La scadenza conta dalla richiesta: la stessa regola nella pagina della fioreria e di chi compra.
    const row = await changeRow(orderId);
    const placed = await withTenantContext(db, shop.owner, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: orderId }, select: { createdAt: true } }),
    );
    const expected = pendingOrderDeadline(
      {
        createdAt: placed.createdAt,
        scheduledDate: openDay(4),
        changeAskedAt: row!.askedAt,
      },
      TZ,
    );
    expect(order.onlineDeadline).toEqual(expected);
    expect(detail.deadline).toEqual(expected);
  });

  it('un cambio dopo la richiesta la ritira: la risposta vecchia non vale, la nuova accetta', async () => {
    const who = await buyer('Cliente Revisa');
    const orderId = await place(who);
    await setQuantity(orderId, 3);
    await askOrderChange(shop.owner, orderId, {}, deps);
    await setQuantity(orderId, 4);
    const withdrawn = await getOrder(shop.owner, orderId);
    expect(withdrawn.change).toMatchObject({ status: 'EDITING', withdrawn: true, round: 1 });
    expect((await getBuyerOrder(who, orderId, { secret: SECRET })).change).toMatchObject({
      status: 'EDITING',
      diff: null,
    });
    await expect(confirmBuyerOrderChange(who, orderId, { round: '1' }, deps)).rejects.toMatchObject(
      { reason: 'order_change_outdated' },
    );

    await askOrderChange(shop.owner, orderId, {}, deps);
    expect((await changeRow(orderId))!.round).toBe(2);
    drain();
    await confirmBuyerOrderChange(who, orderId, { round: '2' }, deps);
    const confirmed = await getOrder(shop.owner, orderId);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.events.at(-1)).toMatchObject({
      fromStatus: 'PENDING_ACCEPTANCE',
      toStatus: 'CONFIRMED',
    });
    expect((await changeRow(orderId))!.status).toBe('CONFIRMED');
    const mails = drain();
    expect(mails.find((m) => m.category === 'online_order_accepted')?.to).toBe(who.email);
    const toShop = mails.filter((m) => m.category === 'online_order_change_confirmed');
    expect(toShop.length).toBeGreaterThan(0);
    expect(toShop[0]!.subject).toBe(`El cliente confirmó el pedido ${confirmed.numberLabel}`);
    const [audit] = await auditOf(orderId, 'order.change_confirmed');
    expect(audit).toMatchObject({ actorUserId: who.userId });
    // Chi compra non scrive nell'inventario: la merce si mette da parte al primo passo.
    const stored = await withTenantContext(db, shop.owner, (tx) =>
      tx.order.findFirstOrThrow({
        where: { id: orderId },
        select: { inventoryReservationId: true },
      }),
    );
    expect(stored.inventoryReservationId).toBeNull();
    await expect(confirmBuyerOrderChange(who, orderId, { round: '2' }, deps)).rejects.toMatchObject(
      { reason: 'order_not_pending' },
    );
  });

  it('«Confirmar» ricontrolla l’ordine: diverso da quello chiesto non si accetta', async () => {
    const who = await buyer('Cliente Controlla');
    const orderId = await place(who);
    await setQuantity(orderId, 3);
    await askOrderChange(shop.owner, orderId, {}, deps);
    // Un cambio arrivato da una strada che non ritira la richiesta (qui direttamente nel database):
    // la richiesta resta «chiesta», ma l'ordine non è più quello che vede chi compra.
    await withSystemContext(db, { reason: 'test: cambio senza ritirare la richiesta' }, (tx) =>
      tx.order.update({
        where: { id: orderId },
        data: { deliveryFeeMinor: { increment: 9900 }, totalMinor: { increment: 9900 } },
      }),
    );
    expect((await changeRow(orderId))!.status).toBe('ASKED');
    await expect(confirmBuyerOrderChange(who, orderId, { round: '1' }, deps)).rejects.toMatchObject(
      { reason: 'order_change_outdated' },
    );
    expect((await getOrder(shop.owner, orderId)).status).toBe('PENDING_ACCEPTANCE');
    expect((await changeRow(orderId))!.status).toBe('ASKED');
  });

  it('«Proponi un’altra data» e «No, gracias»: torna alla fioreria, in «Da gestire» e nel menu', async () => {
    const before = await getOrderInbox(shop.owner);
    const menuBefore = await countPendingOnlineOrders(shop.owner);
    const who = await buyer('Cliente Dice No');
    const orderId = await place(who);
    expect((await getOrderInbox(shop.owner)).pendingOnline).toBe(before.pendingOnline + 1);

    await proposeOrderDate(
      shop.owner,
      orderId,
      {
        scheduledDate: toIsoDate(openDay(6)),
        windowStart: '16:00',
        windowEnd: '20:00',
        message: '¿Te sirve otro día?',
      },
      deps,
    );
    const asked = await getOrder(shop.owner, orderId);
    expect(asked.change).toMatchObject({ status: 'ASKED', round: 1 });
    expect(asked.change!.diff!.schedule!.after).toEqual({
      date: toIsoDate(openDay(6)),
      windowStartMinutes: 960,
      windowEndMinutes: 1200,
    });
    expect(asked.changeStatus).toBe('ASKED');
    // Aspetta chi compra: non è «da gestire» per la fioreria, né «Por aceptar» nell'elenco o nelle
    // Impostazioni (lo stesso numero del menu); lo trova il filtro «In attesa del cliente».
    expect((await getOrderInbox(shop.owner)).pendingOnline).toBe(before.pendingOnline);
    expect(await countPendingOnlineOrders(shop.owner)).toBe(menuBefore);
    const pendingTab = await listOrders(shop.owner, { when: 'pending' });
    expect(pendingTab.items.map((item) => item.id)).not.toContain(orderId);
    expect(pendingTab.pendingCount).toBe(menuBefore);
    expect(pendingTab.total).toBe(menuBefore);
    expect((await getOnlineStoreSettings(shop.owner)).pendingOrders).toBe(menuBefore);
    const waiting = await listOrders(shop.owner, { when: 'all', changes: 'asked' });
    expect(waiting.changesFilter).toBe('asked');
    expect(waiting.items.map((item) => item.id)).toContain(orderId);
    expect(waiting.items.every((item) => item.changeStatus === 'ASKED')).toBe(true);
    expect(waiting.askedChangesCount).toBe(waiting.total);

    drain();
    await declineBuyerOrderChange(
      who,
      orderId,
      { round: '1', reason: 'Prefiero el viernes' },
      deps,
    );
    const declined = await getOrder(shop.owner, orderId);
    expect(declined.change).toMatchObject({
      status: 'DECLINED',
      declineReason: 'Prefiero el viernes',
    });
    expect(declined).toMatchObject({ canAccept: false, canAskChange: true });
    const toShop = drain().filter((m) => m.category === 'online_order_change_declined');
    expect(toShop.length).toBeGreaterThan(0);
    expect(toShop[0]!.text).not.toContain('Prefiero el viernes');
    const [audit] = await auditOf(orderId, 'order.change_declined');
    expect(audit!.metadata).toMatchObject({ round: 1, withReason: true });
    expect(JSON.stringify(audit!.metadata)).not.toContain('viernes');

    const inbox = await getOrderInbox(shop.owner);
    expect(inbox.declinedChanges).toBe(before.declinedChanges + 1);
    expect(inbox.pendingOnline).toBe(before.pendingOnline);
    expect(await countPendingOnlineOrders(shop.owner)).toBe(menuBefore + 1);
    const list = await listOrders(shop.owner, { when: 'all', changes: 'declined' });
    expect(list.changesFilter).toBe('declined');
    expect(list.items.map((item) => item.id)).toContain(orderId);
    expect(list.items.every((item) => item.changeStatus === 'DECLINED')).toBe(true);
    expect(list.declinedChangesCount).toBeGreaterThan(0);
    // Tornato alla fioreria: di nuovo «Por aceptar», come nel menu.
    const backToShop = await listOrders(shop.owner, { when: 'pending' });
    expect(backToShop.items.map((item) => item.id)).toContain(orderId);
    expect(backToShop.pendingCount).toBe(menuBefore + 1);

    // Si chiede di nuovo: il motivo di prima non vale più.
    await askOrderChange(shop.owner, orderId, {}, deps);
    expect(await changeRow(orderId)).toMatchObject({
      status: 'ASKED',
      round: 2,
      declineReason: null,
    });
  });

  it('consegna a 0: si chiede solo confermando che è gratis', async () => {
    const who = await buyer('Cliente Envío Gratis');
    const orderId = await place(who);
    await setQuantity(orderId, 3);
    // Consegna a 0 (come «lo confirma la florería»): si chiede solo confermando che è gratis.
    await withTenantContext(db, shop.owner, async (tx) => {
      const order = await tx.order.findFirstOrThrow({ where: { id: orderId } });
      await tx.order.update({
        where: { id: orderId },
        data: { deliveryFeeMinor: 0, totalMinor: order.subtotalMinor - order.discountMinor },
      });
    });
    await expect(askOrderChange(shop.owner, orderId, {}, deps)).rejects.toMatchObject({
      reason: 'order_free_delivery_unconfirmed',
    });
    await askOrderChange(shop.owner, orderId, { freeDeliveryConfirmed: 'on' }, deps);
    const [audit] = await auditOf(orderId, 'order.change_asked');
    expect(audit!.metadata).toMatchObject({ freeDelivery: true });
  });
});

describe('domande «sì / no»', () => {
  it('la fioreria chiede, chi compra risponde una volta; la risposta avvisa come un messaggio', async () => {
    const who = await buyer('Cliente Responde');
    const orderId = await place(who);
    await expect(
      postOrderMessage(
        shop.owner,
        orderId,
        { body: ' ', submitKey: key(), question: 'on' },
        null,
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const question = await postOrderMessage(
      shop.owner,
      orderId,
      { body: '¿Te parece el sábado?', submitKey: key(), question: 'on' },
      null,
      deps,
    );
    const note = await postOrderMessage(
      shop.owner,
      orderId,
      { body: 'Gracias por tu pedido', submitKey: key() },
      null,
      deps,
    );
    const seen = await getBuyerOrder(who, orderId, { secret: SECRET });
    expect(seen.thread.messages.find((m) => m.id === question.id)).toMatchObject({
      kind: 'QUESTION',
      reply: null,
    });
    drain();

    await answerBuyerOrderQuestion(who, orderId, { messageId: question.id, answer: 'YES' }, deps);
    const thread = await getOrderThread(shop.owner, orderId);
    expect(thread!.messages.find((m) => m.id === question.id)).toMatchObject({ reply: 'YES' });
    expect(thread!.messages.at(-1)).toMatchObject({
      kind: 'ANSWER',
      answer: 'YES',
      authorKind: 'BUYER',
      body: '',
      unread: true,
    });
    expect(drain().some((m) => m.category === 'order_message_shop')).toBe(true);

    await expect(
      answerBuyerOrderQuestion(who, orderId, { messageId: question.id, answer: 'NO' }, deps),
    ).rejects.toMatchObject({ reason: 'order_question_answered' });
    // Si risponde solo a una domanda, e solo all'ordine proprio.
    await expect(
      answerBuyerOrderQuestion(who, orderId, { messageId: note.id, answer: 'NO' }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      answerBuyerOrderQuestion(
        await buyer('Cliente Ajeno'),
        orderId,
        { messageId: question.id, answer: 'NO' },
        deps,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Chi compra non fa domande: per lui il messaggio resta un messaggio.
    const data = await exportBuyerData(who);
    expect(data.orderMessages).toEqual([expect.objectContaining({ answer: 'YES', text: '' })]);
  });
});

describe('«Chiedi nell’app» in «Mancano fiori»', () => {
  it('la domanda col testo del server, la risposta sul fiore giusto', async () => {
    // Due varietà della stessa specie: la rosa è il sostituto proposto.
    const rosa = (await db.canonicalFlower.findUniqueOrThrow({ where: { slug: 'rosa' } })).id;
    const red = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Rosa', variety: 'roja', colors: ['red'], canonicalFlowerId: rosa }),
    );
    const pink = await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Rosa', variety: 'rosa', colors: ['pink'], canonicalFlowerId: rosa }),
    );
    const classic = await createCatalogItem(
      shop.owner,
      itemInput({
        name: 'Ramo Clásico Cambios',
        type: 'BOUQUET',
        saleUnit: 'PIECE',
        canonicalFlowerId: null,
        variety: null,
        priceMinor: 69000,
        isOnline: true,
      }),
    );
    await addRecipeLine(shop.owner, classic.id, { ingredientItemId: red.id, quantity: 12 });
    await updateRecipeDetails(shop.owner, classic.id, {
      laborCostMinor: 0,
      styleTags: [],
      notes: null,
      substitutionPolicy: 'ASK_CUSTOMER',
    });
    const who = await buyer('Cliente Flores');
    const orderId = await place(who, classic);
    await acceptOnlineOrder(shop.owner, orderId, deps);
    await setCatalogItemAvailability(shop.owner, red.id, 'OUT_OF_STOCK');
    try {
      const before = await getOrderSubstitutions(shop.owner, orderId);
      expect(before!.canAskInApp).toBe(true);
      const line = before!.lines[0]!;
      const missing = line.missing.find((entry) => entry.catalogItemId === red.id)!;
      expect(missing.askedInApp).toBeNull();
      expect(missing.candidates.map((candidate) => candidate.id)).toContain(pink.id);

      await expect(
        askSubstitutionInApp(
          shop.owner,
          orderId,
          { lineId: line.lineId, fromItemId: red.id, toItemId: classic.id },
          deps,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      drain();
      await askSubstitutionInApp(
        shop.owner,
        orderId,
        { lineId: line.lineId, fromItemId: red.id, toItemId: pink.id },
        deps,
      );
      const thread = await getOrderThread(shop.owner, orderId);
      const question = thread!.messages.at(-1)!;
      expect(question).toMatchObject({
        kind: 'QUESTION',
        body: 'Para tu pedido de Ramo Clásico Cambios se nos acabó Rosa roja. ¿Te parece si usamos Rosa rosa? El precio no cambia.',
      });
      expect(drain().some((m) => m.category === 'order_message_buyer')).toBe(true);
      expect(
        (await getOrderSubstitutions(shop.owner, orderId))!.lines[0]!.missing[0]!.askedInApp,
      ).toEqual({ toItemId: pink.id, answer: null });

      await answerBuyerOrderQuestion(who, orderId, { messageId: question.id, answer: 'YES' }, deps);
      expect(
        (await getOrderSubstitutions(shop.owner, orderId))!.lines[0]!.missing[0]!.askedInApp,
      ).toEqual({ toItemId: pink.id, answer: 'YES' });
    } finally {
      await setCatalogItemAvailability(shop.owner, red.id, 'AVAILABLE');
    }
  });
});

describe('scadenza e promemoria con la richiesta', () => {
  it('le funzioni SQL contano dalla richiesta e dalla risposta come il dominio', async () => {
    const now = Date.now();
    const far = openDay(10);
    const candidates = [
      // 4 giorni senza risposta e senza richiesta: scaduto.
      { createdAt: new Date(now - 4 * DAY), askedAt: null, answeredAt: null },
      // Chiesto adesso: chi compra ha i suoi 3 giorni.
      { createdAt: new Date(now - 4 * DAY), askedAt: new Date(now), answeredAt: null },
      // Chiesto 4 giorni fa, nessuna risposta: scaduto.
      { createdAt: new Date(now - 5 * DAY), askedAt: new Date(now - 4 * DAY), answeredAt: null },
      // «No, gracias» adesso: la fioreria ha di nuovo i suoi giorni.
      {
        createdAt: new Date(now - 6 * DAY),
        askedAt: new Date(now - 5 * DAY),
        answeredAt: new Date(now),
      },
      // Chiesto 2 giorni e mezzo fa: il promemoria tocca a lui (scade fra 12 ore).
      { createdAt: new Date(now - 3 * DAY), askedAt: new Date(now - 2.5 * DAY), answeredAt: null },
    ];
    const ids: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      ids.push(await place(await buyer('Cliente Vencimiento'), bouquet, far));
    }
    drain();
    class Rollback extends Error {}
    let expired = new Set<string>();
    let remind = new Set<string>();
    // Date e richieste scritte e lette nella stessa transazione, poi annullata: gli altri test (anche
    // di altri file, che girano insieme) non vedono mai questi ordini scaduti.
    await expect(
      withTenantContext(db, shop.owner, async (tx) => {
        for (const [index, candidate] of candidates.entries()) {
          await tx.order.updateMany({
            where: { tenantId: shop.owner.tenantId, id: ids[index]! },
            data: { createdAt: candidate.createdAt },
          });
          if (candidate.askedAt) {
            await tx.orderChangeRequest.create({
              data: {
                tenantId: shop.owner.tenantId,
                orderId: ids[index]!,
                status: candidate.answeredAt ? 'DECLINED' : 'ASKED',
                before: {},
                after: {},
                round: 1,
                askedAt: candidate.askedAt,
                answeredAt: candidate.answeredAt,
              },
            });
          }
        }
        const expiredRows = await tx.$queryRaw<{ order_id: string }[]>`
          SELECT order_id FROM app_pending_orders_to_expire(3, 100000)`;
        const remindRows = await tx.$queryRaw<{ order_id: string }[]>`
          SELECT order_id FROM app_pending_orders_to_remind(3, 24, 100000)`;
        expired = new Set(expiredRows.map((row) => row.order_id));
        remind = new Set(remindRows.map((row) => row.order_id));
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    const clocks = candidates.map((candidate) => ({
      createdAt: candidate.createdAt,
      scheduledDate: far,
      changeAskedAt: candidate.askedAt,
      changeAnsweredAt: candidate.answeredAt,
    }));
    const expectedExpired = clocks.map((clock) => isPendingOrderExpired(clock, new Date(), TZ));
    expect(expectedExpired).toEqual([true, false, true, false, false]);
    expect(ids.map((id) => expired.has(id))).toEqual(expectedExpired);
    const expectedRemind = clocks.map((clock) =>
      pendingOrderNeedsReminder(pendingOrderDeadline(clock, TZ), new Date()),
    );
    expect(expectedRemind).toEqual([false, false, false, false, true]);
    expect(ids.map((id) => remind.has(id))).toEqual(expectedRemind);
  });
});

describe('isolamento', () => {
  it('dall’altra fioreria 404 con l’evento di sicurezza; da un’altra persona 404', async () => {
    const who = await buyer('Cliente Aislado');
    const orderId = await place(who);
    await expect(askOrderChange(other.owner, orderId, {}, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      proposeOrderDate(other.owner, orderId, { scheduledDate: toIsoDate(openDay(6)) }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await crossTenantEvents(orderId)).length).toBeGreaterThanOrEqual(2);

    await setQuantity(orderId, 3);
    await askOrderChange(shop.owner, orderId, {}, deps);
    const stranger = await buyer('Cliente Extraño');
    await expect(
      confirmBuyerOrderChange(stranger, orderId, { round: '1' }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      declineBuyerOrderChange(stranger, orderId, { round: '1' }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await changeRow(orderId))!.status).toBe('ASKED');
    await expect(
      confirmBuyerOrderChange(who, orderId, { round: 'x' }, deps),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(askOrderChange(shop.owner, 'non-un-id', {}, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('dati scaricati', () => {
  it('«Scarica i miei dati» con le risposte; lo ZIP della fioreria con `pedidos_cambios.csv`', async () => {
    const who = await buyer('Cliente Datos');
    const orderId = await place(who);
    await setQuantity(orderId, 3);
    await askOrderChange(shop.owner, orderId, { message: 'Solo hay tres' }, deps);
    await declineBuyerOrderChange(who, orderId, { round: '1', reason: 'Quiero dos' }, deps);
    const data = await exportBuyerData(who);
    expect(data.orderChangeAnswers).toEqual([
      expect.objectContaining({
        shop: 'Florería Cambios',
        answer: 'DECLINED',
        reason: 'Quiero dos',
      }),
    ]);

    const entries = unzipSync((await exportTenantData(shop.owner)).bytes);
    const [header, ...rows] = parseCsv(
      strFromU8(entries['pedidos_cambios.csv']!).replace(/^\uFEFF/, ''),
      ',',
    );
    const records = rows.map((row) => Object.fromEntries(header!.map((k, i) => [k, row[i] ?? ''])));
    const number = (await getOrder(shop.owner, orderId)).numberLabel;
    expect(records.find((record) => record.Pedido === number)).toMatchObject({
      Estado: 'No aceptados',
      'Veces pedido': '1',
      'Mensaje de la florería': 'Solo hay tres',
      'Motivo del cliente': 'Quiero dos',
    });
    // Solo le richieste di questa fioreria.
    const foreign = unzipSync((await exportTenantData(other.owner)).bytes);
    const [, ...foreignRows] = parseCsv(
      strFromU8(foreign['pedidos_cambios.csv']!).replace(/^\uFEFF/, ''),
      ',',
    );
    expect(foreignRows).toEqual([]);
  });
});
