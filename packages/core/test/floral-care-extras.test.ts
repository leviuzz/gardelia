import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { addDays, dayOfWeek, todayInTimeZone, toIsoDate, type CalendarDate } from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  NotFoundError,
  ValidationError,
  addCareFollowUp,
  addCarePlant,
  addCustomerAddress,
  changeCareSchedule,
  confirmCareContract,
  createCareContract,
  createCareExtraVisit,
  createCareQuote,
  createCareSlot,
  createCustomer,
  endCareContract,
  finishCareVisit,
  getCareAgendaDay,
  getCareContract,
  getCareExtraVisitOptions,
  getCareSettings,
  getCareVisitMoveOptions,
  getCareVisitSheet,
  listCareContractQuotes,
  listCareFollowUps,
  markAllCarePlantsOk,
  moveCareVisit,
  resolveCareFollowUp,
  setCareVisitPlantResult,
  startCareVisit,
  updateCareSettings,
  updatePrimaryLocation,
  type CareMailDeps,
  type TenantContext,
} from '../src/index';
import { contextFor, createTestShop, type TestShop } from '../src/testing';

/**
 * Floral Care, blocco 2b (ADR-078): visite extra in un orario (contano i posti) o a un'ora libera
 * (no), costo calcolato dal server, cotización legata al contratto, piante morte risolte una volta
 * sola, piante di temporada fuori dal prezzo e archiviate al ritiro, isolamento fra fiorerie.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const STAMP = Date.now().toString(36);
const today = (): CalendarDate => todayInTimeZone(TZ);
const iso = (date: CalendarDate) => toIsoDate(date);
const deps: CareMailDeps = {
  mailer: new MemoryMailer(),
  appUrl: 'https://gardelia.example.test',
  secret: 'y'.repeat(48),
};

let shop: TestShop;
let other: TestShop;
let live: { owner: TenantContext; manager: TenantContext; staff: TenantContext };

interface Kit {
  readonly slotId: string;
  readonly subscriptionId: string;
  readonly visitId: string;
  readonly nextVisitId: string;
  readonly potosId: string;
  readonly monsteraId: string;
}

const slotsUsed = new Map<string, number>();

/** Una fascia nuova di 30 minuti per oggi, con 2 posti, diversa per ogni contratto. */
async function nextSlot(ctx: TenantContext, weekday = dayOfWeek(today())): Promise<string> {
  const index = (slotsUsed.get(ctx.tenantId) ?? 0) + 1;
  slotsUsed.set(ctx.tenantId, index);
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const slot = await createCareSlot(ctx, {
    weekday: String(weekday),
    start: time(index * 30),
    end: time(index * 30 + 30),
    capacity: '2',
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
    placeId: `ChIJ_extra_${ctx.tenantSlug}`,
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
    termsText: '',
  });
}

/** Un contratto settimanale che parte oggi: la prima visita è di oggi, la seconda fra 7 giorni. */
async function newContract(ctx: TenantContext, name: string): Promise<Kit> {
  const slotId = await nextSlot(ctx);
  const customer = await createCustomer(ctx, {
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
  });
  const place = await addCustomerAddress(ctx, customer.id, {
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
    placeId: `ChIJ_${name.replace(/\W/g, '')}_${STAMP}`,
    latitude: '21.9',
    longitude: '-102.2916',
  });
  const settings = await getCareSettings(ctx);
  const contract = await createCareContract(ctx, customer.id, {
    customerAddressId: place.id,
    frequency: 'WEEKLY',
    slotIds: [slotId],
    startDate: iso(today()),
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
  const potos = await addCarePlant(ctx, contract.id, {
    name: 'Potos en jardinera',
    quantity: '12',
    size: 'MEDIUM',
  });
  const monstera = await addCarePlant(ctx, contract.id, {
    name: 'Monstera',
    quantity: '1',
    size: 'LARGE',
  });
  await confirmCareContract(ctx, contract.id);
  const visits = await withSystemContext(db, { reason: 'test: visite' }, (tx) =>
    tx.careVisit.findMany({
      where: { tenantId: ctx.tenantId, subscriptionId: contract.id },
      orderBy: { originalDate: 'asc' },
      select: { id: true },
    }),
  );
  return {
    slotId,
    subscriptionId: contract.id,
    visitId: visits[0]!.id,
    nextVisitId: visits[1]!.id,
    potosId: potos.id,
    monsteraId: monstera.id,
  };
}

async function visitRow(visitId: string) {
  return withSystemContext(db, { reason: 'test: visita' }, (tx) =>
    tx.careVisit.findUniqueOrThrow({ where: { id: visitId } }),
  );
}

async function extrasOf(subscriptionId: string) {
  return withSystemContext(db, { reason: 'test: visite extra' }, (tx) =>
    tx.careVisit.findMany({ where: { subscriptionId, isExtra: true } }),
  );
}

beforeAll(async () => {
  shop = await createTestShop('Florería Extras');
  live = {
    owner: await contextFor(shop.tenant.owner.id, shop.tenant.slug),
    manager: await contextFor(shop.managerUser.id, shop.tenant.slug),
    staff: await contextFor(shop.staffUser.id, shop.tenant.slug),
  };
  other = await createTestShop('Florería Extras Ajena');
  await setUpOffer(live.owner);
  await setUpOffer(other.owner);
});

afterAll(async () => {
  await disconnectDb();
});

describe('visita extra: in un orario o a un’ora libera', () => {
  it('in un orario conta i posti; a un’ora libera no; l’Agenda la mette alla sua ora', async () => {
    const kit = await newContract(live.owner, 'Hotel Extra Posti');
    // La fascia ha 2 posti: la visita di oggi ne prende 1, la extra l'altro.
    const inSlot = await createCareExtraVisit(live.manager, kit.subscriptionId, {
      kind: 'EXTRA',
      placement: 'SLOT',
      date: iso(today()),
      slotId: kit.slotId,
      fee: 'VISIT_FEE',
      note: 'Revisar el riego automático',
    });
    await expect(
      createCareExtraVisit(live.manager, kit.subscriptionId, {
        kind: 'EXTRA',
        placement: 'SLOT',
        date: iso(today()),
        slotId: kit.slotId,
        fee: 'VISIT_FEE',
      }),
    ).rejects.toThrow(new ConflictError('care_slot_full'));
    const free = await createCareExtraVisit(live.manager, kit.subscriptionId, {
      kind: 'EXTRA',
      placement: 'TIME',
      date: iso(today()),
      start: '22:10',
      end: '22:40',
      fee: 'FREE',
    });

    const contract = await withSystemContext(db, { reason: 'test: contratto' }, (tx) =>
      tx.customerSubscription.findUniqueOrThrow({ where: { id: kit.subscriptionId } }),
    );
    expect(await visitRow(inSlot.visitId)).toMatchObject({
      isExtra: true,
      extraKind: 'EXTRA',
      extraFee: 'VISIT_FEE',
      extraFeeMinor: contract.visitFeeMinor + contract.travelSurchargeMinor,
      extraNote: 'Revisar el riego automático',
      slotId: kit.slotId,
      status: 'SCHEDULED',
    });
    expect(await visitRow(free.visitId)).toMatchObject({
      slotId: null,
      startMinutes: 22 * 60 + 10,
      endMinutes: 22 * 60 + 40,
      extraFee: 'FREE',
      extraFeeMinor: 0,
    });

    const day = await getCareAgendaDay(live.manager, iso(today()));
    const slotGroup = day.groups.find((group) => group.slotId === kit.slotId)!;
    expect(slotGroup.used).toBe(2);
    const timeGroup = day.groups.find((group) =>
      group.visits.some((visit) => visit.id === free.visitId),
    )!;
    expect(timeGroup).toMatchObject({ slotId: null, start: '22:10', end: '22:40', capacity: null });
    expect(timeGroup.visits.find((visit) => visit.id === free.visitId)?.extra).toMatchObject({
      kind: 'EXTRA',
      fee: 'FREE',
      feeMinor: 0,
    });
    // Una visita extra non ha la checklist del contratto: fa il suo lavoro.
    expect((await getCareVisitSheet(live.staff, free.visitId)).checklist).toEqual([]);
  });

  it('il modulo propone gli orari con posto, la tariffa e le cotizaciones del contratto', async () => {
    const kit = await newContract(live.owner, 'Oficinas Opciones');
    const options = await getCareExtraVisitOptions(live.manager, kit.subscriptionId);
    expect(options.visitFeeMinor).toBeGreaterThan(0);
    expect(options.deadPlantPolicy).toBe('QUOTE');
    expect(options.firstDate).toBe(iso(today()));
    expect(options.options.some((option) => option.slotId === kit.slotId)).toBe(true);
    await expect(getCareExtraVisitOptions(live.staff, kit.subscriptionId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('il calendario nuovo tiene le extra; la fine del contratto le cancella', async () => {
    const kit = await newContract(live.owner, 'Corporativo Calendario');
    const extra = await createCareExtraVisit(live.manager, kit.subscriptionId, {
      kind: 'REPLACEMENT',
      placement: 'TIME',
      date: iso(addDays(today(), 3)),
      start: '09:00',
      end: '10:00',
      fee: 'FREE',
    });
    const newSlot = await nextSlot(live.owner);
    await changeCareSchedule(live.manager, kit.subscriptionId, {
      frequency: 'WEEKLY',
      slotIds: [newSlot],
      startDate: iso(today()),
      customerNotified: 'on',
    });
    expect((await visitRow(extra.visitId)).status).toBe('SCHEDULED');

    await endCareContract(live.manager, kit.subscriptionId, {
      endDate: iso(addDays(today(), 1)),
      customerNotified: 'on',
    });
    expect(await visitRow(extra.visitId)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'CONTRACT_END',
    });
  });

  it('una extra si sposta anche a un’ora libera; una visita del calendario no', async () => {
    const kit = await newContract(live.owner, 'Clínica Mover');
    const extra = await createCareExtraVisit(live.manager, kit.subscriptionId, {
      kind: 'EXTRA',
      placement: 'SLOT',
      date: iso(today()),
      slotId: kit.slotId,
      fee: 'VISIT_FEE',
    });
    expect((await getCareVisitMoveOptions(live.manager, extra.visitId)).freeTime).toBe(true);
    expect((await getCareVisitMoveOptions(live.manager, kit.nextVisitId)).freeTime).toBe(false);
    const target = iso(addDays(today(), 2));
    await expect(
      moveCareVisit(live.manager, extra.visitId, {
        placement: 'TIME',
        date: target,
        start: '11:00',
        end: '12:00',
      }),
    ).rejects.toThrow(ValidationError);
    await moveCareVisit(live.manager, extra.visitId, {
      placement: 'TIME',
      date: target,
      start: '11:00',
      end: '12:00',
      customerNotified: 'on',
    });
    expect(await visitRow(extra.visitId)).toMatchObject({
      slotId: null,
      startMinutes: 660,
      endMinutes: 720,
    });
    await expect(
      moveCareVisit(live.manager, kit.nextVisitId, {
        placement: 'TIME',
        date: target,
        start: '11:00',
        end: '12:00',
        customerNotified: 'on',
      }),
    ).rejects.toMatchObject({ fieldErrors: { placement: 'invalid_option' } });
  });
});

describe('costo e cotización del contratto', () => {
  it('"en la cotización" vuole una cotización del contratto; lo staff non crea né l’una né l’altra', async () => {
    const kit = await newContract(live.owner, 'Hotel Cotización');
    const otherKit = await newContract(live.owner, 'Hotel Otra Cotización');
    await expect(
      createCareExtraVisit(live.staff, kit.subscriptionId, {
        kind: 'EXTRA',
        placement: 'TIME',
        date: iso(today()),
        start: '08:00',
        end: '09:00',
        fee: 'VISIT_FEE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createCareQuote(live.staff, kit.subscriptionId, { purpose: 'SEASONAL' }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const quote = await createCareQuote(live.manager, kit.subscriptionId, { purpose: 'SEASONAL' });
    const row = await withSystemContext(db, { reason: 'test: cotización' }, (tx) =>
      tx.quote.findUniqueOrThrow({ where: { id: quote.id } }),
    );
    expect(row).toMatchObject({ subscriptionId: kit.subscriptionId, status: 'DRAFT' });
    expect(row.title).toMatch(/^Cambio de temporada · SUS-\d{4}$/);
    expect(
      (await listCareContractQuotes(live.manager, kit.subscriptionId)).map((item) => item.id),
    ).toContain(quote.id);

    const otherQuote = await createCareQuote(live.manager, otherKit.subscriptionId, {
      purpose: 'EXTRA',
    });
    const base = {
      kind: 'SEASONAL_INSTALL',
      placement: 'TIME',
      date: iso(addDays(today(), 1)),
      start: '08:00',
      end: '10:00',
      fee: 'QUOTE',
    };
    await expect(
      createCareExtraVisit(live.manager, kit.subscriptionId, { ...base, quoteId: otherQuote.id }),
    ).rejects.toMatchObject({ fieldErrors: { quoteId: 'invalid_option' } });
    const install = await createCareExtraVisit(live.manager, kit.subscriptionId, {
      ...base,
      quoteId: quote.id,
    });
    expect(await visitRow(install.visitId)).toMatchObject({
      extraFee: 'QUOTE',
      extraFeeMinor: 0,
      quoteId: quote.id,
    });
  });
});

describe('piante morte', () => {
  it('si risolvono una volta sola: sin costo con una visita extra, cotización, no se repone', async () => {
    const kit = await newContract(live.owner, 'Hotel Plantas Muertas');
    await startCareVisit(live.staff, kit.visitId);
    await setCareVisitPlantResult(live.staff, kit.visitId, {
      plantId: kit.monsteraId,
      condition: 'DEAD',
    });
    await addCareFollowUp(live.staff, kit.visitId, {
      kind: 'REPLACEMENT',
      plantId: kit.potosId,
      quantity: '3',
      note: 'Tres potos secos',
    });
    await addCareFollowUp(live.staff, kit.visitId, {
      kind: 'EXTRA',
      note: 'Quieren una planta más en recepción',
    });
    await markAllCarePlantsOk(live.staff, kit.visitId);
    await finishCareVisit(live.staff, kit.visitId, {}, deps);

    const open = (await listCareFollowUps(live.manager, 'OPEN')).items.filter(
      (item) => item.visitId === kit.visitId,
    );
    const monstera = open.find((item) => item.plantName === 'Monstera')!;
    const potos = open.find((item) => item.plantName === 'Potos en jardinera')!;
    const extra = open.find((item) => item.kind === 'EXTRA')!;
    expect(monstera).toMatchObject({
      kind: 'REPLACEMENT',
      choices: ['FREE_VISIT', 'NEXT_VISIT', 'QUOTED', 'NOT_REPLACED'],
      // La regola della fioreria: le piante morte si cotizzano.
      suggested: 'QUOTED',
    });
    expect(extra).toMatchObject({ choices: ['HANDLED', 'QUOTED'], suggested: null });

    // "Reposición sin costo": una visita extra a costo 0 chiude l'avviso.
    const replacement = {
      kind: 'REPLACEMENT',
      placement: 'TIME',
      date: iso(addDays(today(), 2)),
      start: '09:00',
      end: '10:00',
      fee: 'FREE',
      followUpId: monstera.id,
    };
    await expect(
      createCareExtraVisit(live.manager, kit.subscriptionId, { ...replacement, fee: 'VISIT_FEE' }),
    ).rejects.toMatchObject({ fieldErrors: { followUpId: 'invalid_option' } });
    const visit = await createCareExtraVisit(live.manager, kit.subscriptionId, replacement);
    await expect(
      createCareExtraVisit(live.manager, kit.subscriptionId, replacement),
    ).rejects.toThrow(new ConflictError('care_follow_up_resolved'));
    expect(await extrasOf(kit.subscriptionId)).toHaveLength(1);

    // "Cotizar" da un avviso: la cotización lo chiude.
    const quote = await createCareQuote(live.manager, kit.subscriptionId, {
      purpose: 'REPLACEMENT',
      followUpId: potos.id,
    });
    // "Atendido" non vale per una pianta morta; "En la próxima visita" non vale per un extra.
    await expect(
      resolveCareFollowUp(live.manager, potos.id, { resolution: 'HANDLED' }),
    ).rejects.toMatchObject({ fieldErrors: { resolution: 'invalid_option' } });
    await expect(
      resolveCareFollowUp(live.manager, extra.id, { resolution: 'NEXT_VISIT' }),
    ).rejects.toMatchObject({ fieldErrors: { resolution: 'invalid_option' } });
    await expect(
      resolveCareFollowUp(live.staff, extra.id, { resolution: 'HANDLED' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await resolveCareFollowUp(live.manager, extra.id, {
      resolution: 'HANDLED',
      note: 'Se la ofrecimos',
    });
    // Un doppio tocco non cambia nulla; una scelta diversa sì è un conflitto.
    await resolveCareFollowUp(live.manager, extra.id, { resolution: 'HANDLED' });

    const resolved = (await listCareFollowUps(live.manager, 'RESOLVED')).items;
    expect(resolved.find((item) => item.id === monstera.id)).toMatchObject({
      resolution: 'FREE_VISIT',
      extraVisit: { id: visit.visitId, date: iso(addDays(today(), 2)) },
      choices: [],
    });
    expect(resolved.find((item) => item.id === potos.id)).toMatchObject({
      resolution: 'QUOTED',
      quote: { id: quote.id },
    });
    expect(resolved.find((item) => item.id === extra.id)).toMatchObject({
      resolution: 'HANDLED',
      resolutionNote: 'Se la ofrecimos',
    });
    await expect(
      createCareQuote(live.manager, kit.subscriptionId, {
        purpose: 'EXTRA',
        followUpId: extra.id,
      }),
    ).rejects.toThrow(new ConflictError('care_follow_up_resolved'));
  });
});

describe('cambio di stagione', () => {
  it('le piante di temporada restano fuori dal prezzo e si archiviano al ritiro', async () => {
    const kit = await newContract(live.owner, 'Hotel Temporada');
    const before = (await getCareContract(live.manager, kit.subscriptionId)).current!;
    await addCarePlant(live.manager, kit.subscriptionId, {
      name: 'Nochebuena',
      quantity: '6',
      size: 'LARGE',
      seasonal: 'on',
    });
    const withSeasonal = await getCareContract(live.manager, kit.subscriptionId);
    expect(withSeasonal.current!.perVisitMinor).toBe(before.perVisitMinor);
    expect(withSeasonal.plants.find((plant) => plant.name === 'Nochebuena')?.seasonal).toBe(true);

    // Il ritiro di oggi: la visita si fa dal telefono e alla fine le piante escono dal contratto.
    const pickup = await createCareExtraVisit(live.manager, kit.subscriptionId, {
      kind: 'SEASONAL_PICKUP',
      placement: 'TIME',
      date: iso(today()),
      start: '21:00',
      end: '22:00',
      fee: 'VISIT_FEE',
    });
    await startCareVisit(live.staff, pickup.visitId);
    const sheet = await getCareVisitSheet(live.staff, pickup.visitId);
    expect(sheet.seasonalPickup).toEqual({ plants: 6 });
    expect(sheet.plants.find((plant) => plant.name === 'Nochebuena')?.seasonal).toBe(true);
    await markAllCarePlantsOk(live.staff, pickup.visitId);
    await finishCareVisit(live.staff, pickup.visitId, { archiveSeasonal: 'on' }, deps);

    const plants = await withSystemContext(db, { reason: 'test: piante' }, (tx) =>
      tx.carePlant.findMany({ where: { subscriptionId: kit.subscriptionId } }),
    );
    expect(plants.find((plant) => plant.name === 'Nochebuena')?.status).toBe('ARCHIVED');
    expect(plants.filter((plant) => plant.status === 'ACTIVE')).toHaveLength(2);
    // La visita normale di oggi non è un ritiro: niente da archiviare.
    expect((await getCareVisitSheet(live.staff, kit.visitId)).seasonalPickup).toBeNull();
  });
});

describe('isolamento fra fiorerie', () => {
  it('contratti, cotizaciones e avvisi di una fioreria non esistono per l’altra', async () => {
    const kit = await newContract(live.owner, 'Hotel Aislado Extras');
    const theirs = await newContract(other.owner, 'Hotel Ajeno Extras');
    const theirQuote = await createCareQuote(other.owner, theirs.subscriptionId, {
      purpose: 'EXTRA',
    });
    const input = {
      kind: 'EXTRA',
      placement: 'TIME',
      date: iso(addDays(today(), 1)),
      start: '08:00',
      end: '09:00',
      fee: 'VISIT_FEE',
    };
    await expect(
      createCareExtraVisit(other.owner, kit.subscriptionId, input),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createCareQuote(other.owner, kit.subscriptionId, { purpose: 'SEASONAL' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCareExtraVisitOptions(other.owner, kit.subscriptionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listCareContractQuotes(other.owner, kit.subscriptionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Una cotización o un avviso dell'altra fioreria non si collegano.
    await expect(
      createCareExtraVisit(live.owner, kit.subscriptionId, {
        ...input,
        fee: 'QUOTE',
        quoteId: theirQuote.id,
      }),
    ).rejects.toMatchObject({ fieldErrors: { quoteId: 'invalid_option' } });
    await startCareVisit(other.staff, theirs.visitId);
    await addCareFollowUp(other.staff, theirs.visitId, { kind: 'OTHER', note: 'Ajeno' });
    const theirFollowUp = (await listCareFollowUps(other.owner, 'OPEN')).items.find(
      (item) => item.visitId === theirs.visitId,
    )!;
    await expect(
      createCareExtraVisit(live.owner, kit.subscriptionId, {
        ...input,
        kind: 'REPLACEMENT',
        fee: 'FREE',
        followUpId: theirFollowUp.id,
      }),
    ).rejects.toMatchObject({ fieldErrors: { followUpId: 'invalid_option' } });
    await expect(
      createCareQuote(live.owner, kit.subscriptionId, {
        purpose: 'EXTRA',
        followUpId: theirFollowUp.id,
      }),
    ).rejects.toMatchObject({ fieldErrors: { followUpId: 'invalid_option' } });
    expect(await extrasOf(kit.subscriptionId)).toHaveLength(0);

    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.count({ where: { tenantId: null, entityId: kit.subscriptionId } }),
    );
    expect(events).toBeGreaterThan(0);
  });
});
