import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  SERVICE_REQUEST_LIMITS,
  addDays,
  dayOfWeek,
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
  addBuyerAddress,
  addDeliveryWindow,
  cancelBuyerServiceRequest,
  countNewServiceRequests,
  createCareSlot,
  createCatalogItem,
  createStorefrontService,
  declineServiceRequest,
  exportBuyerData,
  exportTenantData,
  getBuyerServiceRequest,
  getBuyerServiceRequestPhoto,
  getServiceRequest,
  getServiceRequestForm,
  getServiceRequestPhotoImage,
  listBuyerServiceRequests,
  listServiceRequests,
  purgeServiceRequestPhotos,
  saveStorefrontService,
  serviceRequestsMenuCount,
  setObjectStorage,
  setOnlineStorePublished,
  setStorefrontServicePublished,
  submitServiceRequest,
  updateCareSettings,
  updateDeliverySettings,
  updateOnlineStore,
  updateTenantProfile,
  type BuyerContext,
  type OrderMailDeps,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Marketplace M5 (ADR-089): le richieste dei servizi in vetrina. Chi compra chiede dal suo conto
 * (modulo per tipo, foto di ispirazione, doppio invio, limite delle aperte, date, fasce e frequenze
 * della fioreria), segue e annulla in «Mis solicitudes»; la fioreria le vede in «Richieste», le
 * conta nel menu e in «Da gestire» con lo stesso numero, le rifiuta con un motivo. Email dopo il
 * commit e senza il messaggio, registro senza testi, foto cancellate 30 giorni dopo la chiusura,
 * esportazioni e isolamento fra fiorerie e fra persone.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const APP = 'http://localhost:3000';
const DAY = 24 * 60 * 60 * 1000;
const mailer = new MemoryMailer();
const storage = new MemoryStorage();
const deps: OrderMailDeps = {
  mailer,
  appUrl: APP,
  secret: 'segreto-di-prova-per-i-link-pubblici-0123456789',
  links: {
    order: (slug, id) => `${APP}/app/${slug}/orders/${id}`,
    account: `${APP}/cuenta`,
    search: `${APP}/`,
    serviceRequest: (slug, id) => `${APP}/app/${slug}/requests/${id}`,
    buyerServiceRequest: (id) => `${APP}/cuenta/solicitudes/${id}`,
  },
};
const key = () => crypto.randomUUID();
const SECRET_NOTE = 'Mensaje privado de la clienta';

let shop: TestShop;
let other: TestShop;
const services: Record<'event' | 'weekly' | 'care' | 'custom' | 'venue', string> = {
  event: '',
  weekly: '',
  care: '',
  custom: '',
  venue: '',
};
let foreignService = '';

/** Un giorno da domani in poi che non è domenica (la fioreria non consegna la domenica). */
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

const ADDRESS = {
  buyerAddressId: '',
  addressLine1: 'Av. Universidad 940',
  addressLine2: '',
  neighborhood: 'Bosques del Prado',
  city: 'Aguascalientes',
  region: 'AGU',
  postalCode: '20127',
  deliveryNotes: 'Oficina 3',
};

function eventForm(overrides: Record<string, unknown> = {}) {
  return {
    date: toIsoDate(openDay(10)),
    eventType: 'WEDDING',
    guests: '120',
    place: 'Jardín Las Palmas',
    budget: '25000',
    message: SECRET_NOTE,
    contactPhone: '449 555 0101',
    submitKey: key(),
    ...overrides,
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
    paymentInstructions: '',
  });
  await createCatalogItem(
    target.owner,
    itemInput({ type: 'BOUQUET', saleUnit: 'PIECE', name: 'Ramo de la vetrina', isOnline: true }),
  );
  await setOnlineStorePublished(target.owner, true);
}

async function buyer(name: string): Promise<BuyerContext & { email: string }> {
  const user = await createTestUser(db, { name });
  return { userId: user.id, country: 'MX', email: user.email };
}

async function jpeg(color = '#c25b7a'): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: color } })
      .jpeg()
      .toBuffer(),
  );
}

/** Le email mandate fin qui (e svuota la casella). */
function drain() {
  return mailer.sent.splice(0);
}

async function auditOf(entityId: string) {
  return withSystemContext(db, { reason: 'test: registro delle richieste' }, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
  );
}

async function crossTenantEvents(entityId: string) {
  const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
    tx.auditLog.findMany({ where: { tenantId: null, entityId } }),
  );
  return events.filter((event) => event.action === 'security.cross_tenant_access_attempt');
}

async function conflictOf(promise: Promise<unknown>): Promise<string | null> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof ConflictError ? error.reason : null;
}

async function fieldErrorsOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof ValidationError ? error.fieldErrors : null;
}

beforeAll(async () => {
  setObjectStorage(storage);
  shop = await createTestShop('Florería Solicitudes');
  other = await createTestShop('Florería Solicitudes Ajena');
  await openShop(shop, 'Florería Solicitudes');
  await openShop(other, 'Florería Solicitudes Ajena');
  await updateCareSettings(shop.owner, {
    visitFee: '450',
    careFeeSmall: '10',
    careFeeMedium: '20',
    careFeeLarge: '40',
    frequencies: ['MONTHLY_1', 'WEEKLY'],
    maxDistanceKm: '',
    minNoticeHours: '24',
    missedVisitPolicy: 'COUNTS',
    deadPlantPolicy: 'QUOTE',
    paymentDueDays: '10',
    termsText: '',
  });
  await createCareSlot(shop.owner, { weekday: '2', start: '09:00', end: '11:00', capacity: '2' });
  for (const kind of ['EVENT', 'WEEKLY', 'CARE', 'VENUE'] as const) {
    const saved = await saveStorefrontService(shop.owner, { kind }, {});
    services[
      kind === 'EVENT' ? 'event' : kind === 'WEEKLY' ? 'weekly' : kind === 'CARE' ? 'care' : 'venue'
    ] = saved.id;
    if (kind !== 'VENUE') await setStorefrontServicePublished(shop.owner, { kind }, true);
  }
  const custom = await createStorefrontService(shop.owner, {
    name: 'Coronas fúnebres',
    askDate: 'on',
  });
  services.custom = custom.id;
  await setStorefrontServicePublished(shop.owner, { serviceId: custom.id }, true);
  const foreign = await createStorefrontService(other.owner, { name: 'Servicio ajeno' });
  await setStorefrontServicePublished(other.owner, { serviceId: foreign.id }, true);
  foreignService = foreign.id;
  drain();
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('chi compra chiede un servizio', () => {
  it('evento con una foto: «Nueva», cliente nel CRM, email dopo il commit senza il messaggio', async () => {
    const who = await buyer('Lucía Evento');
    const form = await getServiceRequestForm(who, shop.tenant.slug, services.event);
    expect(form).toMatchObject({
      service: { kind: 'EVENT' },
      needsAddress: false,
      minDate: toIsoDate(addDays(todayInTimeZone(TZ), 1)),
      openCount: 0,
    });

    const sent = await submitServiceRequest(
      who,
      shop.tenant.slug,
      services.event,
      eventForm(),
      [await jpeg()],
      { fromSearch: false },
      deps,
    );
    expect(sent).toMatchObject({ numberLabel: 'SOL-0001', duplicate: false });

    const mine = await getBuyerServiceRequest(who, sent.requestId);
    expect(mine.shop.name).toBe('Florería Solicitudes');
    expect(mine.canCancel).toBe(true);
    expect(mine.request).toMatchObject({
      status: 'NEW',
      kind: 'EVENT',
      budgetMinor: 2500000,
      contactPhone: '+524495550101',
      message: SECRET_NOTE,
      address: null,
      answers: { eventType: 'WEDDING', guests: 120, place: 'Jardín Las Palmas' },
    });
    expect(mine.request.photos).toHaveLength(1);
    const photoKey = `tenants/${shop.owner.tenantId}/service-requests/${sent.requestId}-${mine.request.photos[0]!.id}.jpg`;
    expect(storage.objects.has(photoKey)).toBe(true);

    const mails = drain();
    expect(mails.map((mail) => [mail.to, mail.subject]).sort()).toEqual(
      [
        [who.email, 'Recibimos tu solicitud SOL-0001 para Florería Solicitudes'],
        [shop.tenant.owner.email, 'Nueva solicitud SOL-0001: Eventos y bodas'],
        [shop.managerUser.email, 'Nueva solicitud SOL-0001: Eventos y bodas'],
      ].sort(),
    );
    for (const mail of mails) {
      expect(mail.text).not.toContain(SECRET_NOTE);
      expect(mail.html).not.toContain(SECRET_NOTE);
    }
    const shopMail = mails.find((mail) => mail.to === shop.tenant.owner.email);
    expect(shopMail?.text).toContain(`${APP}/app/${shop.tenant.slug}/requests/${sent.requestId}`);

    const audit = await auditOf(sent.requestId);
    expect(audit.map((row) => row.action)).toEqual(['service_request.submitted']);
    expect(audit[0]).toMatchObject({ actorUserId: who.userId, tenantId: shop.owner.tenantId });
    expect(JSON.stringify(audit[0]!.metadata)).not.toContain(SECRET_NOTE);

    // Il cliente del CRM è quello della richiesta, con l'email e il telefono.
    const view = await getServiceRequest(shop.owner, sent.requestId);
    expect(view.customer).toMatchObject({
      displayName: 'Lucía Evento',
      email: who.email,
      phone: '+524495550101',
    });
    expect(view.canDecline).toBe(true);
  });

  it('lo stesso invio due volte scrive una richiesta sola, senza email né foto in più', async () => {
    const who = await buyer('Ana Doble');
    const input = eventForm();
    const first = await submitServiceRequest(
      who,
      shop.tenant.slug,
      services.event,
      input,
      [],
      { fromSearch: false },
      deps,
    );
    drain();
    const files = storage.objects.size;
    const second = await submitServiceRequest(
      who,
      shop.tenant.slug,
      services.event,
      input,
      [await jpeg()],
      { fromSearch: false },
      deps,
    );
    expect(second).toEqual({ ...first, duplicate: true });
    expect(drain()).toEqual([]);
    expect(storage.objects.size).toBe(files);
    expect(await listBuyerServiceRequests(who)).toHaveLength(1);
  });

  it('date, servizio spento, troppe foto: errori chiari prima di scrivere', async () => {
    const who = await buyer('Mario Errores');
    const today = toIsoDate(todayInTimeZone(TZ));
    expect(
      await fieldErrorsOf(
        submitServiceRequest(
          who,
          shop.tenant.slug,
          services.event,
          eventForm({ date: today }),
          [],
          { fromSearch: false },
          deps,
        ),
      ),
    ).toEqual({ date: 'service_date_too_soon' });
    const far = toIsoDate(addDays(todayInTimeZone(TZ), 400));
    expect(
      await fieldErrorsOf(
        submitServiceRequest(
          who,
          shop.tenant.slug,
          services.event,
          eventForm({ date: far }),
          [],
          { fromSearch: false },
          deps,
        ),
      ),
    ).toEqual({ date: 'service_date_too_far' });
    // «Decoración de espacios» c'è ma è spento; un servizio di un'altra fioreria non c'è qui.
    for (const serviceId of [services.venue, foreignService, crypto.randomUUID()]) {
      expect(
        await conflictOf(
          submitServiceRequest(
            who,
            shop.tenant.slug,
            serviceId,
            eventForm(),
            [],
            { fromSearch: false },
            deps,
          ),
        ),
      ).toBe('service_unavailable');
      expect(await getServiceRequestForm(who, shop.tenant.slug, serviceId)).toBeNull();
    }
    const photos = await Promise.all(
      Array.from({ length: SERVICE_REQUEST_LIMITS.photos + 1 }, () => jpeg()),
    );
    expect(
      await fieldErrorsOf(
        submitServiceRequest(
          who,
          shop.tenant.slug,
          services.event,
          eventForm(),
          photos,
          { fromSearch: false },
          deps,
        ),
      ),
    ).toEqual({ photos: 'too_many_photos' });
    expect(await listBuyerServiceRequests(who)).toEqual([]);
    expect(drain()).toEqual([]);
  });

  it(`al massimo ${SERVICE_REQUEST_LIMITS.openPerBuyer} richieste aperte per persona e fioreria`, async () => {
    const who = await buyer('Rosa Muchas');
    const ids: string[] = [];
    for (let index = 0; index < SERVICE_REQUEST_LIMITS.openPerBuyer; index += 1) {
      const sent = await submitServiceRequest(
        who,
        shop.tenant.slug,
        services.custom,
        {
          message: `Corona ${index + 1}`,
          date: '',
          contactPhone: '449 555 0102',
          submitKey: key(),
        },
        [],
        { fromSearch: false },
        deps,
      );
      ids.push(sent.requestId);
    }
    const sixth = () =>
      submitServiceRequest(
        who,
        shop.tenant.slug,
        services.custom,
        { message: 'Una más', date: '', contactPhone: '449 555 0102', submitKey: key() },
        [],
        { fromSearch: false },
        deps,
      );
    expect(await conflictOf(sixth())).toBe('service_requests_open_limit');
    // In un'altra fioreria si può; annullandone una si torna sotto il limite.
    await submitServiceRequest(
      who,
      other.tenant.slug,
      foreignService,
      { message: 'En la otra', contactPhone: '449 555 0102', submitKey: key() },
      [],
      { fromSearch: false },
      deps,
    );
    await cancelBuyerServiceRequest(who, ids[0]!, deps);
    await expect(sixth()).resolves.toMatchObject({ duplicate: false });
    drain();
  });

  it('Floral Care: frequenze della fioreria, indirizzo nuovo o della rubrica', async () => {
    const who = await buyer('Carmen Plantas');
    const form = await getServiceRequestForm(who, shop.tenant.slug, services.care);
    expect(form).toMatchObject({ needsAddress: true, careFrequencies: ['MONTHLY_1', 'WEEKLY'] });
    const care = (overrides: Record<string, unknown>) =>
      submitServiceRequest(
        who,
        shop.tenant.slug,
        services.care,
        {
          ...ADDRESS,
          plants: '12',
          frequency: 'WEEKLY',
          contactPhone: '449 555 0103',
          submitKey: key(),
          ...overrides,
        },
        [],
        { fromSearch: false },
        deps,
      );
    expect(await fieldErrorsOf(care({ frequency: 'MONTHLY_2' }))).toEqual({
      frequency: 'invalid_option',
    });
    expect(await fieldErrorsOf(care({ addressLine1: '' }))).toMatchObject({
      addressLine1: 'required',
    });
    // L'indirizzo salvato di un'altra persona non vale.
    const stranger = await buyer('Otra Persona');
    const foreignAddress = await addBuyerAddress(stranger, { ...ADDRESS, label: 'Casa' });
    expect(await fieldErrorsOf(care({ buyerAddressId: foreignAddress.id }))).toEqual({
      buyerAddressId: 'invalid_option',
    });
    const saved = await addBuyerAddress(who, { ...ADDRESS, addressLine1: 'Calle Morelos 12' });
    const sent = await care({ buyerAddressId: saved.id, addressLine1: '' });
    const mine = await getBuyerServiceRequest(who, sent.requestId);
    expect(mine.request).toMatchObject({
      kind: 'CARE',
      preferredDate: null,
      address: { addressLine1: 'Calle Morelos 12', city: 'Aguascalientes', notes: 'Oficina 3' },
      answers: { plants: 12, frequency: 'WEEKLY' },
    });
    drain();
  });

  it('Flores cada semana: solo le fasce e i giorni della fioreria', async () => {
    const who = await buyer('Laura Semana');
    const weekly = (overrides: Record<string, unknown>) =>
      submitServiceRequest(
        who,
        shop.tenant.slug,
        services.weekly,
        {
          ...ADDRESS,
          date: toIsoDate(openDay(2)),
          weekday: '1',
          window: '09:00-12:00',
          duration: 'THREE_MONTHS',
          budget: '450',
          contactPhone: '449 555 0104',
          submitKey: key(),
          ...overrides,
        },
        [],
        { fromSearch: false },
        deps,
      );
    expect(await fieldErrorsOf(weekly({ window: '13:00-15:00' }))).toEqual({
      window: 'invalid_option',
    });
    expect(await fieldErrorsOf(weekly({ weekday: '0' }))).toEqual({ weekday: 'invalid_option' });
    const sent = await weekly({});
    const view = await getServiceRequest(shop.manager, sent.requestId);
    expect(view.request).toMatchObject({
      budgetMinor: 45000,
      answers: {
        weekday: 1,
        windowStartMinutes: 540,
        windowEndMinutes: 720,
        duration: 'THREE_MONTHS',
      },
    });
    drain();
  });
});

describe('«Mis solicitudes» e «Cancelar solicitud»', () => {
  it('solo le proprie; si annulla finché è aperta e la fioreria lo sa', async () => {
    const who = await buyer('Paola Cancela');
    const intruder = await buyer('Intrusa');
    const sent = await submitServiceRequest(
      who,
      shop.tenant.slug,
      services.event,
      eventForm(),
      [await jpeg()],
      { fromSearch: true },
      deps,
    );
    drain();
    const list = await listBuyerServiceRequests(who);
    expect(list).toEqual([
      expect.objectContaining({
        id: sent.requestId,
        numberLabel: sent.numberLabel,
        kind: 'EVENT',
        status: 'NEW',
        shop: { slug: shop.tenant.slug, name: 'Florería Solicitudes', active: true },
      }),
    ]);
    const photoId = (await getBuyerServiceRequest(who, sent.requestId)).request.photos[0]!.id;
    expect(
      (await getBuyerServiceRequestPhoto(who, sent.requestId, photoId, 'thumb')).bytes.byteLength,
    ).toBeGreaterThan(0);

    // Un'altra persona non vede, non annulla, non apre le foto: 404 come una inesistente.
    await expect(getBuyerServiceRequest(intruder, sent.requestId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(cancelBuyerServiceRequest(intruder, sent.requestId, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      getBuyerServiceRequestPhoto(intruder, sent.requestId, photoId, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listBuyerServiceRequests(intruder)).toEqual([]);

    await cancelBuyerServiceRequest(who, sent.requestId, deps);
    const mails = drain();
    expect(mails.map((mail) => mail.subject)).toEqual([
      `Se canceló la solicitud ${sent.numberLabel}`,
      `Se canceló la solicitud ${sent.numberLabel}`,
    ]);
    expect((await getBuyerServiceRequest(who, sent.requestId)).request.status).toBe('CANCELLED');
    expect(await conflictOf(cancelBuyerServiceRequest(who, sent.requestId, deps))).toBe(
      'service_request_closed',
    );
    expect((await auditOf(sent.requestId)).map((row) => row.action)).toEqual([
      'service_request.submitted',
      'service_request.cancelled_by_buyer',
    ]);
  });
});

describe('«Richieste» nell’app della fioreria', () => {
  it('menu, «Da gestire» ed elenco contano le stesse nuove; lo staff vede ma non risponde', async () => {
    const list = await listServiceRequests(shop.owner, { filter: 'new' });
    expect(list.total).toBe(list.newCount);
    expect(await countNewServiceRequests(shop.staff)).toBe(list.newCount);
    expect(await serviceRequestsMenuCount(shop.owner)).toBe(list.newCount);
    expect(await serviceRequestsMenuCount(shop.manager)).toBe(list.newCount);
    expect(await serviceRequestsMenuCount(shop.staff)).toBe(0);
    expect(list.items.every((item) => item.status === 'NEW')).toBe(true);
    const closed = await listServiceRequests(shop.staff, { filter: 'closed' });
    expect(closed.items.every((item) => item.status === 'CANCELLED')).toBe(true);
    const anyNew = list.items[0]!;
    const staffView = await getServiceRequest(shop.staff, anyNew.id);
    expect(staffView.canDecline).toBe(false);
    await expect(
      declineServiceRequest(shop.staff, anyNew.id, { reasonCode: 'OUT_OF_AREA' }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('«Rifiuta» con un motivo pronto: chi compra lo legge per email e nel conto', async () => {
    const who = await buyer('Sofía Rechazo');
    const sent = await submitServiceRequest(
      who,
      shop.tenant.slug,
      services.event,
      eventForm(),
      [],
      { fromSearch: false },
      deps,
    );
    drain();
    expect(
      await fieldErrorsOf(
        declineServiceRequest(
          shop.manager,
          sent.requestId,
          { reasonCode: 'OTHER', detail: '' },
          deps,
        ),
      ),
    ).toEqual({ detail: 'required' });
    await declineServiceRequest(
      shop.manager,
      sent.requestId,
      { reasonCode: 'NO_AVAILABILITY', detail: 'Esa semana cerramos.' },
      deps,
    );
    const [mail, ...rest] = drain();
    expect(rest).toEqual([]);
    expect(mail).toMatchObject({
      to: who.email,
      subject: `Florería Solicitudes no puede atender tu solicitud ${sent.numberLabel}`,
    });
    expect(mail!.text).toContain('No tenemos disponibilidad para esa fecha. Esa semana cerramos.');
    expect(mail!.text).toContain(`${APP}/cuenta/solicitudes/${sent.requestId}`);
    const mine = await getBuyerServiceRequest(who, sent.requestId);
    expect(mine).toMatchObject({
      canCancel: false,
      request: {
        status: 'DECLINED',
        declineReasonCode: 'NO_AVAILABILITY',
        declineReason: 'No tenemos disponibilidad para esa fecha. Esa semana cerramos.',
      },
    });
    expect(
      await conflictOf(
        declineServiceRequest(shop.owner, sent.requestId, { reasonCode: 'OUT_OF_AREA' }, deps),
      ),
    ).toBe('service_request_closed');
    const audit = await auditOf(sent.requestId);
    expect(audit.map((row) => row.action)).toEqual([
      'service_request.submitted',
      'service_request.declined',
    ]);
    expect(audit[1]!.metadata).toMatchObject({ reasonCode: 'NO_AVAILABILITY', withDetail: true });
    expect(JSON.stringify(audit[1]!.metadata)).not.toContain('cerramos');
  });

  it('isolamento: la richiesta di un’altra fioreria è un 404 con l’evento di sicurezza', async () => {
    const who = await buyer('Elena Aislada');
    const sent = await submitServiceRequest(
      who,
      shop.tenant.slug,
      services.event,
      eventForm(),
      [await jpeg()],
      { fromSearch: false },
      deps,
    );
    drain();
    const photoId = (await getServiceRequest(shop.owner, sent.requestId)).request.photos[0]!.id;
    await expect(getServiceRequest(other.owner, sent.requestId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      declineServiceRequest(other.owner, sent.requestId, { reasonCode: 'OUT_OF_AREA' }, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getServiceRequestPhotoImage(other.owner, sent.requestId, photoId, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await crossTenantEvents(sent.requestId)).length).toBeGreaterThanOrEqual(2);
    expect((await crossTenantEvents(photoId)).length).toBeGreaterThanOrEqual(1);
    expect(
      (await listServiceRequests(other.owner, { filter: 'all' })).items.map((item) => item.id),
    ).not.toContain(sent.requestId);
    // Niente è cambiato.
    expect((await getServiceRequest(shop.owner, sent.requestId)).request.status).toBe('NEW');
    expect(
      (await getServiceRequestPhotoImage(shop.owner, sent.requestId, photoId, 'thumb')).bytes
        .byteLength,
    ).toBeGreaterThan(0);
  });

  it('un negozio ritirato non riceve richieste', async () => {
    const closing = await createTestShop('Florería Solicitudes Cerrada');
    await openShop(closing, 'Florería Solicitudes Cerrada');
    const saved = await saveStorefrontService(closing.owner, { kind: 'EVENT' }, {});
    await setStorefrontServicePublished(closing.owner, { kind: 'EVENT' }, true);
    await setOnlineStorePublished(closing.owner, false);
    const who = await buyer('Nadia Tarde');
    expect(await getServiceRequestForm(who, closing.tenant.slug, saved.id)).toBeNull();
    await expect(
      submitServiceRequest(
        who,
        closing.tenant.slug,
        saved.id,
        eventForm(),
        [],
        { fromSearch: false },
        deps,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('foto cancellate ed esportazioni', () => {
  it('le foto di una richiesta chiusa da 30 giorni si cancellano; il resto rimane', async () => {
    const who = await buyer('Irene Fotos');
    const closed = await submitServiceRequest(
      who,
      shop.tenant.slug,
      services.event,
      eventForm(),
      [await jpeg()],
      { fromSearch: false },
      deps,
    );
    const open = await submitServiceRequest(
      who,
      shop.tenant.slug,
      services.event,
      eventForm(),
      [await jpeg('#335577')],
      { fromSearch: false },
      deps,
    );
    await cancelBuyerServiceRequest(who, closed.requestId, deps);
    drain();
    await withTenantContext(db, shop.owner, (tx) =>
      tx.serviceRequest.updateMany({
        where: { tenantId: shop.owner.tenantId, id: { in: [closed.requestId, open.requestId] } },
        data: { statusChangedAt: new Date(Date.now() - 31 * DAY) },
      }),
    );
    const closedPhoto = (await getBuyerServiceRequest(who, closed.requestId)).request.photos[0]!;
    const openPhoto = (await getBuyerServiceRequest(who, open.requestId)).request.photos[0]!;
    expect(await purgeServiceRequestPhotos()).toBeGreaterThanOrEqual(1);
    expect(
      storage.objects.has(
        `tenants/${shop.owner.tenantId}/service-requests/${closed.requestId}-${closedPhoto.id}.jpg`,
      ),
    ).toBe(false);
    const after = await getBuyerServiceRequest(who, closed.requestId);
    expect(after.request.photos).toEqual([{ ...closedPhoto, deleted: true }]);
    expect(after.request.message).toBe(SECRET_NOTE);
    await expect(
      getServiceRequestPhotoImage(shop.owner, closed.requestId, closedPhoto.id, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Quella ancora aperta resta, anche se vecchia.
    expect(
      (await getBuyerServiceRequestPhoto(who, open.requestId, openPhoto.id, 'thumb')).bytes
        .byteLength,
    ).toBeGreaterThan(0);
  });

  it('nello ZIP della fioreria e in «Descargar mis datos», senza le foto', async () => {
    const who = await buyer('Diana Datos');
    const sent = await submitServiceRequest(
      who,
      shop.tenant.slug,
      services.event,
      eventForm({ eventType: 'XV', guests: '80' }),
      [await jpeg()],
      { fromSearch: false },
      deps,
    );
    drain();
    const zip = unzipSync((await exportTenantData(shop.owner)).bytes);
    const table = (name: string) => {
      const rows = parseCsv(strFromU8(zip[name]!).replace(/^\uFEFF/, ''));
      const header = rows[0]!;
      return rows.slice(1).map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
    };
    expect(table('solicitudes.csv').find((row) => row.id === sent.requestId)).toMatchObject({
      Número: sent.numberLabel,
      Servicio: 'Eventos y bodas',
      Estado: 'Nueva',
      Cliente: 'Diana Datos',
      Presupuesto: '25000.00',
      Mensaje: SECRET_NOTE,
      Detalles: 'Tipo: XV años; Invitados: 80; Lugar: Jardín Las Palmas',
      Fotos: '1',
    });
    expect(table('servicios_tienda.csv').map((row) => row.Servicio)).toEqual(
      expect.arrayContaining(['Eventos y bodas', 'Coronas fúnebres']),
    );
    const mine = await exportBuyerData(who);
    expect(mine.serviceRequests).toEqual([
      expect.objectContaining({
        shop: 'Florería Solicitudes',
        number: sent.numberLabel,
        kind: 'EVENT',
        status: 'NEW',
        message: SECRET_NOTE,
        currency: 'MXN',
      }),
    ]);
  });
});
