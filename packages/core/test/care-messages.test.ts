import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser, type TestUser } from '@floral/db/testing';
import {
  addDays,
  dayOfWeek,
  parseCsv,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
} from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  MemoryStorage,
  NotFoundError,
  acceptCarePortalInvite,
  addCarePlant,
  addCustomerAddress,
  confirmCareContract,
  countUnreadCareMessages,
  createCareContract,
  createCareSlot,
  createCustomer,
  exportBuyerData,
  exportTenantData,
  getCareMessagePhotoImage,
  getCareSettings,
  getCareThread,
  getMyCarePhoto,
  getMyCareThread,
  inviteCarePortal,
  listCareThreads,
  listMyCareContracts,
  markCareThreadRead,
  markMyCareThreadRead,
  postCareMessage,
  postMyCareMessage,
  removeCareMessagePhoto,
  setObjectStorage,
  updateCareSettings,
  updatePrimaryLocation,
  type BuyerContext,
  type CarePortalDeps,
  type EmailMessage,
  type Mailer,
  type TenantContext,
} from '../src/index';
import { purgeCarePhotos, retryCareEmails, sendCareMessageDigests } from '../src/jobs/care';
import { contextFor, createTestShop, type TestShop } from '../src/testing';

/**
 * Floral Care, blocco 5b (ADR-084): i messaggi fra cliente e fioreria. Tutte e due le parti
 * scrivono (lo staff compreso), testo e/o una foto, una volta sola per invio e al massimo 30 al
 * giorno per persona; letti e nuovi da tutti e due i lati; isolamento fra contratti, clienti e
 * fiorerie; niente scritture a contratto finito; l'avviso al cliente (uno al giorno, solo con
 * accesso, mai con il testo); il riassunto alla fioreria; CSV, dati della persona e conto
 * eliminato; le foto cancellate con le altre.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const STAMP = Date.now().toString(36);
const APP = 'https://gardelia.example.test';
const today = (): CalendarDate => todayInTimeZone(TZ);
const iso = (date: CalendarDate) => toIsoDate(date);
const key = () => crypto.randomUUID();

const mailer = new MemoryMailer();
const storage = new MemoryStorage();
const portalDeps: CarePortalDeps = { mailer, appUrl: APP, secret: 'm'.repeat(48) };
const mail = {
  mailer,
  appUrl: APP,
  secret: 'm'.repeat(48),
  links: { careMessages: (slug: string) => `${APP}/app/${slug}/subscriptions/messages` },
};

class FailingMailer implements Mailer {
  readonly kind = 'memory' as const;
  async send(_message: EmailMessage): Promise<void> {
    throw new Error('smtp giù');
  }
}

let shop: TestShop;
let live: { owner: TenantContext; manager: TenantContext; staff: TenantContext };
let other: TestShop;
const slotsUsed = new Map<string, number>();

async function nextSlot(ctx: TenantContext, weekday: number): Promise<string> {
  const index = (slotsUsed.get(ctx.tenantId) ?? 0) + 1;
  slotsUsed.set(ctx.tenantId, index);
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const slot = await createCareSlot(ctx, {
    weekday: String(weekday),
    start: time(300 + index * 20),
    end: time(300 + index * 20 + 20),
    capacity: '3',
  });
  return slot.id;
}

async function setUpOffer(ctx: TenantContext): Promise<void> {
  await updatePrimaryLocation(ctx, {
    addressLine1: 'Av. Madero 1',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryRadiusKm: '15',
    placeId: `ChIJ_messages_${ctx.tenantSlug}`,
    latitude: '21.8818',
    longitude: '-102.2916',
  });
  await updateCareSettings(ctx, {
    visitFee: '450',
    careFeeSmall: '10',
    careFeeMedium: '20',
    careFeeLarge: '40',
    frequencies: ['MONTHLY_1', 'MONTHLY_2', 'WEEKLY'],
    maxDistanceKm: '',
    minNoticeHours: '24',
    missedVisitPolicy: 'COUNTS',
    deadPlantPolicy: 'QUOTE',
    paymentDueDays: '10',
    termsText: '',
  });
}

interface Kit {
  readonly customerId: string;
  readonly subscriptionId: string;
}

async function newContract(ctx: TenantContext, name: string): Promise<Kit> {
  const start = addDays(today(), 2);
  const slotId = await nextSlot(ctx, dayOfWeek(start));
  const customer = await createCustomer(ctx, {
    type: 'COMPANY',
    displayName: name,
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550177',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });
  const place = await addCustomerAddress(ctx, customer.id, {
    label: name,
    recipientName: '',
    recipientPhone: '',
    addressLine1: 'Av. Universidad 300',
    addressLine2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryNotes: '',
    placeId: `ChIJ_${name.replace(/\W/g, '')}_${STAMP}`,
    latitude: '21.9',
    longitude: '-102.2916',
  });
  const settings = await getCareSettings(ctx);
  const contract = await createCareContract(ctx, customer.id, {
    customerAddressId: place.id,
    frequency: 'WEEKLY',
    slotIds: [slotId],
    startDate: iso(start),
    seats: '',
    serviceIds: settings.services
      .filter((service) => service.presetKey === 'watering')
      .map((service) => service.id),
    contactName: 'Recepción',
    contactPhone: '',
    accessNotes: '',
    notes: '',
    outOfRangeConfirmed: '',
  });
  await addCarePlant(ctx, contract.id, { name: 'Potos', quantity: '2', size: 'MEDIUM' });
  await confirmCareContract(ctx, contract.id);
  return { customerId: customer.id, subscriptionId: contract.id };
}

/** Una persona con il suo conto, invitata al contratto e già dentro. */
async function personWithAccess(
  ctx: TenantContext,
  kit: Kit,
): Promise<{ user: TestUser; buyer: BuyerContext }> {
  const user = await createTestUser(db);
  const invite = await inviteCarePortal(
    ctx,
    kit.subscriptionId,
    { email: user.email, scope: 'CONTRACT', canSeeMoney: 'on' },
    portalDeps,
  );
  const buyer: BuyerContext = { userId: user.id, country: 'MX' };
  await acceptCarePortalInvite({
    secret: portalDeps.secret,
    token: invite.url.split('/').pop() ?? '',
    buyer,
    userEmail: user.email,
  });
  return { user, buyer };
}

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: '#3f6b4f' } })
      .jpeg()
      .toBuffer(),
  );
}

async function endContract(subscriptionId: string, endDate: Date): Promise<void> {
  await withSystemContext(db, { reason: 'test: contratto finito' }, (tx) =>
    tx.customerSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'ENDED',
        startDate: new Date(endDate.getTime() - 60 * 86_400_000),
        endDate,
        endedAt: endDate,
      },
    }),
  );
}

async function digestOf(tenantId: string) {
  return withSystemContext(db, { reason: 'test: riassunto' }, (tx) =>
    tx.careMessageDigest.findMany({ where: { tenantId }, orderBy: { day: 'desc' } }),
  );
}

beforeAll(async () => {
  setObjectStorage(storage);
  // Messaggi rimasti da leggere di esecuzioni precedenti (stesso database): non entrano nei
  // riassunti di questa.
  await withSystemContext(db, { reason: 'test: messaggi vecchi' }, (tx) =>
    tx.careMessage.updateMany({
      where: { authorKind: 'CUSTOMER', readByShopAt: null },
      data: { readByShopAt: new Date() },
    }),
  );
  shop = await createTestShop('Florería Mensajes');
  await withSystemContext(db, { reason: 'test: fioreria reale' }, (tx) =>
    tx.tenant.update({
      where: { id: shop.tenant.tenantId },
      data: { mode: 'LIVE', contactEmail: `contacto-${STAMP}@mensajes.example.test` },
    }),
  );
  live = {
    owner: await contextFor(shop.tenant.owner.id, shop.tenant.slug),
    manager: await contextFor(shop.managerUser.id, shop.tenant.slug),
    staff: await contextFor(shop.staffUser.id, shop.tenant.slug),
  };
  await setUpOffer(live.owner);
  other = await createTestShop('Florería Ajena Mensajes');
  await setUpOffer(other.owner);
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('il filo dei messaggi', () => {
  it('scrivono tutti e due (anche lo staff); ciascuno vede chi ha scritto e cosa è nuovo', async () => {
    const kit = await newContract(live.owner, 'Hotel Mensajes');
    const person = await personWithAccess(live.owner, kit);
    const sent = await postMyCareMessage(
      person.buyer,
      kit.subscriptionId,
      { body: '  Hola, ¿pueden venir el jueves?  ', submitKey: key() },
      null,
    );
    expect(sent.duplicate).toBe(false);

    const unread = await countUnreadCareMessages(live.staff);
    expect(unread?.unread).toBeGreaterThanOrEqual(1);
    const thread = await getCareThread(live.staff, kit.subscriptionId);
    expect(thread).toMatchObject({
      open: true,
      accessCount: 1,
      unreadCount: 1,
      canRemovePhotos: false,
      hasOlder: false,
    });
    expect(thread.messages).toEqual([
      expect.objectContaining({
        authorKind: 'CUSTOMER',
        authorName: person.user.name,
        body: 'Hola, ¿pueden venir el jueves?',
        photoId: null,
        unread: true,
      }),
    ]);
    const list = await listCareThreads(live.owner);
    expect(list.threads[0]).toMatchObject({
      subscriptionId: kit.subscriptionId,
      unreadCount: 1,
      last: { authorKind: 'CUSTOMER', preview: 'Hola, ¿pueden venir el jueves?' },
    });

    // Lo staff risponde (decisione del founder: tutta la squadra).
    await postCareMessage(
      live.staff,
      kit.subscriptionId,
      { body: 'Claro, el jueves a las 10.', submitKey: key() },
      null,
      mail,
    );
    const mine = await getMyCareThread(person.buyer, kit.subscriptionId);
    expect(
      mine.messages.map((message) => ({
        fromShop: message.fromShop,
        mine: message.mine,
        isNew: message.isNew,
        author: message.authorName,
      })),
    ).toEqual([
      { fromShop: false, mine: true, isNew: false, author: person.user.name },
      { fromShop: true, mine: false, isNew: true, author: shop.staffUser.name },
    ]);
    expect(mine).toMatchObject({ open: true, newCount: 1, shopName: 'Florería Mensajes' });
    const listed = await listMyCareContracts(person.buyer);
    expect(listed.find((item) => item.subscriptionId === kit.subscriptionId)?.unreadMessages).toBe(
      1,
    );
    await markMyCareThreadRead(person.buyer, kit.subscriptionId);
    expect((await getMyCareThread(person.buyer, kit.subscriptionId)).newCount).toBe(0);

    // Basta una persona della squadra per segnare letto per tutti.
    expect(await markCareThreadRead(live.manager, kit.subscriptionId)).toBe(1);
    expect((await getCareThread(live.owner, kit.subscriptionId)).unreadCount).toBe(0);
  });

  it('lo stesso invio non scrive due volte; serve testo o foto; al massimo 30 al giorno', async () => {
    const kit = await newContract(live.owner, 'Oficina Repetida');
    const person = await personWithAccess(live.owner, kit);
    const submitKey = key();
    const first = await postMyCareMessage(
      person.buyer,
      kit.subscriptionId,
      { body: 'Una vez', submitKey },
      null,
    );
    expect(
      await postMyCareMessage(
        person.buyer,
        kit.subscriptionId,
        { body: 'Una vez', submitKey },
        null,
      ),
    ).toEqual({ id: first.id, duplicate: true });
    const shopKey = key();
    const fromShop = await postCareMessage(
      live.owner,
      kit.subscriptionId,
      { body: 'Hola', submitKey: shopKey },
      null,
      mail,
    );
    expect(
      await postCareMessage(
        live.owner,
        kit.subscriptionId,
        { body: 'Hola', submitKey: shopKey },
        null,
        mail,
      ),
    ).toMatchObject({ id: fromShop.id, duplicate: true });
    await expect(
      postMyCareMessage(person.buyer, kit.subscriptionId, { body: '   ', submitKey: key() }, null),
    ).rejects.toMatchObject({ fieldErrors: { body: 'care_message_empty' } });
    await expect(
      postCareMessage(live.owner, kit.subscriptionId, { body: '', submitKey: key() }, null, mail),
    ).rejects.toMatchObject({ fieldErrors: { body: 'care_message_empty' } });
    await expect(
      postCareMessage(
        live.owner,
        kit.subscriptionId,
        { body: 'x'.repeat(2001), submitKey: key() },
        null,
        mail,
      ),
    ).rejects.toMatchObject({ fieldErrors: { body: 'too_long' } });

    // Con il primo, 30 messaggi oggi: il trentunesimo no.
    await withSystemContext(db, { reason: 'test: messaggi del giorno' }, (tx) =>
      tx.careMessage.createMany({
        data: Array.from({ length: 29 }, () => ({
          tenantId: live.owner.tenantId,
          customerId: kit.customerId,
          subscriptionId: kit.subscriptionId,
          authorKind: 'CUSTOMER' as const,
          authorUserId: person.user.id,
          body: 'otra vez',
          submitKey: key(),
        })),
      }),
    );
    await expect(
      postMyCareMessage(person.buyer, kit.subscriptionId, { body: 'otra', submitKey: key() }, null),
    ).rejects.toEqual(new ConflictError('care_message_daily_limit'));
  });

  it('una foto per messaggio: la vedono tutti e due; chi gestisce la toglie e il file sparisce', async () => {
    const kit = await newContract(live.owner, 'Clínica Foto');
    const person = await personWithAccess(live.owner, kit);
    const sent = await postMyCareMessage(
      person.buyer,
      kit.subscriptionId,
      { body: '', submitKey: key() },
      await jpeg(),
    );
    const thread = await getCareThread(live.staff, kit.subscriptionId);
    const photoId = thread.messages[0]?.photoId;
    expect(photoId).toBeTruthy();
    if (!photoId) return;
    expect(await getMyCarePhoto(person.buyer, kit.subscriptionId, photoId, 'thumb')).not.toBeNull();
    const image = await getCareMessagePhotoImage(live.staff, kit.subscriptionId, photoId, 'full');
    expect(image.contentType).toBe('image/jpeg');
    const keys = [...storage.objects.keys()].filter((name) => name.includes(photoId));
    expect(keys).toHaveLength(2);

    await expect(
      removeCareMessagePhoto(live.staff, kit.subscriptionId, sent.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await removeCareMessagePhoto(live.owner, kit.subscriptionId, sent.id);
    expect(await getMyCarePhoto(person.buyer, kit.subscriptionId, photoId, 'full')).toBeNull();
    expect((await getMyCareThread(person.buyer, kit.subscriptionId)).messages[0]).toMatchObject({
      photoId: null,
      photoGone: true,
    });
    expect(keys.filter((name) => storage.objects.has(name))).toEqual([]);
    const events = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: live.owner.tenantId,
          action: 'care.message_photo_removed',
          entityId: sent.id,
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ number: expect.stringMatching(/^SUS-/), photoId });
    // Una seconda volta non fa nulla.
    await removeCareMessagePhoto(live.owner, kit.subscriptionId, sent.id);
  });

  it('un altro contratto, cliente o fioreria: 404 (con l’evento dal lato fioreria)', async () => {
    const kit = await newContract(live.owner, 'Mío Mensajes');
    const neighbour = await newContract(live.owner, 'Vecino Mensajes');
    const theirs = await newContract(other.owner, 'Ajeno Mensajes');
    const person = await personWithAccess(live.owner, kit);
    for (const id of [neighbour.subscriptionId, theirs.subscriptionId, crypto.randomUUID()]) {
      await expect(getMyCareThread(person.buyer, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        postMyCareMessage(person.buyer, id, { body: 'hola', submitKey: key() }, null),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(markMyCareThreadRead(person.buyer, id)).rejects.toBeInstanceOf(NotFoundError);
    }
    const theirMessage = await postCareMessage(
      other.owner,
      theirs.subscriptionId,
      { body: 'interno', submitKey: key() },
      null,
      mail,
    );
    await expect(getCareThread(live.owner, theirs.subscriptionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      postCareMessage(
        live.owner,
        theirs.subscriptionId,
        { body: 'intruso', submitKey: key() },
        null,
        mail,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      removeCareMessagePhoto(live.owner, kit.subscriptionId, theirMessage.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: null,
          entityId: { in: [theirs.subscriptionId, theirMessage.id] },
          action: 'security.cross_tenant_access_attempt',
        },
      }),
    );
    expect(events.map((event) => event.entityType)).toEqual(
      expect.arrayContaining(['CustomerSubscription', 'CareMessage']),
    );
    expect((await listCareThreads(live.owner)).threads.map((t) => t.subscriptionId)).not.toContain(
      theirs.subscriptionId,
    );
  });

  it('a contratto finito nessuno scrive più; il filo si legge ancora', async () => {
    const kit = await newContract(live.owner, 'Consultorio Final');
    const person = await personWithAccess(live.owner, kit);
    await postMyCareMessage(
      person.buyer,
      kit.subscriptionId,
      { body: 'Gracias', submitKey: key() },
      null,
    );
    await endContract(kit.subscriptionId, new Date());
    await expect(
      postMyCareMessage(
        person.buyer,
        kit.subscriptionId,
        { body: '¿Siguen?', submitKey: key() },
        null,
      ),
    ).rejects.toEqual(new ConflictError('care_message_closed'));
    await expect(
      postCareMessage(
        live.owner,
        kit.subscriptionId,
        { body: 'Hasta pronto', submitKey: key() },
        null,
        mail,
      ),
    ).rejects.toEqual(new ConflictError('care_message_closed'));
    expect(await getMyCareThread(person.buyer, kit.subscriptionId)).toMatchObject({
      open: false,
      messages: [expect.objectContaining({ body: 'Gracias' })],
    });
    expect((await getCareThread(live.owner, kit.subscriptionId)).open).toBe(false);
  });
});

describe('avvisi', () => {
  it('al cliente: uno al giorno per contratto, solo con accesso, solo LIVE, mai il testo', async () => {
    const kit = await newContract(live.owner, 'Hotel Aviso');
    const lonely = await newContract(live.owner, 'Hotel Sin Acceso');
    const person = await personWithAccess(live.owner, kit);
    const before = mailer.sent.length;
    const first = await postCareMessage(
      live.owner,
      kit.subscriptionId,
      { body: 'Secreto del jardín', submitKey: key() },
      null,
      mail,
    );
    const second = await postCareMessage(
      live.manager,
      kit.subscriptionId,
      { body: 'Otra cosa', submitKey: key() },
      null,
      mail,
    );
    expect([first.notified, second.notified]).toEqual([true, false]);
    const notices = mailer.sent
      .slice(before)
      .filter((message) => message.category === 'care_message_notice');
    expect(notices.map((message) => message.to)).toEqual([person.user.email]);
    expect(notices[0]?.text).not.toContain('Secreto');
    expect(notices[0]?.html).not.toContain('Secreto');
    expect(notices[0]?.text).toContain(`${APP}/cuenta/floral-care/${kit.subscriptionId}`);
    expect(notices[0]).toMatchObject({ fromName: 'Florería Mensajes' });

    // Nessuno con accesso: nessun avviso, nemmeno in coda.
    expect(
      (
        await postCareMessage(
          live.owner,
          lonely.subscriptionId,
          { body: 'Hola', submitKey: key() },
          null,
          mail,
        )
      ).notified,
    ).toBe(false);
    // Una fioreria demo non manda avvisi.
    const demoKit = await newContract(other.owner, 'Demo Aviso');
    await personWithAccess(other.owner, demoKit);
    expect(
      (
        await postCareMessage(
          other.owner,
          demoKit.subscriptionId,
          { body: 'Hola', submitKey: key() },
          null,
          mail,
        )
      ).notified,
    ).toBe(false);
    const rows = await withSystemContext(db, { reason: 'test: avvisi' }, (tx) =>
      tx.careEmail.findMany({
        where: {
          kind: 'MESSAGE_NOTICE',
          subscriptionId: {
            in: [kit.subscriptionId, lonely.subscriptionId, demoKit.subscriptionId],
          },
        },
        select: { subscriptionId: true, status: true },
      }),
    );
    expect(rows).toEqual([{ subscriptionId: kit.subscriptionId, status: 'SENT' }]);
  });

  it('al cliente: se l’invio fallisce, lo riprova il lavoro giornaliero', async () => {
    const kit = await newContract(live.owner, 'Hotel Reintento');
    const person = await personWithAccess(live.owner, kit);
    await postCareMessage(
      live.owner,
      kit.subscriptionId,
      { body: 'Hola', submitKey: key() },
      null,
      { ...mail, mailer: new FailingMailer() },
    );
    const before = mailer.sent.length;
    await retryCareEmails(mail);
    expect(
      mailer.sent
        .slice(before)
        .filter((message) => message.category === 'care_message_notice')
        .map((message) => message.to),
    ).toContain(person.user.email);
  });

  it('alla fioreria: un riassunto al giorno, solo con novità, ritentato se fallisce', async () => {
    const kit = await newContract(live.owner, 'Hotel Resumen');
    const person = await personWithAccess(live.owner, kit);
    await postMyCareMessage(
      person.buyer,
      kit.subscriptionId,
      { body: 'Texto privado', submitKey: key() },
      null,
    );
    const managers = [shop.tenant.owner.email, shop.managerUser.email].sort();
    const digestsTo = (from: number) =>
      mailer.sent
        .slice(from)
        .filter((message) => message.category === 'care_message_digest')
        .filter((message) => managers.includes(message.to));

    await sendCareMessageDigests({ ...mail, mailer: new FailingMailer() });
    expect((await digestOf(live.owner.tenantId))[0]).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastError: 'send_failed',
    });
    let before = mailer.sent.length;
    await sendCareMessageDigests(mail);
    const sent = digestsTo(before);
    expect(sent.map((message) => message.to).sort()).toEqual(managers);
    expect(sent[0]?.text).not.toContain('Texto privado');
    expect(sent[0]?.text).toContain(`${APP}/app/${shop.tenant.slug}/subscriptions/messages`);
    expect((await digestOf(live.owner.tenantId))[0]).toMatchObject({ status: 'SENT', attempts: 2 });

    // Lo stesso giorno, anche con un messaggio nuovo, non riparte.
    await postMyCareMessage(
      person.buyer,
      kit.subscriptionId,
      { body: 'Otro', submitKey: key() },
      null,
    );
    before = mailer.sent.length;
    await sendCareMessageDigests(mail);
    expect(digestsTo(before)).toEqual([]);

    // Il giorno dopo riparte per i messaggi arrivati dopo l'ultimo riassunto…
    const yesterday = new Date(Date.UTC(today().year, today().month - 1, today().day - 1));
    const backdate = (sentAt: Date) =>
      withSystemContext(db, { reason: 'test: riassunto di ieri' }, (tx) =>
        tx.careMessageDigest.updateMany({
          where: { tenantId: live.owner.tenantId },
          data: { day: yesterday, sentAt },
        }),
      );
    await backdate(new Date(Date.now() - 60 * 60_000));
    before = mailer.sent.length;
    await sendCareMessageDigests(mail);
    expect(digestsTo(before)).toHaveLength(2);
    // …ma senza niente di nuovo dopo l'ultimo, no.
    await withSystemContext(db, { reason: 'test: pulizia' }, (tx) =>
      tx.careMessageDigest.deleteMany({
        where: { tenantId: live.owner.tenantId, day: yesterday },
      }),
    );
    await backdate(new Date());
    before = mailer.sent.length;
    await sendCareMessageDigests(mail);
    expect(digestsTo(before)).toEqual([]);
  });
});

describe('dati e cancellazioni', () => {
  it('CSV della fioreria, dati della persona e conto eliminato ("Cuenta eliminada")', async () => {
    const kit = await newContract(live.owner, 'Hotel Datos Mensajes');
    const person = await personWithAccess(live.owner, kit);
    await postMyCareMessage(
      person.buyer,
      kit.subscriptionId,
      { body: 'Mensaje para el CSV', submitKey: key() },
      await jpeg(),
    );
    await postCareMessage(
      live.owner,
      kit.subscriptionId,
      { body: 'Respuesta', submitKey: key() },
      null,
      mail,
    );
    await markMyCareThreadRead(person.buyer, kit.subscriptionId);
    const data = await exportBuyerData(person.buyer);
    expect(data.floralCare.messages).toEqual([
      expect.objectContaining({
        shop: 'Florería Mensajes',
        contract: expect.stringMatching(/^SUS-/),
        text: 'Mensaje para el CSV',
        withPhoto: true,
      }),
    ]);

    await withSystemContext(db, { reason: 'test: conto eliminato' }, (tx) =>
      tx.user.delete({ where: { id: person.user.id } }),
    );
    const thread = await getCareThread(live.owner, kit.subscriptionId);
    expect(thread.accessCount).toBe(0);
    expect(thread.messages.map((message) => message.authorName)).toEqual([
      null,
      shop.tenant.owner.name,
    ]);
    const reads = await withSystemContext(db, { reason: 'test: letture' }, (tx) =>
      tx.carePortalRead.count({ where: { userId: person.user.id } }),
    );
    expect(reads).toBe(0);

    const file = await exportTenantData(live.owner);
    const bytes = unzipSync(file.bytes)['floral_care_mensajes.csv']!;
    const [header, ...rows] = parseCsv(strFromU8(bytes).replace(/^\uFEFF/, ''), ',');
    const table = rows
      .map((row) => Object.fromEntries(header!.map((name, i) => [name, row[i]])))
      .filter((row) => row.Contrato === thread.numberLabel);
    expect(table).toEqual([
      expect.objectContaining({
        Escribió: 'Cliente',
        Persona: 'Cuenta eliminada',
        Mensaje: 'Mensaje para el CSV',
        Foto: 'sí',
      }),
      expect.objectContaining({ Escribió: 'Florería', Mensaje: 'Respuesta', Foto: 'no' }),
    ]);
  });

  it('le foto dei messaggi si cancellano con le altre, 30 giorni dopo la fine', async () => {
    const kit = await newContract(live.owner, 'Hotel Purga Mensajes');
    const person = await personWithAccess(live.owner, kit);
    await postMyCareMessage(
      person.buyer,
      kit.subscriptionId,
      { body: 'Foto', submitKey: key() },
      await jpeg(),
    );
    await endContract(kit.subscriptionId, new Date(Date.now() - 31 * 86_400_000));
    await purgeCarePhotos();
    const photos = await withSystemContext(db, { reason: 'test: foto' }, (tx) =>
      tx.carePhoto.findMany({
        where: { subscriptionId: kit.subscriptionId },
        select: { storageKey: true, deletedAt: true, messageId: true },
      }),
    );
    expect(photos).toHaveLength(1);
    expect(photos[0]?.messageId).not.toBeNull();
    expect(photos[0]?.deletedAt).not.toBeNull();
    expect(storage.objects.has(photos[0]!.storageKey)).toBe(false);
  });
});
