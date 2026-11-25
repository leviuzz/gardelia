import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import {
  CARE_LIMITS,
  addDays,
  careVisitDates,
  dayOfWeek,
  isWeekday,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
} from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  ValidationError,
  addCarePlant,
  addCareTravelTier,
  addCustomerAddress,
  archiveCareSlot,
  assignCareVisit,
  cancelCareVisit,
  changeCareSchedule,
  confirmCareContract,
  createCareContract,
  createCareService,
  createCareSlot,
  createCustomer,
  discardCareContract,
  endCareContract,
  finishCareVisit,
  getCareAgendaDay,
  getCareAgendaMonth,
  getCareContract,
  getCareSettings,
  getCareSetupStatus,
  getCareVisitMoveOptions,
  listCareContracts,
  listCareVisitsToReschedule,
  markAllCarePlantsOk,
  markCareVisitNotDone,
  moveCareVisit,
  purgeDeletedTenants,
  repriceCareContract,
  requestTenantDeletion,
  runCareMaintenance,
  saveCareVisitNote,
  setCareServiceActive,
  setObjectStorage,
  startCareVisit,
  updateCareService,
  updateCareSettings,
  updateCareSlot,
  updatePrimaryLocation,
  type TenantContext,
} from '../src/index';
import { planSlotChange, type SlotVisitRow } from '../src/services/care-generation';
import { createTestShop, type TestShop } from '../src/testing';

/**
 * Floral Care, blocco 1 (ADR-075): offerta, contratti dal borrador alla conferma con il prezzo
 * del server, visite nelle fasce senza superare la capienza (anche con due conferme insieme),
 * "Sí, avisé al cliente" obbligatorio sui cambi che toccano visite, lavori automatici senza
 * utente e isolamento fra fiorerie.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const STORE = { latitude: 21.8818, longitude: -102.2916 };
/** Un punto a `km` a nord della tienda (~0.008993 gradi di latitudine per km). */
const north = (km: number) => ({
  latitude: STORE.latitude + km * 0.008993,
  longitude: STORE.longitude,
});

const today = (): CalendarDate => todayInTimeZone(TZ);
const iso = (date: CalendarDate) => toIsoDate(date);
const horizon = () => addDays(today(), CARE_LIMITS.generationDays);

let shop: TestShop;
let other: TestShop;
let customerId: string;
let addressId: string;
let farAddressId: string;
let tueSlot: string;
let todaySlot: string;
let wateringId: string;
let fertilizingId: string;

function settingsInput(overrides: Record<string, unknown> = {}) {
  return {
    visitFee: '450',
    careFeeSmall: '10',
    careFeeMedium: '20',
    careFeeLarge: '40',
    frequencies: ['MONTHLY_1', 'MONTHLY_2', 'WEEKLY'],
    maxDistanceKm: '20',
    minNoticeHours: '24',
    missedVisitPolicy: 'COUNTS',
    deadPlantPolicy: 'QUOTE',
    termsText: '',
    ...overrides,
  };
}

function slotInput(weekday: number, start: string, end: string, capacity: number) {
  return { weekday: String(weekday), start, end, capacity: String(capacity) };
}

function contractInput(overrides: Record<string, unknown> = {}) {
  return {
    customerAddressId: addressId,
    frequency: 'MONTHLY_2',
    slotIds: [tueSlot],
    startDate: iso(today()),
    seats: '',
    serviceIds: [wateringId, fertilizingId],
    contactName: 'Recepción',
    contactPhone: '',
    accessNotes: 'Gafete en recepción',
    notes: '',
    outOfRangeConfirmed: '',
    ...overrides,
  };
}

function address(point: { latitude: number; longitude: number }, placeId: string) {
  return {
    label: 'Oficina',
    recipientName: '',
    recipientPhone: '',
    addressLine1: 'Av. Universidad 100',
    addressLine2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryNotes: '',
    placeId,
    latitude: String(point.latitude),
    longitude: String(point.longitude),
  };
}

function customerInput(name: string) {
  return {
    type: 'COMPANY',
    displayName: name,
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550142',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  };
}

async function newCustomer(
  ctx: TenantContext,
  name: string,
  km = 3,
): Promise<{
  customerId: string;
  addressId: string;
}> {
  const created = await createCustomer(ctx, customerInput(name));
  const place = await addCustomerAddress(
    ctx,
    created.id,
    address(north(km), `ChIJ_${name.replace(/\W/g, '')}_${km}`),
  );
  return { customerId: created.id, addressId: place.id };
}

async function visitsOf(tenantId: string, subscriptionId: string) {
  return withSystemContext(db, { reason: 'test: visite di un contratto' }, (tx) =>
    tx.careVisit.findMany({
      where: { tenantId, subscriptionId },
      orderBy: [{ originalDate: 'asc' }, { createdAt: 'asc' }],
    }),
  );
}

/** Nessuna fascia ha più posti occupati della sua capienza, in nessun giorno. */
async function overbooked(tenantId: string): Promise<number> {
  const rows = await withSystemContext(
    db,
    { reason: 'test: capienza delle fasce' },
    (tx) =>
      tx.$queryRaw<{ over: bigint }[]>`
      SELECT count(*) AS over FROM (
        SELECT v."slotId", v."scheduledDate", sum(v.seats) AS used, s.capacity
        FROM "CareVisit" v JOIN "CareSlot" s ON s.id = v."slotId"
        WHERE v."tenantId" = ${tenantId}::uuid
          AND v.status IN ('SCHEDULED', 'IN_PROGRESS', 'DONE', 'NOT_DONE')
        GROUP BY v."slotId", v."scheduledDate", s.capacity
      ) t WHERE t.used > t.capacity`,
  );
  return Number(rows[0]?.over ?? 0);
}

async function setUpShop(target: TestShop, name: string): Promise<void> {
  await updatePrimaryLocation(target.owner, {
    addressLine1: 'Av. Madero 1',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryRadiusKm: '15',
    placeId: `ChIJ_tienda_${name}`,
    latitude: String(STORE.latitude),
    longitude: String(STORE.longitude),
  });
}

beforeAll(async () => {
  shop = await createTestShop('Florería Cuidado');
  other = await createTestShop('Florería Cuidado Ajena');
  await setUpShop(shop, 'cuidado');
  await setUpShop(other, 'ajena');
  ({ customerId, addressId } = await newCustomer(shop.owner, 'Hotel Jardín'));
  farAddressId = (
    await addCustomerAddress(shop.owner, customerId, address(north(30), 'ChIJ_hotel_lejos'))
  ).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe('offerta della fioreria', () => {
  it('prima va salvata l’offerta; la prima volta crea i servizi inclusi della nostra lista', async () => {
    const before = await getCareSettings(shop.owner);
    expect(before).toMatchObject({ configured: false, maxDistanceKm: 15, hasOrigin: true });
    // Che cosa manca per il primo contratto: tutto (lo vede anche lo staff, senza poterlo fare).
    expect(await getCareSetupStatus(shop.staff)).toEqual({
      tariffsSaved: false,
      activeSlots: 0,
      frequencies: 0,
      ready: false,
      canWrite: false,
    });
    await expect(createCareSlot(shop.owner, slotInput(2, '09:00', '12:00', 2))).rejects.toThrow(
      new ConflictError('care_not_configured'),
    );
    await expect(updateCareSettings(shop.staff, settingsInput())).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    await updateCareSettings(shop.owner, settingsInput());
    const after = await getCareSettings(shop.staff);
    expect(after).toMatchObject({
      configured: true,
      visitFeeMinor: 45_000,
      careFees: { SMALL: 1_000, MEDIUM: 2_000, LARGE: 4_000 },
      maxDistanceKm: 20,
      canWrite: false,
    });
    expect(after.services.map((service) => service.presetKey)).toEqual([
      'watering',
      'leaf_cleaning',
      'pruning',
      'pest_check',
      'rotation',
      'pot_cleaning',
    ]);
    expect(after.suggestions.map((suggestion) => suggestion.key)).toEqual([
      'fertilizing',
      'substrate',
      'repotting',
    ]);
    wateringId = after.services.find((service) => service.presetKey === 'watering')!.id;
    // Le tarifas ci sono, manca ancora un horario de visita.
    expect(await getCareSetupStatus(shop.owner)).toMatchObject({
      tariffsSaved: true,
      activeSlots: 0,
      ready: false,
      canWrite: true,
    });
  });

  it('servizi extra con il prezzo del fiorista; la stessa proposta due volte no', async () => {
    fertilizingId = (
      await createCareService(shop.owner, {
        presetKey: 'fertilizing',
        name: 'Fertilización',
        pricing: 'EXTRA',
        unit: 'PER_PLANT',
        price: '5',
      })
    ).id;
    await expect(
      createCareService(shop.owner, {
        presetKey: 'fertilizing',
        name: 'Fertilización',
        pricing: 'EXTRA',
        unit: 'PER_PLANT',
        price: '6',
      }),
    ).rejects.toThrow(new ConflictError('care_service_exists'));
    await expect(
      createCareService(shop.owner, { name: 'Trasplante', pricing: 'EXTRA', unit: 'PER_PLANT' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('nomi dei servizi: principale in spagnolo, traduzioni per chi usa l’app in un’altra lingua', async () => {
    const inItalian: TenantContext = { ...shop.owner, locale: 'it-IT' };
    const settings = await getCareSettings(inItalian);
    const watering = settings.services.find((service) => service.presetKey === 'watering')!;
    expect(watering).toMatchObject({
      name: 'Riego',
      displayName: 'Irrigazione',
      translations: { 'it-IT': 'Irrigazione', 'en-US': 'Watering' },
    });
    // La proposta: nome principale nella lingua del mercato, scritta nella lingua di chi guarda.
    expect(settings.suggestions.find((suggestion) => suggestion.key === 'repotting')).toMatchObject(
      { name: 'Trasplante', displayName: 'Rinvaso', translations: { 'it-IT': 'Rinvaso' } },
    );
    // Il fertilizzante è stato aggiunto senza traduzioni: si vede il nome principale.
    expect(settings.services.find((service) => service.id === fertilizingId)).toMatchObject({
      displayName: 'Fertilización',
      translations: {},
    });

    // Un servizio scritto dal fiorista, con l'italiano; lo spagnolo è il nome principale.
    const custom = await createCareService(inItalian, {
      name: 'Limpieza profunda',
      translations: { 'it-IT': 'Pulizia profonda', 'es-MX': 'ignorado' },
      pricing: 'INCLUDED',
      unit: 'PER_VISIT',
    });
    const withCustom = await getCareSettings(inItalian);
    const saved = withCustom.services.find((service) => service.id === custom.id)!;
    expect(saved).toMatchObject({ name: 'Limpieza profunda', displayName: 'Pulizia profonda' });
    // Lo spagnolo è il nome principale: una «traduzione» in spagnolo non si salva.
    expect(saved.translations).toEqual({ 'it-IT': 'Pulizia profonda' });
    const inEnglish = await getCareSettings({ ...shop.owner, locale: 'en-US' });
    expect(inEnglish.services.find((service) => service.id === custom.id)?.displayName).toBe(
      'Limpieza profunda',
    );
    await expect(
      updateCareService(shop.owner, custom.id, {
        name: 'Limpieza profunda',
        translations: { 'it-IT': 'x'.repeat(CARE_LIMITS.serviceName + 1) },
        pricing: 'INCLUDED',
        unit: 'PER_VISIT',
      }),
    ).rejects.toMatchObject({ fieldErrors: { 'translations.it-IT': 'too_long' } });
    await setCareServiceActive(shop.owner, custom.id, false);
  });

  it('fasce di uscita e sovrapprezzo per distanza', async () => {
    tueSlot = (await createCareSlot(shop.owner, slotInput(2, '09:00', '12:00', 2))).id;
    todaySlot = (
      await createCareSlot(shop.owner, slotInput(dayOfWeek(today()), '07:00', '08:00', 3))
    ).id;
    await expect(createCareSlot(shop.owner, slotInput(2, '09:00', '12:00', 1))).rejects.toThrow(
      new ConflictError('care_slot_exists'),
    );
    await addCareTravelTier(shop.owner, { upToKm: '2', fee: '0' });
    await addCareTravelTier(shop.owner, { upToKm: '5', fee: '50' });
    const settings = await getCareSettings(shop.owner);
    expect(settings.travelTiers.map((tier) => tier.maxKm)).toEqual([2, 5]);
    expect(settings.slots.filter((slot) => slot.active)).toHaveLength(2);
    // Con tarifas e horarios si può fare il primo contratto.
    expect(await getCareSetupStatus(shop.owner)).toMatchObject({ activeSlots: 2, ready: true });
  });
});

describe('contratto: dalla bozza alla conferma', () => {
  let contractId: string;

  it('la bozza controlla sede, fasce e raggio', async () => {
    await expect(
      createCareContract(
        shop.owner,
        customerId,
        contractInput({ frequency: 'MONTHLY_1', slotIds: [tueSlot, todaySlot] }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { slotIds: 'care_one_slot' } });
    await expect(
      createCareContract(
        shop.owner,
        customerId,
        contractInput({ startDate: iso(addDays(today(), -1)) }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { startDate: 'care_start_out_of_range' } });
    await expect(
      createCareContract(
        shop.owner,
        customerId,
        contractInput({ customerAddressId: farAddressId }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { outOfRangeConfirmed: 'care_out_of_range' } });
    await expect(
      createCareContract(shop.staff, customerId, contractInput()),
    ).rejects.toBeInstanceOf(ForbiddenError);

    contractId = (await createCareContract(shop.owner, customerId, contractInput())).id;
    const draft = await getCareContract(shop.owner, contractId);
    expect(draft).toMatchObject({
      status: 'DRAFT',
      numberLabel: expect.stringMatching(/^SUS-\d{4}$/),
      frequency: 'MONTHLY_2',
      saved: null,
      current: null,
      upcomingCount: 0,
    });
    expect(draft.services.map((service) => service.serviceId).sort()).toEqual(
      [wateringId, fertilizingId].sort(),
    );

    // Il contratto copia nome e traduzioni: in italiano si legge «Irrigazione». Cambiando la
    // traduzione del servizio, la copia con lo stesso nome principale la segue.
    const italian: TenantContext = { ...shop.owner, locale: 'it-IT' };
    const nameIn = async (ctx: TenantContext) =>
      (await getCareContract(ctx, contractId)).services.find(
        (service) => service.serviceId === wateringId,
      )?.name;
    expect(await nameIn(italian)).toBe('Irrigazione');
    expect(await nameIn(shop.owner)).toBe('Riego');
    const wateringInput = (italianName: string) => ({
      name: 'Riego',
      translations: { 'it-IT': italianName, 'en-US': 'Watering' },
      pricing: 'INCLUDED',
      unit: 'PER_VISIT',
    });
    await updateCareService(shop.owner, wateringId, wateringInput('Annaffiatura'));
    expect(await nameIn(italian)).toBe('Annaffiatura');
    await updateCareService(shop.owner, wateringId, wateringInput('Irrigazione'));
    expect(await nameIn(italian)).toBe('Irrigazione');
  });

  it('senza piante non si conferma; con le piante il server calcola il prezzo', async () => {
    await expect(confirmCareContract(shop.owner, contractId)).rejects.toThrow(
      new ConflictError('care_no_plants'),
    );
    await addCarePlant(shop.owner, contractId, {
      name: 'Potos en jardinera',
      canonicalFlowerId: '',
      quantity: '10',
      size: 'MEDIUM',
      location: 'Lobby',
      light: 'MEDIUM',
      watering: '',
      instructions: 'Regar solo si la tierra está seca.',
    });
    await addCarePlant(shop.owner, contractId, {
      name: 'Palma kentia',
      canonicalFlowerId: '',
      quantity: '2',
      size: 'LARGE',
      location: 'Entrada',
      light: '',
      watering: '',
      instructions: '',
    });
    const draft = await getCareContract(shop.owner, contractId);
    // 450 + 50 (3 km) + 10×20 + 2×40 + 12×5 (fertilización por planta) = 840 pesos.
    expect(draft.current).toMatchObject({
      plantCount: 12,
      visitFeeMinor: 45_000,
      travelSurchargeMinor: 5_000,
      careMinor: 28_000,
      extrasMinor: 6_000,
      perVisitMinor: 84_000,
      oneTimeMinor: 0,
      monthly: { minMinor: 168_000, maxMinor: 168_000 },
    });
    expect(draft.travel).toMatchObject({ kind: 'in_range', distanceKm: 3 });
  });

  it('alla conferma copia il prezzo e crea le visite dei prossimi 60 giorni', async () => {
    const generated = await confirmCareContract(shop.owner, contractId);
    const expected = careVisitDates({
      frequency: 'MONTHLY_2',
      weekdays: [2],
      from: today(),
      until: horizon(),
    });
    expect(generated).toEqual({
      scheduled: expected.length,
      toReschedule: 0,
      cancelledByBlock: 0,
    });
    const contract = await getCareContract(shop.owner, contractId);
    expect(contract).toMatchObject({
      status: 'ACTIVE',
      saved: { perVisitMinor: 84_000, travelSurchargeMinor: 5_000 },
      priceOutdated: false,
      upcomingCount: expected.length,
    });
    const visits = await visitsOf(shop.tenant.tenantId, contractId);
    expect(visits.map((visit) => visit.scheduledDate?.toISOString().slice(0, 10))).toEqual(
      expected.map(iso),
    );
    expect(visits.every((visit) => visit.slotId === tueSlot && visit.startMinutes === 540)).toBe(
      true,
    );
    await expect(confirmCareContract(shop.owner, contractId)).rejects.toThrow(
      new ConflictError('care_contract_not_editable'),
    );
  });

  it('una pianta in più: il prezzo salvato resta, la scheda lo segnala, si aggiorna con avviso', async () => {
    await addCarePlant(shop.owner, contractId, {
      name: 'Suculenta',
      canonicalFlowerId: '',
      quantity: '1',
      size: 'SMALL',
      location: '',
      light: '',
      watering: '',
      instructions: '',
    });
    const outdated = await getCareContract(shop.owner, contractId);
    expect(outdated.priceOutdated).toBe(true);
    expect(outdated.current?.perVisitMinor).toBe(84_000 + 1_000 + 500);
    await expect(repriceCareContract(shop.owner, contractId, {})).rejects.toMatchObject({
      fieldErrors: { customerNotified: 'care_notice_required' },
    });
    expect(await repriceCareContract(shop.owner, contractId, { customerNotified: 'on' })).toEqual({
      changed: true,
    });
    const repriced = await getCareContract(shop.owner, contractId);
    expect(repriced).toMatchObject({
      priceVersion: 2,
      priceOutdated: false,
      saved: { perVisitMinor: 85_500 },
    });
  });

  it('nuovo calendario: senza "Sí, avisé al cliente" non si salva; poi sostituisce le visite', async () => {
    const before = await visitsOf(shop.tenant.tenantId, contractId);
    await expect(
      changeCareSchedule(shop.owner, contractId, {
        frequency: 'MONTHLY_1',
        slotIds: [tueSlot],
        startDate: iso(today()),
        seats: '',
      }),
    ).rejects.toMatchObject({ fieldErrors: { customerNotified: 'care_notice_required' } });
    const result = await changeCareSchedule(shop.owner, contractId, {
      frequency: 'MONTHLY_1',
      slotIds: [tueSlot],
      startDate: iso(today()),
      seats: '',
      customerNotified: 'on',
    });
    const expected = careVisitDates({
      frequency: 'MONTHLY_1',
      weekdays: [2],
      from: today(),
      until: horizon(),
    });
    expect(result).toEqual({
      cancelled: before.length,
      scheduled: expected.length,
      toReschedule: 0,
      cancelledByBlock: 0,
    });
    const after = await visitsOf(shop.tenant.tenantId, contractId);
    expect(after.filter((visit) => visit.status === 'CANCELLED')).toHaveLength(before.length);
    expect(
      after
        .filter((visit) => visit.status === 'CANCELLED')
        .every((visit) => visit.cancelReason === 'SCHEDULE_CHANGE' && visit.scheduleVersion === 1),
    ).toBe(true);
    expect(
      after
        .filter((visit) => visit.status === 'SCHEDULED')
        .every((visit) => visit.scheduleVersion === 2),
    ).toBe(true);
  });

  it('fuori dal raggio solo se il fiorista dice che va lo stesso: vale l’ultima fascia', async () => {
    const id = (
      await createCareContract(
        shop.owner,
        customerId,
        contractInput({ customerAddressId: farAddressId, outOfRangeConfirmed: 'on' }),
      )
    ).id;
    await addCarePlant(shop.owner, id, {
      name: 'Helechos',
      canonicalFlowerId: '',
      quantity: '4',
      size: 'SMALL',
      location: '',
      light: '',
      watering: '',
      instructions: '',
    });
    const draft = await getCareContract(shop.owner, id);
    expect(draft).toMatchObject({
      outOfRange: true,
      travel: { kind: 'out_of_range', maxKm: 20 },
      current: { travelSurchargeMinor: 5_000 },
    });
    await discardCareContract(shop.owner, id);
    const closed = await listCareContracts(shop.owner, { view: 'closed' });
    expect(closed.items.find((item) => item.id === id)?.status).toBe('CANCELLED');
  });
});

describe('visite: Agenda, "Hecha", spostare, cancellare, assegnare', () => {
  let weeklyId: string;

  beforeAll(async () => {
    const weekday = dayOfWeek(today());
    if (!isWeekday(weekday)) throw new Error('giorno della settimana non valido');
    const company = await newCustomer(shop.owner, 'Oficinas Sol');
    weeklyId = (
      await createCareContract(shop.owner, company.customerId, {
        ...contractInput({
          customerAddressId: company.addressId,
          frequency: 'WEEKLY',
          slotIds: [todaySlot],
          serviceIds: [wateringId],
        }),
      })
    ).id;
    await addCarePlant(shop.owner, weeklyId, {
      name: 'Sansevieria',
      canonicalFlowerId: '',
      quantity: '6',
      size: 'MEDIUM',
      location: '',
      light: '',
      watering: '',
      instructions: '',
    });
    await confirmCareContract(shop.owner, weeklyId);
  });

  it('il giorno mostra le fasce con i posti; il mese conta le visite', async () => {
    const day = await getCareAgendaDay(shop.staff, iso(today()));
    const group = day.groups.find((candidate) => candidate.slotId === todaySlot);
    expect(group).toMatchObject({ start: '07:00', end: '08:00', capacity: 3, used: 1 });
    expect(group?.visits[0]).toMatchObject({
      customerName: 'Oficinas Sol',
      plantCount: 6,
      status: 'SCHEDULED',
      canStart: true,
      canMarkNotDone: true,
      canManage: false,
    });
    const month = await getCareAgendaMonth(shop.owner, iso(today()).slice(0, 7));
    expect(month.days.find((entry) => entry.date === iso(today()))?.visits).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('lo staff fa la visita di oggi (Empezar → Todas bien → Terminar); una futura no', async () => {
    const visits = await visitsOf(shop.tenant.tenantId, weeklyId);
    const [first, second] = visits;
    await startCareVisit(shop.staff, first!.id);
    await markAllCarePlantsOk(shop.staff, first!.id);
    await saveCareVisitNote(shop.staff, first!.id, { note: 'Todo bien.' });
    expect(await finishCareVisit(shop.staff, first!.id, {}, null)).toEqual({
      alreadyClosed: false,
      report: 'not_requested',
    });
    expect(await finishCareVisit(shop.staff, first!.id, {}, null)).toMatchObject({
      alreadyClosed: true,
    });
    await expect(markCareVisitNotDone(shop.staff, second!.id, {}, null)).rejects.toThrow(
      new ConflictError('care_visit_future'),
    );
    await expect(startCareVisit(shop.staff, second!.id)).rejects.toThrow(
      new ConflictError('care_visit_future'),
    );
    const [done] = await visitsOf(shop.tenant.tenantId, weeklyId);
    expect(done).toMatchObject({
      status: 'DONE',
      outcomeNote: 'Todo bien.',
      closedById: shop.staff.userId,
      startedById: shop.staff.userId,
    });
  });

  it('spostare: solo chi gestisce, in una fascia con posto e con "Sí, avisé al cliente"', async () => {
    const visits = await visitsOf(shop.tenant.tenantId, weeklyId);
    const target = visits.find((visit) => visit.status === 'SCHEDULED')!;
    const { options } = await getCareVisitMoveOptions(shop.owner, target.id);
    const option = options.find((candidate) => candidate.slotId === tueSlot) ?? options[0]!;
    await expect(
      moveCareVisit(shop.staff, target.id, {
        date: option.date,
        slotId: option.slotId,
        customerNotified: 'on',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      moveCareVisit(shop.owner, target.id, { date: option.date, slotId: option.slotId }),
    ).rejects.toMatchObject({ fieldErrors: { customerNotified: 'care_notice_required' } });
    const wrongDay = iso(addDays(today(), dayOfWeek(today()) === 2 ? 1 : 0));
    await expect(
      moveCareVisit(shop.owner, target.id, {
        date: wrongDay,
        slotId: tueSlot,
        customerNotified: 'on',
      }),
    ).rejects.toMatchObject({ fieldErrors: { slotId: 'care_slot_weekday' } });
    await moveCareVisit(shop.owner, target.id, {
      date: option.date,
      slotId: option.slotId,
      customerNotified: 'on',
    });
    const moved = (await visitsOf(shop.tenant.tenantId, weeklyId)).find(
      (visit) => visit.id === target.id,
    );
    expect(moved?.scheduledDate?.toISOString().slice(0, 10)).toBe(option.date);
    expect(moved?.slotId).toBe(option.slotId);
  });

  it('cancellare dice chi l’ha tolta; assegnare non chiede avviso', async () => {
    const visits = await visitsOf(shop.tenant.tenantId, weeklyId);
    const open = visits.filter((visit) => visit.status === 'SCHEDULED');
    const [toCancel, toAssign] = open.slice(-2);
    await expect(
      cancelCareVisit(shop.owner, toCancel!.id, { reason: 'SHOP', note: '' }),
    ).rejects.toMatchObject({ fieldErrors: { customerNotified: 'care_notice_required' } });
    await cancelCareVisit(shop.owner, toCancel!.id, {
      reason: 'SHOP',
      note: 'Vacaciones',
      customerNotified: 'on',
    });
    await assignCareVisit(shop.manager, toAssign!.id, shop.staff.membershipId);
    await expect(assignCareVisit(shop.staff, toAssign!.id, '')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const after = await visitsOf(shop.tenant.tenantId, weeklyId);
    expect(after.find((visit) => visit.id === toCancel!.id)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'SHOP',
    });
    expect(after.find((visit) => visit.id === toAssign!.id)?.assignedMembershipId).toBe(
      shop.staff.membershipId,
    );
  });
});

describe('capienza delle fasce', () => {
  let capacityShop: TestShop;
  let friday: string;
  let saturday: string;
  const contracts: string[] = [];

  async function monthlyOn(slotId: string, name: string): Promise<string> {
    const customer = await newCustomer(capacityShop.owner, name);
    const services = await getCareSettings(capacityShop.owner);
    const id = (
      await createCareContract(capacityShop.owner, customer.customerId, {
        customerAddressId: customer.addressId,
        frequency: 'MONTHLY_1',
        slotIds: [slotId],
        startDate: iso(today()),
        serviceIds: [services.services[0]!.id],
      })
    ).id;
    await addCarePlant(capacityShop.owner, id, {
      name: 'Plantas',
      quantity: '3',
      size: 'SMALL',
    });
    return id;
  }

  beforeAll(async () => {
    capacityShop = await createTestShop('Florería Capienza');
    await setUpShop(capacityShop, 'capienza');
    await updateCareSettings(capacityShop.owner, settingsInput());
    friday = (await createCareSlot(capacityShop.owner, slotInput(5, '09:00', '12:00', 1))).id;
    saturday = (await createCareSlot(capacityShop.owner, slotInput(6, '09:00', '12:00', 1))).id;
    for (const name of ['Cliente Uno', 'Cliente Dos', 'Cliente Tres']) {
      contracts.push(await monthlyOn(friday, name));
    }
  });

  it('fascia piena: il giorno dopo della stessa settimana, poi "Por reprogramar"', async () => {
    const [first, second, third] = contracts;
    await confirmCareContract(capacityShop.owner, first!);
    await confirmCareContract(capacityShop.owner, second!);
    await confirmCareContract(capacityShop.owner, third!);
    const tenantId = capacityShop.tenant.tenantId;
    const [a, b, c] = await Promise.all(contracts.map((id) => visitsOf(tenantId, id)));
    expect(a!.every((visit) => visit.slotId === friday)).toBe(true);
    expect(b!.every((visit) => visit.slotId === saturday)).toBe(true);
    expect(
      b!.every(
        (visit) =>
          visit.scheduledDate!.getTime() - visit.originalDate.getTime() === 24 * 60 * 60 * 1000,
      ),
    ).toBe(true);
    expect(
      c!.every((visit) => visit.status === 'TO_RESCHEDULE' && visit.scheduledDate === null),
    ).toBe(true);
    expect(await overbooked(tenantId)).toBe(0);
    const pending = await listCareVisitsToReschedule(capacityShop.owner);
    expect(pending.map((visit) => visit.id).sort()).toEqual(c!.map((visit) => visit.id).sort());
  });

  it('una fascia piena non accetta spostamenti', async () => {
    const [, , third] = contracts;
    const [pending] = await visitsOf(capacityShop.tenant.tenantId, third!);
    const saturdayOfWeek = (await visitsOf(capacityShop.tenant.tenantId, contracts[1]!))[0]!;
    await expect(
      moveCareVisit(capacityShop.owner, pending!.id, {
        date: saturdayOfWeek.scheduledDate!.toISOString().slice(0, 10),
        slotId: saturday,
        customerNotified: 'on',
      }),
    ).rejects.toThrow(new ConflictError('care_slot_full'));
  });

  it('meno posti in una fascia: le visite arrivate dopo si spostano, con avviso', async () => {
    const tenantId = capacityShop.tenant.tenantId;
    // Due posti il venerdì: la visita "Por reprogramar" del terzo cliente ci entra.
    await updateCareSlot(capacityShop.owner, friday, slotInput(5, '09:00', '12:00', 2));
    const [pending] = await visitsOf(tenantId, contracts[2]!);
    const firstFriday = (await visitsOf(tenantId, contracts[0]!))[0]!;
    await moveCareVisit(capacityShop.owner, pending!.id, {
      date: firstFriday.scheduledDate!.toISOString().slice(0, 10),
      slotId: friday,
      customerNotified: 'on',
    });
    await expect(
      updateCareSlot(capacityShop.owner, friday, slotInput(5, '09:00', '12:00', 1)),
    ).rejects.toMatchObject({ fieldErrors: { customerNotified: 'care_notice_required' } });
    const result = await updateCareSlot(capacityShop.owner, friday, {
      ...slotInput(5, '09:00', '12:00', 1),
      customerNotified: 'on',
    });
    // Il sabato è già pieno: la visita torna "Por reprogramar".
    expect(result).toEqual({ moved: 0, toReschedule: 1, retimed: 0 });
    const back = (await visitsOf(tenantId, contracts[2]!)).find(
      (visit) => visit.id === pending!.id,
    );
    expect(back).toMatchObject({ status: 'TO_RESCHEDULE', scheduledDate: null, slotId: null });
    expect(await overbooked(tenantId)).toBe(0);
  });

  it('cambiare l’orario tocca le visite: con avviso prendono l’orario nuovo', async () => {
    await expect(
      updateCareSlot(capacityShop.owner, friday, slotInput(5, '10:00', '13:00', 1)),
    ).rejects.toMatchObject({ fieldErrors: { customerNotified: 'care_notice_required' } });
    const result = await updateCareSlot(capacityShop.owner, friday, {
      ...slotInput(5, '10:00', '13:00', 1),
      customerNotified: 'on',
    });
    const fridays = await visitsOf(capacityShop.tenant.tenantId, contracts[0]!);
    expect(result.retimed).toBe(fridays.length);
    expect(fridays.every((visit) => visit.startMinutes === 600 && visit.endMinutes === 780)).toBe(
      true,
    );
  });

  it('archiviare una fascia sposta le sue visite (o le lascia da riprogrammare)', async () => {
    const tenantId = capacityShop.tenant.tenantId;
    const saturdays = await visitsOf(tenantId, contracts[1]!);
    await expect(archiveCareSlot(capacityShop.owner, saturday, {})).rejects.toMatchObject({
      fieldErrors: { customerNotified: 'care_notice_required' },
    });
    const result = await archiveCareSlot(capacityShop.owner, saturday, { customerNotified: 'on' });
    expect(result).toEqual({ moved: 0, toReschedule: saturdays.length, retimed: 0 });
    const settings = await getCareSettings(capacityShop.owner);
    expect(settings.slots.find((slot) => slot.id === saturday)?.active).toBe(false);
  });

  it('due conferme insieme sulla stessa fascia non superano la capienza', async () => {
    const race = await createTestShop('Florería Carrera');
    await setUpShop(race, 'carrera');
    await updateCareSettings(race.owner, settingsInput());
    const monday = (await createCareSlot(race.owner, slotInput(1, '09:00', '12:00', 1))).id;
    const services = await getCareSettings(race.owner);
    const ids: string[] = [];
    for (const name of ['Carrera Uno', 'Carrera Dos']) {
      const customer = await newCustomer(race.owner, name);
      const id = (
        await createCareContract(race.owner, customer.customerId, {
          customerAddressId: customer.addressId,
          frequency: 'MONTHLY_1',
          slotIds: [monday],
          startDate: iso(today()),
          serviceIds: [services.services[0]!.id],
        })
      ).id;
      await addCarePlant(race.owner, id, { name: 'Plantas', quantity: '2', size: 'SMALL' });
      ids.push(id);
    }
    const results = await Promise.all(ids.map((id) => confirmCareContract(race.owner, id)));
    const total = results.reduce((sum, result) => sum + result.scheduled, 0);
    const expected = careVisitDates({
      frequency: 'MONTHLY_1',
      weekdays: [1],
      from: today(),
      until: horizon(),
    });
    expect(total).toBe(expected.length);
    expect(results.reduce((sum, result) => sum + result.toReschedule, 0)).toBe(expected.length);
    expect(await overbooked(race.tenant.tenantId)).toBe(0);
  });
});

describe('lavori automatici senza utente', () => {
  let jobContract: string;

  beforeAll(async () => {
    // Una fascia tutta sua: nessun altro contratto le contende i posti.
    const jobSlot = (await createCareSlot(shop.owner, slotInput(3, '13:00', '15:00', 5))).id;
    const company = await newCustomer(shop.owner, 'Restaurante Luna');
    jobContract = (
      await createCareContract(shop.owner, company.customerId, {
        ...contractInput({
          customerAddressId: company.addressId,
          frequency: 'WEEKLY',
          slotIds: [jobSlot],
          serviceIds: [wateringId],
        }),
      })
    ).id;
    await addCarePlant(shop.owner, jobContract, { name: 'Ficus', quantity: '3', size: 'LARGE' });
    await confirmCareContract(shop.owner, jobContract);
  });

  it('la manutenzione allunga le visite con attore nullo e nome del lavoro', async () => {
    const tenantId = shop.tenant.tenantId;
    const cut = addDays(today(), 10);
    const removed = await withSystemContext(
      db,
      { reason: 'test: accorcia le visite create' },
      async (tx) => {
        const deleted = await tx.careVisit.deleteMany({
          where: {
            tenantId,
            subscriptionId: jobContract,
            originalDate: { gt: new Date(`${iso(cut)}T00:00:00Z`) },
          },
        });
        await tx.customerSubscription.update({
          where: { id: jobContract },
          data: { generatedUntil: new Date(`${iso(cut)}T00:00:00Z`) },
        });
        return deleted.count;
      },
    );
    expect(removed).toBeGreaterThan(0);
    await runCareMaintenance();
    const visits = await visitsOf(tenantId, jobContract);
    const expected = careVisitDates({
      frequency: 'WEEKLY',
      weekdays: [3],
      from: today(),
      until: horizon(),
    });
    expect(visits.filter((visit) => visit.status !== 'CANCELLED')).toHaveLength(expected.length);
    const audit = await withSystemContext(db, { reason: 'test: registro del lavoro' }, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId, entityId: jobContract, action: 'care.visits_generated' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(audit).toMatchObject({ actorUserId: null });
    expect(audit?.metadata).toMatchObject({ job: 'care.visits.extend', scheduled: removed });

    // Una seconda manutenzione non trova nulla da fare per questo contratto.
    const again = await visitsOf(tenantId, jobContract);
    await runCareMaintenance();
    expect(await visitsOf(tenantId, jobContract)).toHaveLength(again.length);
  });

  it('fine del contratto: le visite dopo l’ultimo giorno si cancellano; la manutenzione lo chiude', async () => {
    const tenantId = shop.tenant.tenantId;
    const last = addDays(today(), 7);
    await expect(
      endCareContract(shop.owner, jobContract, { endDate: iso(last) }),
    ).rejects.toMatchObject({ fieldErrors: { customerNotified: 'care_notice_required' } });
    const ended = await endCareContract(shop.owner, jobContract, {
      endDate: iso(last),
      customerNotified: 'on',
    });
    expect(ended.ended).toBe(false);
    expect(ended.cancelled).toBeGreaterThan(0);
    const visits = await visitsOf(tenantId, jobContract);
    expect(
      visits
        .filter((visit) => visit.status === 'SCHEDULED')
        .every((visit) => visit.scheduledDate! <= new Date(`${iso(last)}T00:00:00Z`)),
    ).toBe(true);

    // Il tempo passa: inizio e fine nel passato, poi la manutenzione chiude il contratto.
    await withSystemContext(db, { reason: 'test: contratto già finito' }, (tx) =>
      tx.customerSubscription.update({
        where: { id: jobContract },
        data: {
          startDate: new Date(`${iso(addDays(today(), -30))}T00:00:00Z`),
          endDate: new Date(`${iso(addDays(today(), -1))}T00:00:00Z`),
        },
      }),
    );
    await runCareMaintenance();
    const closed = await getCareContract(shop.owner, jobContract);
    expect(closed).toMatchObject({ status: 'ENDED', canWrite: false });
    const audit = await withSystemContext(db, { reason: 'test: registro della chiusura' }, (tx) =>
      tx.auditLog.findFirst({
        where: {
          tenantId,
          entityId: jobContract,
          action: 'customer_subscription.ended',
          actorUserId: null,
        },
      }),
    );
    expect(audit?.metadata).toMatchObject({ job: 'care.contracts.close', ended: true });
  });
});

describe('isolamento fra fiorerie', () => {
  it('una fioreria non vede né tocca contratti, visite e fasce dell’altra (404)', async () => {
    const list = await listCareContracts(shop.owner, { view: 'active' });
    const contract = list.items[0]!;
    const [visit] = (await visitsOf(shop.tenant.tenantId, contract.id)).filter(
      (row) => row.status === 'SCHEDULED',
    );
    await updateCareSettings(other.owner, settingsInput());

    await expect(getCareContract(other.owner, contract.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      changeCareSchedule(other.owner, contract.id, {
        frequency: 'MONTHLY_1',
        slotIds: [tueSlot],
        startDate: iso(today()),
        customerNotified: 'on',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(startCareVisit(other.staff, visit!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(finishCareVisit(other.staff, visit!.id, {}, null)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      moveCareVisit(other.owner, visit!.id, {
        date: iso(today()),
        slotId: tueSlot,
        customerNotified: 'on',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateCareSlot(other.owner, tueSlot, {
        ...slotInput(2, '09:00', '12:00', 1),
        customerNotified: 'on',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createCareContract(other.owner, customerId, contractInput()),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect((await listCareContracts(other.owner, { view: 'active' })).items).toHaveLength(0);
    expect(
      (await getCareAgendaDay(other.owner, visit!.scheduledDate!.toISOString().slice(0, 10))).counts
        .total,
    ).toBe(0);

    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: null,
          entityId: contract.id,
          action: 'security.cross_tenant_access_attempt',
        },
      }),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.metadata).toMatchObject({
      actorTenantId: other.tenant.tenantId,
      targetTenantId: shop.tenant.tenantId,
    });
  });
});

describe('chi resta e chi si sposta quando una fascia cambia', () => {
  const visit = (id: string, day: string, seats: number, status = 'SCHEDULED', minute = 0) =>
    ({
      id,
      subscriptionId: `s-${id}`,
      status,
      scheduledDate: new Date(`${day}T00:00:00Z`),
      startMinutes: 540,
      endMinutes: 720,
      seats,
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, minute)),
    }) satisfies SlotVisitRow;

  it('restano le chiuse e poi le prime arrivate, giorno per giorno; archiviata = tutte via', () => {
    const rows = [
      visit('done', '2026-12-01', 1, 'DONE', 5),
      visit('a', '2026-12-01', 1, 'SCHEDULED', 1),
      visit('b', '2026-12-01', 2, 'SCHEDULED', 2),
      visit('c', '2026-12-08', 1, 'SCHEDULED', 3),
    ];
    const plan = planSlotChange(rows, 2);
    expect(plan.keep.map((row) => row.id)).toEqual(['a', 'c']);
    expect(plan.move.map((row) => row.id)).toEqual(['b']);
    expect(planSlotChange(rows, null).move.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('cancellazione definitiva di una fioreria con Floral Care (ADR-074)', () => {
  it('contratti, visite, piante, servizi e fasce se ne vanno con la fioreria', async () => {
    setObjectStorage(new MemoryStorage());
    const gone = await createTestShop('Florería Care Se Va');
    await setUpShop(gone, 'care-se-va');
    await updateCareSettings(gone.owner, settingsInput());
    const slot = (
      await createCareSlot(gone.owner, slotInput(dayOfWeek(today()), '09:00', '10:00', 2))
    ).id;
    await addCareTravelTier(gone.owner, { upToKm: '5', fee: '30' });
    const company = await newCustomer(gone.owner, 'Cliente Que Se Va');
    const settings = await getCareSettings(gone.owner);
    const contract = (
      await createCareContract(gone.owner, company.customerId, {
        customerAddressId: company.addressId,
        frequency: 'WEEKLY',
        slotIds: [slot],
        startDate: iso(today()),
        serviceIds: [settings.services[0]!.id],
      })
    ).id;
    await addCarePlant(gone.owner, contract, { name: 'Plantas', quantity: '2', size: 'SMALL' });
    await confirmCareContract(gone.owner, contract);
    const [first] = await visitsOf(gone.tenant.tenantId, contract);
    await startCareVisit(gone.owner, first!.id);
    await markAllCarePlantsOk(gone.owner, first!.id);
    await finishCareVisit(gone.owner, first!.id, {}, null);

    await requestTenantDeletion(gone.owner, { confirmName: 'Florería Care Se Va' }, null);
    await withSystemContext(db, { reason: 'test: 30 giorni passati' }, (tx) =>
      tx.tenant.update({
        where: { id: gone.tenant.tenantId },
        data: {
          deletionRequestedAt: new Date(Date.now() - 32 * 86_400_000),
          deleteAfter: new Date(Date.now() - 60_000),
        },
      }),
    );
    expect(await purgeDeletedTenants()).toBeGreaterThanOrEqual(1);
    const left = await withSystemContext(db, { reason: 'test: resti della fioreria' }, (tx) =>
      Promise.all([
        tx.tenant.count({ where: { id: gone.tenant.tenantId } }),
        tx.customerSubscription.count({ where: { tenantId: gone.tenant.tenantId } }),
        tx.careVisit.count({ where: { tenantId: gone.tenant.tenantId } }),
        tx.careSlot.count({ where: { tenantId: gone.tenant.tenantId } }),
      ]),
    );
    expect(left).toEqual([0, 0, 0, 0]);
  });
});
