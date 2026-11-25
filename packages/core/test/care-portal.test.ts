import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withPortalContext, withSystemContext } from '@floral/db';
import { createTestUser, type TestUser } from '@floral/db/testing';
import { addDays, dayOfWeek, todayInTimeZone, toIsoDate, type CalendarDate } from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  MemoryStorage,
  NotFoundError,
  acceptCarePortalInvite,
  addCarePlant,
  addCareVisitPhoto,
  addCustomerAddress,
  changeMyCareVisitDate,
  confirmCareContract,
  createCareBlock,
  createCareContract,
  createCareSlot,
  createCustomer,
  endCareContract,
  exportBuyerData,
  finishCareVisit,
  getCarePortalInvitePreview,
  getCarePortalPanel,
  getCareSettings,
  getCustomerCarePortalSummary,
  getMyCareCharge,
  getMyCareContract,
  getMyCarePhoto,
  getMyCareVisitDateOptions,
  getMyCareVisitReport,
  hasBuyerAccount,
  inviteCarePortal,
  listMyCareContracts,
  markAllCarePlantsOk,
  moveCareVisit,
  previewCareBlock,
  purgeDeletedTenants,
  removeCareVisitPhoto,
  requestTenantDeletion,
  resendCarePortalInvite,
  revokeCarePortalAccess,
  revokeCarePortalInvite,
  setCustomerArchived,
  setObjectStorage,
  startCareVisit,
  updateCareSettings,
  updatePrimaryLocation,
  type BuyerContext,
  type CarePortalDeps,
  type MyCareChangeDeps,
  type TenantContext,
} from '../src/index';
import { runCareMaintenance } from '../src/jobs/care';
import { contextFor, createTestShop, type TestShop } from '../src/testing';

/**
 * Floral Care, blocco 5a (ADR-084): la pagina del cliente. Inviti (email, link, limiti, permessi),
 * accettazione con la stessa email, cosa vede la persona (contratto, visite, piante, soldi solo
 * se scelto), isolamento fra contratti, clienti e fiorerie, "Cambiar fecha" con le regole del
 * contratto e l'avviso alla fioreria, concorrenza, revoche, sola lettura dopo la fine, dati della
 * persona.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const STAMP = Date.now().toString(36);
const today = (): CalendarDate => todayInTimeZone(TZ);
const iso = (date: CalendarDate) => toIsoDate(date);
const dayOf = (date: Date): CalendarDate => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

const mailer = new MemoryMailer();
const deps: CarePortalDeps = {
  mailer,
  appUrl: 'https://gardelia.example.test',
  secret: 'p'.repeat(48),
};
const changeDeps: MyCareChangeDeps = {
  mailer,
  visitUrl: (slug, visitId) => `https://gardelia.example.test/app/${slug}/agenda/visits/${visitId}`,
};

let shop: TestShop;
let live: { owner: TenantContext; manager: TenantContext; staff: TenantContext };
let other: TestShop;

const slotsUsed = new Map<string, number>();

async function nextSlot(ctx: TenantContext, weekday: number, capacity = 2): Promise<string> {
  const index = (slotsUsed.get(ctx.tenantId) ?? 0) + 1;
  slotsUsed.set(ctx.tenantId, index);
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const slot = await createCareSlot(ctx, {
    weekday: String(weekday),
    start: time(300 + index * 20),
    end: time(300 + index * 20 + 20),
    capacity: String(capacity),
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
    placeId: `ChIJ_portal_${ctx.tenantSlug}`,
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
    termsText: 'Avisar con un día de anticipación.',
  });
}

interface Kit {
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly slotId: string;
  readonly visits: readonly { readonly id: string; readonly date: CalendarDate }[];
}

async function newCustomer(ctx: TenantContext, name: string) {
  const customer = await createCustomer(ctx, {
    type: 'COMPANY',
    displayName: name,
    legalName: null,
    taxId: null,
    email: `cliente-${STAMP}-${name.replace(/\W/g, '').toLowerCase()}@portal.example.test`,
    phone: '+524495550177',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });
  return customer.id;
}

/** Un contratto settimanale confermato che parte `startOffset` giorni da oggi, nella sua fascia. */
async function newContract(
  ctx: TenantContext,
  name: string,
  options: {
    readonly startOffset?: number;
    readonly customerId?: string;
    readonly slotId?: string;
  } = {},
): Promise<Kit> {
  const start = addDays(today(), options.startOffset ?? 2);
  const slotId = options.slotId ?? (await nextSlot(ctx, dayOfWeek(start)));
  const customerId = options.customerId ?? (await newCustomer(ctx, name));
  const place = await addCustomerAddress(ctx, customerId, {
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
  const contract = await createCareContract(ctx, customerId, {
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
  await addCarePlant(ctx, contract.id, { name: 'Potos', quantity: '4', size: 'MEDIUM' });
  await confirmCareContract(ctx, contract.id);
  return {
    customerId,
    subscriptionId: contract.id,
    slotId,
    visits: await scheduledVisits(contract.id),
  };
}

async function scheduledVisits(subscriptionId: string) {
  const rows = await withSystemContext(db, { reason: 'test: visite' }, (tx) =>
    tx.careVisit.findMany({
      where: { subscriptionId, isExtra: false, status: 'SCHEDULED' },
      orderBy: { scheduledDate: 'asc' },
      select: { id: true, scheduledDate: true },
    }),
  );
  return rows.map((row) => ({ id: row.id, date: dayOf(row.scheduledDate!) }));
}

async function visitRow(id: string) {
  return withSystemContext(db, { reason: 'test: visita' }, (tx) =>
    tx.careVisit.findUniqueOrThrow({ where: { id } }),
  );
}

function tokenOf(url: string): string {
  return url.split('/').pop() ?? '';
}

/** Una persona con il suo conto, invitata e già dentro (accesso a un contratto o a tutti). */
async function personWithAccess(
  ctx: TenantContext,
  kit: Kit,
  options: { readonly scope?: 'CONTRACT' | 'CUSTOMER'; readonly money?: boolean } = {},
): Promise<{ user: TestUser; buyer: BuyerContext }> {
  const user = await createTestUser(db);
  const invite = await inviteCarePortal(
    ctx,
    kit.subscriptionId,
    {
      email: user.email,
      scope: options.scope ?? 'CONTRACT',
      ...(options.money === false ? {} : { canSeeMoney: 'on' }),
    },
    deps,
  );
  const buyer: BuyerContext = { userId: user.id, country: 'MX' };
  await acceptCarePortalInvite({
    secret: deps.secret,
    token: tokenOf(invite.url),
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

beforeAll(async () => {
  setObjectStorage(new MemoryStorage());
  shop = await createTestShop('Florería Portal');
  await withSystemContext(db, { reason: 'test: fioreria reale' }, (tx) =>
    tx.tenant.update({
      where: { id: shop.tenant.tenantId },
      data: { mode: 'LIVE', contactEmail: `contacto-${STAMP}@portal.example.test` },
    }),
  );
  live = {
    owner: await contextFor(shop.tenant.owner.id, shop.tenant.slug),
    manager: await contextFor(shop.managerUser.id, shop.tenant.slug),
    staff: await contextFor(shop.staffUser.id, shop.tenant.slug),
  };
  await setUpOffer(live.owner);
  other = await createTestShop('Florería Ajena');
  await setUpOffer(other.owner);
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('inviti dalla fioreria', () => {
  it('invita per email con il link; un invito nuovo per la stessa email sostituisce il primo', async () => {
    const kit = await newContract(live.owner, 'Hotel Jardín Invito');
    const email = `persona-${STAMP}@portal.example.test`;
    const first = await inviteCarePortal(
      live.owner,
      kit.subscriptionId,
      { email: email.toUpperCase(), scope: 'CONTRACT', canSeeMoney: 'on' },
      deps,
    );
    expect(first.emailSent).toBe(true);
    expect(first.url).toMatch(
      /^https:\/\/gardelia\.example\.test\/cuenta\/floral-care\/invitacion\//,
    );
    const sent = mailer.sent.filter((message) => message.to === email);
    expect(sent.at(-1)).toMatchObject({ category: 'care_portal_invite' });
    expect(sent.at(-1)?.text).toContain(first.url);

    const second = await inviteCarePortal(
      live.manager,
      kit.subscriptionId,
      { email, scope: 'CUSTOMER' },
      deps,
    );
    const panel = await getCarePortalPanel(live.owner, kit.subscriptionId, deps);
    expect(panel.invites.map((invite) => invite.id)).toEqual([second.inviteId]);
    expect(panel.invites[0]).toMatchObject({
      email,
      scope: 'CUSTOMER',
      canSeeMoney: false,
      status: 'PENDING',
      url: second.url,
    });
    expect((await getCarePortalInvitePreview(deps.secret, tokenOf(first.url)))?.status).toBe(
      'REVOKED',
    );
    // Nel registro niente email.
    const audit = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: shop.tenant.tenantId, action: 'care.portal_invited' },
        select: { metadata: true },
      }),
    );
    expect(JSON.stringify(audit)).not.toContain(email);
  });

  it('lo staff non invita; un borrador o un cliente archiviato non si invitano', async () => {
    const kit = await newContract(live.owner, 'Oficinas Permisos');
    await expect(
      inviteCarePortal(live.staff, kit.subscriptionId, { email: 'a@b.mx', scope: '' }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getCarePortalPanel(live.staff, kit.subscriptionId, deps)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const customerId = await newCustomer(live.owner, 'Clínica Borrador');
    const place = await addCustomerAddress(live.owner, customerId, {
      label: 'Sede',
      recipientName: '',
      recipientPhone: '',
      addressLine1: 'Calle 2',
      addressLine2: '',
      neighborhood: '',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      deliveryNotes: '',
    });
    const draft = await createCareContract(live.owner, customerId, {
      customerAddressId: place.id,
      frequency: 'WEEKLY',
      slotIds: [kit.slotId],
      startDate: iso(addDays(today(), 3)),
      seats: '',
      serviceIds: [],
      contactName: '',
      contactPhone: '',
      accessNotes: '',
      notes: '',
      outOfRangeConfirmed: '',
    });
    await expect(
      inviteCarePortal(live.owner, draft.id, { email: 'a@b.mx', scope: '' }, deps),
    ).rejects.toThrow(new ConflictError('care_portal_contract_not_open'));
    await setCustomerArchived(live.owner, kit.customerId, true);
    await expect(
      inviteCarePortal(live.owner, kit.subscriptionId, { email: 'a@b.mx', scope: '' }, deps),
    ).rejects.toThrow(new ConflictError('care_portal_customer_archived'));
  });

  it('da una fioreria demo non parte l’email, ma il link sì; "Reenviar" e "Revocar"', async () => {
    const kit = await newContract(other.owner, 'Demo Sin Correo');
    const before = mailer.sent.length;
    const invite = await inviteCarePortal(
      other.owner,
      kit.subscriptionId,
      { email: `demo-${STAMP}@portal.example.test`, scope: 'CONTRACT' },
      deps,
    );
    expect(invite.emailSent).toBe(false);
    expect(mailer.sent.length).toBe(before);
    const again = await resendCarePortalInvite(other.owner, invite.inviteId, deps);
    expect(again.inviteId).not.toBe(invite.inviteId);
    await revokeCarePortalInvite(other.owner, again.inviteId);
    expect((await getCarePortalInvitePreview(deps.secret, tokenOf(again.url)))?.status).toBe(
      'REVOKED',
    );
    await expect(revokeCarePortalInvite(other.owner, again.inviteId)).rejects.toThrow(
      new ConflictError('care_portal_invite_not_pending'),
    );
  });
});

describe('accettare l’invito', () => {
  it('solo con la stessa email; nasce l’accesso, il conto cliente si apre, un secondo clic no', async () => {
    const kit = await newContract(live.owner, 'Corporativo Aceptar');
    const person = await createTestUser(db);
    const intruder = await createTestUser(db);
    const invite = await inviteCarePortal(
      live.owner,
      kit.subscriptionId,
      { email: person.email, scope: 'CONTRACT', canSeeMoney: 'on' },
      deps,
    );
    const token = tokenOf(invite.url);
    await expect(
      acceptCarePortalInvite({
        secret: deps.secret,
        token,
        buyer: { userId: intruder.id, country: 'MX' },
        userEmail: intruder.email,
      }),
    ).rejects.toThrow(new ConflictError('care_portal_email_mismatch'));
    await expect(
      acceptCarePortalInvite({
        secret: deps.secret,
        token: `${token.slice(0, -2)}xx`,
        buyer: { userId: person.id, country: 'MX' },
        userEmail: person.email,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const buyer: BuyerContext = { userId: person.id, country: 'MX' };
    expect(await hasBuyerAccount(buyer)).toBe(false);
    const accepted = await acceptCarePortalInvite({
      secret: deps.secret,
      token,
      buyer,
      userEmail: person.email,
    });
    expect(accepted).toEqual({ subscriptionId: kit.subscriptionId });
    expect(await hasBuyerAccount(buyer)).toBe(true);
    expect(
      await acceptCarePortalInvite({ secret: deps.secret, token, buyer, userEmail: person.email }),
    ).toEqual({ subscriptionId: kit.subscriptionId });
    const list = await listMyCareContracts(buyer);
    expect(list.map((item) => item.subscriptionId)).toEqual([kit.subscriptionId]);
    expect(list[0]).toMatchObject({
      shopName: 'Florería Portal',
      readOnly: false,
      canSeeMoney: true,
    });
    const panel = await getCarePortalPanel(live.owner, kit.subscriptionId, deps);
    expect(panel.people).toEqual([
      expect.objectContaining({ email: person.email, scope: 'CONTRACT', canSeeMoney: true }),
    ]);
    expect(await getCustomerCarePortalSummary(live.owner, kit.customerId)).toEqual({
      people: 1,
      pendingInvites: 0,
    });
    expect(await getCustomerCarePortalSummary(live.staff, kit.customerId)).toBeNull();
  });

  it('un invito scaduto non si accetta', async () => {
    const kit = await newContract(live.owner, 'Hotel Vencido');
    const person = await createTestUser(db);
    const invite = await inviteCarePortal(
      live.owner,
      kit.subscriptionId,
      { email: person.email, scope: 'CONTRACT' },
      deps,
    );
    await withSystemContext(db, { reason: 'test: scadenza' }, (tx) =>
      tx.carePortalInvite.update({
        where: { id: invite.inviteId },
        data: {
          createdAt: new Date(Date.now() - 9 * 86_400_000),
          expiresAt: new Date(Date.now() - 1000),
        },
      }),
    );
    expect((await getCarePortalInvitePreview(deps.secret, tokenOf(invite.url)))?.status).toBe(
      'EXPIRED',
    );
    await expect(
      acceptCarePortalInvite({
        secret: deps.secret,
        token: tokenOf(invite.url),
        buyer: { userId: person.id, country: 'MX' },
        userEmail: person.email,
      }),
    ).rejects.toThrow(new ConflictError('care_portal_invite_expired'));
  });
});

describe('cosa vede la persona', () => {
  it('un contratto solo o tutti; mai un altro cliente o un’altra fioreria (404)', async () => {
    const first = await newContract(live.owner, 'Cadena Sedes Norte');
    const second = await newContract(live.owner, 'Cadena Sedes Sur', {
      customerId: first.customerId,
    });
    const stranger = await newContract(live.owner, 'Vecino Ajeno');
    const foreign = await newContract(other.owner, 'Otra Florería Cliente');
    const onlyOne = await personWithAccess(live.owner, first);
    const all = await personWithAccess(live.owner, first, { scope: 'CUSTOMER' });

    expect((await listMyCareContracts(onlyOne.buyer)).map((item) => item.subscriptionId)).toEqual([
      first.subscriptionId,
    ]);
    expect(
      (await listMyCareContracts(all.buyer)).map((item) => item.subscriptionId).sort(),
    ).toEqual([first.subscriptionId, second.subscriptionId].sort());
    await expect(getMyCareContract(onlyOne.buyer, second.subscriptionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    for (const id of [stranger.subscriptionId, foreign.subscriptionId, crypto.randomUUID()]) {
      await expect(getMyCareContract(all.buyer, id)).rejects.toBeInstanceOf(NotFoundError);
    }
    // Una visita o una foto di un altro contratto, passando dal proprio: 404 e null.
    await expect(
      getMyCareVisitReport(all.buyer, first.subscriptionId, stranger.visits[0]!.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getMyCareVisitDateOptions(all.buyer, first.subscriptionId, stranger.visits[0]!.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await getMyCarePhoto(all.buyer, first.subscriptionId, crypto.randomUUID(), 'full'),
    ).toBeNull();

    const contract = await getMyCareContract(onlyOne.buyer, first.subscriptionId);
    expect(contract).toMatchObject({
      numberLabel: expect.stringMatching(/^SUS-/),
      status: 'ACTIVE',
      readOnly: false,
      canSeeMoney: true,
      customerName: 'Cadena Sedes Norte',
      frequency: 'WEEKLY',
      rules: { minNoticeHours: 24, lateCancelHours: 12, missedVisitPolicy: 'COUNTS' },
      termsText: 'Avisar con un día de anticipación.',
      photosDeleteOn: null,
    });
    expect(contract.price?.perVisitMinor).toBeGreaterThan(0);
    expect(contract.charges).not.toBeNull();
    expect(contract.upcoming[0]).toMatchObject({ id: first.visits[0]!.id, canChange: true });
    expect(contract.plants.length).toBeGreaterThan(0);

    // Dalla fioreria A, un accesso della fioreria B non esiste.
    const foreignPerson = await personWithAccess(other.owner, foreign);
    const foreignAccess = await withSystemContext(db, { reason: 'test: accesso' }, (tx) =>
      tx.carePortalAccess.findFirstOrThrow({ where: { userId: foreignPerson.user.id } }),
    );
    await expect(revokeCarePortalAccess(live.owner, foreignAccess.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('senza "Puede ver precios y cobros" niente prezzi, né cargos (neanche dal database)', async () => {
    const kit = await newContract(live.owner, 'Recepción Sin Dinero');
    const person = await personWithAccess(live.owner, kit, { money: false });
    const contract = await getMyCareContract(person.buyer, kit.subscriptionId);
    expect(contract.canSeeMoney).toBe(false);
    expect(contract.price).toBeNull();
    expect(contract.charges).toBeNull();
    expect(contract.services.every((service) => service.priceMinor === null)).toBe(true);
    const [list] = await listMyCareContracts(person.buyer);
    expect(list?.dueMinor).toBeNull();
    const charge = await withSystemContext(db, { reason: 'test: cargo' }, (tx) =>
      tx.careCharge.findFirst({
        where: { subscriptionId: kit.subscriptionId },
        select: { id: true },
      }),
    );
    if (charge) {
      await expect(
        getMyCareCharge(person.buyer, kit.subscriptionId, charge.id),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    const counted = await withPortalContext(
      db,
      { userId: person.user.id, subscriptionId: kit.subscriptionId },
      (tx) => tx.careCharge.count(),
    );
    expect(counted).toBe(0);
  });

  it('il resoconto con chi è venuto e le foto; una foto tolta non si vede più', async () => {
    const kit = await newContract(live.owner, 'Clínica Reporte', { startOffset: 0 });
    const person = await personWithAccess(live.owner, kit);
    const visitId = kit.visits[0]!.id;
    await startCareVisit(live.staff, visitId);
    const photo = await addCareVisitPhoto(live.staff, visitId, await jpeg(), {
      uploadKey: crypto.randomUUID(),
    });
    await markAllCarePlantsOk(live.staff, visitId);
    await finishCareVisit(live.staff, visitId, {}, null);
    const report = await getMyCareVisitReport(person.buyer, kit.subscriptionId, visitId);
    expect(report.report).toMatchObject({ status: 'DONE', visitedBy: expect.any(String) });
    expect(report.report.photos.map((item) => item.id)).toEqual([photo.id]);
    const image = await getMyCarePhoto(person.buyer, kit.subscriptionId, photo.id, 'thumb');
    expect(image?.bytes.length).toBeGreaterThan(0);
    const contract = await getMyCareContract(person.buyer, kit.subscriptionId);
    expect(contract.past[0]).toMatchObject({ id: visitId, hasReport: true });
    await removeCareVisitPhoto(live.owner, visitId, photo.id);
    expect(await getMyCarePhoto(person.buyer, kit.subscriptionId, photo.id, 'full')).toBeNull();
  });
});

describe('"Cambiar fecha"', () => {
  it('solo fra le fasce libere dello stesso mese; la fioreria lo sa e lo vede', async () => {
    const kit = await newContract(live.owner, 'Hotel Cambio');
    const person = await personWithAccess(live.owner, kit);
    const visit = kit.visits[0]!;
    const later = await nextSlot(live.owner, dayOfWeek(visit.date));
    const options = await getMyCareVisitDateOptions(person.buyer, kit.subscriptionId, visit.id);
    expect(options.problem).toBeNull();
    expect(options.options).toContainEqual(
      expect.objectContaining({ date: iso(visit.date), slotId: later }),
    );
    expect(
      options.options.every((option) => option.date.slice(0, 7) === iso(visit.date).slice(0, 7)),
    ).toBe(true);
    expect(
      options.options.some(
        (option) => option.date === iso(visit.date) && option.slotId === kit.slotId,
      ),
    ).toBe(false);

    const before = mailer.sent.length;
    await changeMyCareVisitDate(
      person.buyer,
      kit.subscriptionId,
      visit.id,
      { date: iso(visit.date), slotId: later },
      changeDeps,
    );
    const moved = await visitRow(visit.id);
    expect(moved.slotId).toBe(later);
    expect(moved.customerMovedAt).toBeInstanceOf(Date);
    const notices = mailer.sent.slice(before);
    expect(notices.map((message) => message.category)).toEqual([
      'care_visit_moved_by_customer',
      'care_visit_moved_by_customer',
    ]);
    expect(notices[0]?.text).toContain(`/agenda/visits/${visit.id}`);
    const audit = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityId: visit.id, action: 'care.visit_moved_by_customer' },
      }),
    );
    expect(audit).toMatchObject({
      actorUserId: person.user.id,
      metadata: expect.objectContaining({ source: 'portal' }),
    });
    expect((await getMyCareContract(person.buyer, kit.subscriptionId)).upcoming[0]).toMatchObject({
      changedByCustomer: true,
    });
    // La fioreria la sposta di nuovo: il segno si toglie.
    await moveCareVisit(live.owner, visit.id, {
      placement: 'SLOT',
      date: iso(visit.date),
      slotId: kit.slotId,
      customerNotified: 'on',
    });
    expect((await visitRow(visit.id)).customerMovedAt).toBeNull();
  });

  it('rifiuta un altro mese, lo stesso posto, un giorno con un’altra visita, un giorno bloccato e il preavviso', async () => {
    const kit = await newContract(live.owner, 'Oficinas Reglas');
    const person = await personWithAccess(live.owner, kit);
    const visit = kit.visits[0]!;
    const sameMonthPair = kit.visits.find(
      (item, index) =>
        index > 0 &&
        kit.visits[index - 1]!.date.month === item.date.month &&
        kit.visits[index - 1]!.date.year === item.date.year,
    )!;
    const pairFirst = kit.visits[kit.visits.indexOf(sameMonthPair) - 1]!;
    const extraSlot = await nextSlot(live.owner, dayOfWeek(visit.date));
    const nextMonth = kit.visits.find(
      (item) => item.date.month !== visit.date.month || item.date.year !== visit.date.year,
    )!;
    const change = (visitId: string, date: CalendarDate, slotId: string) =>
      changeMyCareVisitDate(
        person.buyer,
        kit.subscriptionId,
        visitId,
        { date: iso(date), slotId },
        changeDeps,
      );

    await expect(change(visit.id, nextMonth.date, extraSlot)).rejects.toMatchObject({
      fieldErrors: { date: 'care_portal_move_other_month' },
    });
    await expect(change(visit.id, visit.date, kit.slotId)).rejects.toMatchObject({
      fieldErrors: { slotId: 'care_portal_move_same' },
    });
    await expect(change(pairFirst.id, sameMonthPair.date, extraSlot)).rejects.toMatchObject({
      fieldErrors: { date: 'care_portal_move_busy_day' },
    });
    const blockInput = {
      startDate: iso(visit.date),
      endDate: iso(visit.date),
      slotId: extraSlot,
      label: 'Capacitación',
      action: 'MOVE',
    };
    const preview = await previewCareBlock(live.owner, blockInput);
    await createCareBlock(
      live.owner,
      { ...blockInput, plan: preview.plan, customerNotified: 'on' },
      deps,
    );
    await expect(change(visit.id, visit.date, extraSlot)).rejects.toMatchObject({
      fieldErrors: { slotId: 'care_day_blocked' },
    });
    await withSystemContext(db, { reason: 'test: preavviso' }, (tx) =>
      tx.customerSubscription.update({
        where: { id: kit.subscriptionId },
        data: { minNoticeHours: 168 },
      }),
    );
    await expect(change(visit.id, visit.date, extraSlot)).rejects.toThrow(
      new ConflictError('care_portal_move_notice'),
    );
    const options = await getMyCareVisitDateOptions(person.buyer, kit.subscriptionId, visit.id);
    expect(options).toMatchObject({ problem: 'care_portal_move_notice', options: [] });
  });

  it('due clienti per l’ultimo posto: uno solo lo prende, senza stalli; insieme alla fioreria e alla fine', async () => {
    const weekday = dayOfWeek(addDays(today(), 3));
    const shared = await nextSlot(live.owner, weekday, 2);
    const last = await nextSlot(live.owner, weekday, 1);
    const first = await newContract(live.owner, 'Carrera Uno', { startOffset: 3, slotId: shared });
    const second = await newContract(live.owner, 'Carrera Dos', { startOffset: 3, slotId: shared });
    const p1 = await personWithAccess(live.owner, first);
    const p2 = await personWithAccess(live.owner, second);
    const day = first.visits[0]!.date;
    const results = await Promise.allSettled([
      changeMyCareVisitDate(
        p1.buyer,
        first.subscriptionId,
        first.visits[0]!.id,
        { date: iso(day), slotId: last },
        changeDeps,
      ),
      changeMyCareVisitDate(
        p2.buyer,
        second.subscriptionId,
        second.visits[0]!.id,
        { date: iso(day), slotId: last },
        changeDeps,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toEqual(
      new ConflictError('care_slot_full'),
    );

    // Il cliente e la fioreria spostano la stessa visita insieme; il cliente e la fine del contratto.
    const third = await newContract(live.owner, 'Carrera Tres');
    const p3 = await personWithAccess(live.owner, third);
    const target = await nextSlot(live.owner, dayOfWeek(third.visits[0]!.date));
    const together = await Promise.allSettled([
      changeMyCareVisitDate(
        p3.buyer,
        third.subscriptionId,
        third.visits[0]!.id,
        { date: iso(third.visits[0]!.date), slotId: target },
        changeDeps,
      ),
      moveCareVisit(live.owner, third.visits[0]!.id, {
        placement: 'SLOT',
        date: iso(third.visits[1]!.date),
        slotId: third.slotId,
        customerNotified: 'on',
      }),
      endCareContract(live.owner, third.subscriptionId, {
        endDate: iso(addDays(third.visits[2]!.date, 1)),
        customerNotified: 'on',
      }),
    ]);
    for (const result of together) {
      if (result.status === 'rejected') {
        expect(result.reason).not.toMatchObject({ code: 'P2034' });
        expect(String(result.reason)).not.toMatch(/deadlock/i);
      }
    }
  });
});

describe('revoche, fine del contratto e dati della persona', () => {
  it('"Quitar acceso" e il cliente archiviato chiudono l’accesso', async () => {
    const kit = await newContract(live.owner, 'Hotel Quitar');
    const person = await personWithAccess(live.owner, kit);
    const panel = await getCarePortalPanel(live.owner, kit.subscriptionId, deps);
    await revokeCarePortalAccess(live.owner, panel.people[0]!.accessId);
    await expect(getMyCareContract(person.buyer, kit.subscriptionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const archived = await newContract(live.owner, 'Hotel Archivado');
    const guest = await personWithAccess(live.owner, archived);
    const pending = await inviteCarePortal(
      live.owner,
      archived.subscriptionId,
      { email: `pendiente-${STAMP}@portal.example.test`, scope: 'CUSTOMER' },
      deps,
    );
    await setCustomerArchived(live.owner, archived.customerId, true);
    expect(await listMyCareContracts(guest.buyer)).toEqual([]);
    const rows = await withSystemContext(db, { reason: 'test: accessi' }, (tx) =>
      tx.carePortalAccess.findMany({ where: { customerId: archived.customerId } }),
    );
    expect(rows.map((row) => row.revokedReason)).toEqual(['CUSTOMER_ARCHIVED']);
    expect((await getCarePortalInvitePreview(deps.secret, tokenOf(pending.url)))?.status).toBe(
      'REVOKED',
    );
  });

  it('finito resta in sola lettura 30 giorni, poi il lavoro chiude l’accesso', async () => {
    const kit = await newContract(live.owner, 'Clínica Fin');
    const person = await personWithAccess(live.owner, kit);
    const pending = await inviteCarePortal(
      live.owner,
      kit.subscriptionId,
      { email: `tarde-${STAMP}@portal.example.test`, scope: 'CONTRACT' },
      deps,
    );
    // Il contratto è partito dieci giorni fa e finisce ieri: si chiude subito.
    const began = addDays(today(), -10);
    await withSystemContext(db, { reason: 'test: inizio passato' }, (tx) =>
      tx.customerSubscription.update({
        where: { id: kit.subscriptionId },
        data: { startDate: new Date(Date.UTC(began.year, began.month - 1, began.day)) },
      }),
    );
    await endCareContract(live.owner, kit.subscriptionId, {
      endDate: iso(addDays(today(), -1)),
      customerNotified: 'on',
    });
    expect((await getCarePortalInvitePreview(deps.secret, tokenOf(pending.url)))?.status).toBe(
      'REVOKED',
    );
    const ended = await getMyCareContract(person.buyer, kit.subscriptionId);
    expect(ended).toMatchObject({
      status: 'ENDED',
      readOnly: true,
      photosDeleteOn: iso(addDays(today(), 29)),
    });
    await expect(
      changeMyCareVisitDate(
        person.buyer,
        kit.subscriptionId,
        kit.visits[0]!.id,
        { date: iso(kit.visits[0]!.date), slotId: kit.slotId },
        changeDeps,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const past = addDays(today(), -31);
    await withSystemContext(db, { reason: 'test: fine lontana' }, (tx) =>
      tx.customerSubscription.update({
        where: { id: kit.subscriptionId },
        data: {
          startDate: new Date(Date.UTC(past.year, past.month - 1, past.day - 7)),
          endDate: new Date(Date.UTC(past.year, past.month - 1, past.day)),
        },
      }),
    );
    expect(await listMyCareContracts(person.buyer)).toEqual([]);
    const result = await runCareMaintenance(null);
    expect(result.portalAccessClosed).toBeGreaterThanOrEqual(1);
    const access = await withSystemContext(db, { reason: 'test: accesso' }, (tx) =>
      tx.carePortalAccess.findFirstOrThrow({ where: { userId: person.user.id } }),
    );
    expect(access.revokedReason).toBe('CONTRACT_ENDED');
  });

  it('una fioreria cancellata davvero porta via inviti e accessi (la persona resta)', async () => {
    const gone = await createTestShop('Florería Portal Que Se Va');
    await setUpOffer(gone.owner);
    const kit = await newContract(gone.owner, 'Cliente De Una Florería Que Se Va');
    const person = await personWithAccess(gone.owner, kit);
    await inviteCarePortal(
      gone.owner,
      kit.subscriptionId,
      { email: `espera-${STAMP}@portal.example.test`, scope: 'CUSTOMER' },
      deps,
    );
    await requestTenantDeletion(gone.owner, { confirmName: 'Florería Portal Que Se Va' }, null);
    const past = new Date(Date.now() - 60_000);
    await withSystemContext(db, { reason: 'test: 30 giorni passati' }, (tx) =>
      tx.tenant.update({
        where: { id: gone.owner.tenantId },
        data: {
          deletionRequestedAt: new Date(past.getTime() - 31 * 86_400_000),
          deleteAfter: past,
        },
      }),
    );
    expect(await purgeDeletedTenants()).toBeGreaterThanOrEqual(1);
    const left = await withSystemContext(db, { reason: 'test: righe rimaste' }, async (tx) => ({
      invites: await tx.carePortalInvite.count({ where: { tenantId: gone.owner.tenantId } }),
      accesses: await tx.carePortalAccess.count({ where: { tenantId: gone.owner.tenantId } }),
      person: await tx.user.count({ where: { id: person.user.id } }),
    }));
    expect(left).toEqual({ invites: 0, accesses: 0, person: 1 });
  });

  it('"Descargar mis datos" ha gli accessi; eliminando il conto l’accesso sparisce', async () => {
    const kit = await newContract(live.owner, 'Hotel Datos');
    const person = await personWithAccess(live.owner, kit, { money: false });
    const data = await exportBuyerData(person.buyer);
    expect(data.floralCare.accesses).toEqual([
      expect.objectContaining({
        shop: 'Florería Portal',
        customer: 'Hotel Datos',
        contract: expect.stringMatching(/^SUS-/),
        canSeeMoney: false,
        closedAt: null,
      }),
    ]);
    await withSystemContext(db, { reason: 'test: conto eliminato' }, (tx) =>
      tx.user.delete({ where: { id: person.user.id } }),
    );
    const left = await withSystemContext(db, { reason: 'test: accessi' }, (tx) =>
      tx.carePortalAccess.count({ where: { userId: person.user.id } }),
    );
    expect(left).toBe(0);
  });
});
