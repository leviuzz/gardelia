import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import {
  CARE_VISIT_LIMITS,
  addDays,
  dayOfWeek,
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
  ValidationError,
  addCareFollowUp,
  addCarePlant,
  addCareVisitPhoto,
  addCustomerAddress,
  confirmCareContract,
  createCareContract,
  createCareService,
  createCareSlot,
  createCatalogItem,
  createCustomer,
  finishCareVisit,
  getCareAgendaDay,
  getCareSettings,
  getCareVisitPhotoImage,
  getCareVisitSheet,
  getCatalogItemInventory,
  getCustomerTimeline,
  getDayRoute,
  getPublicCareVisitPhoto,
  getPublicCareVisitReport,
  getPublicLink,
  getPublicShopLogo,
  listCareFollowUps,
  listCareMaterialOptions,
  markAllCarePlantsOk,
  markCareVisitNotDone,
  purgeDeletedTenants,
  removeCareVisitPhoto,
  removeStoreImage,
  requestTenantDeletion,
  resolveCareFollowUp,
  revokePublicLink,
  saveCareVisitNote,
  sendCareVisitReport,
  setCareVisitMaterial,
  setCareVisitPlantResult,
  setCareVisitServiceResult,
  setObjectStorage,
  setStoreImage,
  startCareVisit,
  startInventoryTracking,
  updateCareSettings,
  updatePrimaryLocation,
  type CareMailDeps,
  type Mailer,
  type TenantContext,
} from '../src/index';
import { purgeCarePhotos, retryCareEmails } from '../src/jobs/care';
import { logger } from '../src/logger';
import { contextFor, createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Floral Care, blocco 2 (ADR-078): la visita dal telefono. Avvio, passi salvati uno per uno, foto
 * (anche nuovi tentativi), materiali dall'inventario una volta sola, chiusura due volte, email del
 * resoconto una sola volta (anche con errori e nuovi tentativi), link pubblico, avvisi per chi
 * gestisce, cancellazione delle foto a fine contratto e isolamento fra fiorerie.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const STAMP = Date.now().toString(36);
const today = (): CalendarDate => todayInTimeZone(TZ);
const iso = (date: CalendarDate) => toIsoDate(date);

const mailer = new MemoryMailer();
const deps: CareMailDeps = {
  mailer,
  appUrl: 'https://gardelia.example.test',
  secret: 'x'.repeat(48),
};

class FailingMailer implements Mailer {
  readonly kind = 'memory' as const;
  async send(): Promise<void> {
    throw new Error('SMTP fuera de servicio');
  }
}

/** Uno storage che non riesce a cancellare (R2 giù). */
class FailingDeleteStorage extends MemoryStorage {
  override async delete(): Promise<void> {
    throw new Error('R2 fuera de servicio');
  }
}

let shop: TestShop;
let live: { owner: TenantContext; manager: TenantContext; staff: TenantContext };
let other: TestShop;
let storage: MemoryStorage;
let serviceIds: string[];
let otherServiceIds: string[];
let fertilizerId: string;

interface VisitKit {
  /** La fascia del contratto: una per contratto, così nessuna si riempie. */
  readonly start: string;
  readonly end: string;
  readonly subscriptionId: string;
  readonly visitId: string;
  readonly nextVisitId: string;
  readonly potosId: string;
  readonly monsteraId: string;
  readonly customerId: string;
}

async function jpeg(color: { r: number; g: number; b: number }): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 640, height: 480, channels: 3, background: color } })
      .jpeg()
      .toBuffer(),
  );
}

function settingsInput() {
  return {
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
  };
}

const slotsUsed = new Map<string, number>();

/** Una fascia nuova di 30 minuti per oggi (giorno della settimana), diversa per ogni contratto. */
async function nextSlot(ctx: TenantContext): Promise<{ id: string; start: string; end: string }> {
  const index = (slotsUsed.get(ctx.tenantId) ?? 0) + 1;
  slotsUsed.set(ctx.tenantId, index);
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const start = time(index * 30);
  const end = time(index * 30 + 30);
  const slot = await createCareSlot(ctx, {
    weekday: String(dayOfWeek(today())),
    start,
    end,
    capacity: '2',
  });
  return { id: slot.id, start, end };
}

async function setUpOffer(ctx: TenantContext): Promise<{ services: string[] }> {
  await updatePrimaryLocation(ctx, {
    addressLine1: 'Av. Madero 1',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryRadiusKm: '15',
    placeId: `ChIJ_visita_${ctx.tenantSlug}`,
    latitude: '21.8818',
    longitude: '-102.2916',
  });
  await updateCareSettings(ctx, settingsInput());
  const settings = await getCareSettings(ctx);
  return {
    services: settings.services
      .filter((service) => service.presetKey === 'watering' || service.presetKey === 'pruning')
      .map((service) => service.id),
  };
}

/** Un contratto settimanale che parte oggi: la prima visita è di oggi, la seconda fra 7 giorni. */
async function newVisit(
  ctx: TenantContext,
  name: string,
  options: { email?: string | null; services?: string[] } = {},
): Promise<VisitKit> {
  const slot = await nextSlot(ctx);
  const customer = await createCustomer(ctx, {
    type: 'COMPANY',
    displayName: name,
    legalName: null,
    taxId: null,
    email: options.email ?? null,
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
  const contract = await createCareContract(ctx, customer.id, {
    customerAddressId: place.id,
    frequency: 'WEEKLY',
    slotIds: [slot.id],
    startDate: iso(today()),
    seats: '',
    serviceIds: options.services ?? serviceIds,
    contactName: 'Recepción',
    contactPhone: '',
    accessNotes: 'Gafete',
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
    start: slot.start,
    end: slot.end,
    subscriptionId: contract.id,
    visitId: visits[0]!.id,
    nextVisitId: visits[1]!.id,
    potosId: potos.id,
    monsteraId: monstera.id,
    customerId: customer.id,
  };
}

async function visitRow(visitId: string) {
  return withSystemContext(db, { reason: 'test: visita' }, (tx) =>
    tx.careVisit.findUniqueOrThrow({ where: { id: visitId } }),
  );
}

async function emailsOf(visitId: string) {
  return withSystemContext(db, { reason: 'test: email' }, (tx) =>
    tx.careEmail.findMany({ where: { visitId } }),
  );
}

async function photosOf(visitId: string) {
  return withSystemContext(db, { reason: 'test: foto' }, (tx) =>
    tx.carePhoto.findMany({ where: { visitId }, orderBy: { createdAt: 'asc' } }),
  );
}

function careKeys(tenantId: string): string[] {
  return [...storage.objects.keys()].filter((key) =>
    key.startsWith(`tenants/${tenantId}/care-photos/`),
  );
}

async function linkToken(ctx: TenantContext, visitId: string): Promise<string> {
  const link = await getPublicLink(ctx, deps.secret, { kind: 'CARE_VISIT', id: visitId });
  if (!link) throw new Error('link del resoconto mancante');
  return link.token;
}

/** Fine del contratto `daysAgo` giorni fa (come l'avrebbe chiuso la manutenzione). */
async function endedDaysAgo(subscriptionId: string, daysAgo: number): Promise<void> {
  const end = addDays(today(), -daysAgo);
  const start = addDays(end, -30);
  await withSystemContext(db, { reason: 'test: contratto finito' }, (tx) =>
    tx.customerSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'ENDED',
        startDate: new Date(Date.UTC(start.year, start.month - 1, start.day)),
        endDate: new Date(Date.UTC(end.year, end.month - 1, end.day)),
        endedAt: new Date(Date.UTC(end.year, end.month - 1, end.day + 1, 6)),
      },
    }),
  );
}

beforeAll(async () => {
  storage = new MemoryStorage();
  setObjectStorage(storage);
  shop = await createTestShop('Florería Visitas');
  // Una fioreria LIVE: scrive davvero ai clienti (le fiorerie di prova sono demo).
  await withSystemContext(db, { reason: 'test: fioreria reale' }, (tx) =>
    tx.tenant.update({
      where: { id: shop.tenant.tenantId },
      data: { mode: 'LIVE', contactEmail: `contacto-${STAMP}@visitas.example.test` },
    }),
  );
  live = {
    owner: await contextFor(shop.tenant.owner.id, shop.tenant.slug),
    manager: await contextFor(shop.managerUser.id, shop.tenant.slug),
    staff: await contextFor(shop.staffUser.id, shop.tenant.slug),
  };
  other = await createTestShop('Florería Visitas Ajena');
  ({ services: serviceIds } = await setUpOffer(live.owner));
  ({ services: otherServiceIds } = await setUpOffer(other.owner));
  const fertilizer = await createCatalogItem(
    live.owner,
    itemInput({
      type: 'ACCESSORY',
      name: 'Fertilizante líquido',
      saleUnit: 'PIECE',
      colors: [],
      variety: null,
      heightCm: null,
    }),
  );
  fertilizerId = fertilizer.id;
  await startInventoryTracking(live.owner, {
    rows: { '0': { catalogItemId: fertilizerId, quantity: '3', minQuantity: '' } },
  });
});

beforeEach(() => {
  mailer.sent.length = 0;
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('Empezar visita', () => {
  it('lo staff inizia la visita di oggi e la prende; ripetere non cambia nulla', async () => {
    const kit = await newVisit(live.owner, 'Hotel Inicio');
    await startCareVisit(live.staff, kit.visitId);
    const started = await visitRow(kit.visitId);
    expect(started).toMatchObject({
      status: 'IN_PROGRESS',
      startedById: live.staff.userId,
      assignedMembershipId: live.staff.membershipId,
    });
    expect(started.startedAt).toBeInstanceOf(Date);
    await startCareVisit(live.staff, kit.visitId);
    expect((await visitRow(kit.visitId)).startedAt).toEqual(started.startedAt);
    await expect(startCareVisit(live.staff, kit.nextVisitId)).rejects.toThrow(
      new ConflictError('care_visit_future'),
    );
  });

  it('i passi chiedono la visita in corso', async () => {
    const kit = await newVisit(live.owner, 'Oficina Sin Empezar');
    await expect(
      setCareVisitPlantResult(live.staff, kit.visitId, { plantId: kit.potosId, condition: 'OK' }),
    ).rejects.toThrow(new ConflictError('care_visit_not_in_progress'));
    await expect(finishCareVisit(live.staff, kit.visitId, {}, deps)).rejects.toThrow(
      new ConflictError('care_visit_not_in_progress'),
    );
  });
});

describe('i passi della visita', () => {
  it('servizi, piante, "Todas bien" e nota; una pianta o un servizio di un altro contratto no', async () => {
    const kit = await newVisit(live.owner, 'Corporativo Pasos');
    const foreign = await newVisit(live.owner, 'Corporativo Otro');
    await startCareVisit(live.staff, kit.visitId);
    await setCareVisitServiceResult(live.staff, kit.visitId, {
      serviceId: serviceIds[0],
      outcome: 'DONE',
    });
    await setCareVisitServiceResult(live.staff, kit.visitId, {
      serviceId: serviceIds[1],
      outcome: 'SKIPPED',
      note: 'Sin tijeras',
    });
    await setCareVisitPlantResult(live.staff, kit.visitId, {
      plantId: kit.potosId,
      condition: 'PROBLEM',
      affected: '2',
      note: 'Hojas amarillas',
    });
    await expect(
      setCareVisitPlantResult(live.staff, kit.visitId, {
        plantId: kit.potosId,
        condition: 'PROBLEM',
        affected: '13',
      }),
    ).rejects.toMatchObject({ fieldErrors: { affected: 'out_of_range' } });
    await expect(
      setCareVisitPlantResult(live.staff, kit.visitId, {
        plantId: foreign.potosId,
        condition: 'OK',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await markAllCarePlantsOk(live.staff, kit.visitId)).toEqual({ marked: 1 });
    await saveCareVisitNote(live.staff, kit.visitId, { note: 'Regamos todo.' });

    const sheet = await getCareVisitSheet(live.staff, kit.visitId);
    expect(sheet.progress).toMatchObject({
      servicesDone: 2,
      services: 2,
      plantsMarked: 2,
      plants: 2,
    });
    expect(sheet.plants.find((plant) => plant.plantId === kit.potosId)).toMatchObject({
      condition: 'PROBLEM',
      affected: 2,
      note: 'Hojas amarillas',
    });
    expect(sheet.can).toMatchObject({ work: true, removePhotos: true, resolveFollowUps: false });
    // Togliere la scelta di un servizio.
    await setCareVisitServiceResult(live.staff, kit.visitId, {
      serviceId: serviceIds[1],
      outcome: '',
    });
    expect((await getCareVisitSheet(live.staff, kit.visitId)).progress.servicesDone).toBe(1);
  });

  it('"Terminar" chiede lo stato di ogni pianta; poi la visita è hecha con il suo link', async () => {
    const kit = await newVisit(live.owner, 'Clínica Terminar');
    await startCareVisit(live.staff, kit.visitId);
    await setCareVisitPlantResult(live.staff, kit.visitId, {
      plantId: kit.potosId,
      condition: 'OK',
    });
    await expect(finishCareVisit(live.staff, kit.visitId, {}, deps)).rejects.toThrow(
      new ConflictError('care_plants_unmarked'),
    );
    await markAllCarePlantsOk(live.staff, kit.visitId);
    expect(await finishCareVisit(live.staff, kit.visitId, {}, deps)).toEqual({
      alreadyClosed: false,
      report: 'not_requested',
    });
    const done = await visitRow(kit.visitId);
    expect(done).toMatchObject({ status: 'DONE', closedById: live.staff.userId });
    expect(done.finishedAt).toBeInstanceOf(Date);
    const token = await linkToken(live.staff, kit.visitId);
    const report = await getPublicCareVisitReport(deps.secret, token);
    expect(report?.report).toMatchObject({ status: 'DONE', visitedBy: expect.any(String) });
    expect(report?.report.tally).toMatchObject({ total: 13, ok: 13 });
    expect(report?.report).not.toHaveProperty('customerName');

    // Il logo della fioreria accompagna il resoconto come i link di cotizaciones e pedidos.
    expect(report?.shop.logoId).toBeNull();
    expect(await getPublicShopLogo(deps.secret, token, 'CARE_VISIT')).toBeNull();
    const logo = await setStoreImage(live.owner, 'LOGO', await jpeg({ r: 30, g: 120, b: 80 }));
    try {
      expect((await getPublicCareVisitReport(deps.secret, token))?.shop.logoId).toBe(logo.id);
      const image = await getPublicShopLogo(deps.secret, token, 'CARE_VISIT');
      expect(image?.bytes.length).toBeGreaterThan(0);
      // Il token di un resoconto non vale come link di un ordine.
      expect(await getPublicShopLogo(deps.secret, token, 'ORDER')).toBeNull();
    } finally {
      await removeStoreImage(live.owner, 'LOGO');
    }
  });
});

describe('materiali dall’inventario', () => {
  it('escono una sola volta a "Terminar"; senza giacenza serve la conferma', async () => {
    const kit = await newVisit(live.owner, 'Hotel Materiales');
    await startCareVisit(live.staff, kit.visitId);
    const options = await listCareMaterialOptions(live.staff, kit.visitId);
    expect(options.map((option) => option.catalogItemId)).toContain(fertilizerId);
    expect(options[0]).not.toHaveProperty('avgUnitCostMinor');
    await setCareVisitMaterial(live.staff, kit.visitId, {
      catalogItemId: fertilizerId,
      quantity: '5',
    });
    await markAllCarePlantsOk(live.staff, kit.visitId);
    await expect(finishCareVisit(live.staff, kit.visitId, {}, deps)).rejects.toThrow(
      new ConflictError('care_visit_inventory_shortage'),
    );
    expect((await visitRow(kit.visitId)).status).toBe('IN_PROGRESS');
    await finishCareVisit(live.staff, kit.visitId, { confirmShortage: 'on' }, deps);
    await finishCareVisit(live.staff, kit.visitId, { confirmShortage: 'on' }, deps);
    const done = await visitRow(kit.visitId);
    expect(done.inventoryEntryId).not.toBeNull();
    const inventory = await getCatalogItemInventory(live.owner, fertilizerId);
    expect(inventory?.item?.onHand).toBe(-2);
    const entries = await withSystemContext(db, { reason: 'test: registri' }, (tx) =>
      tx.inventoryEntry.count({ where: { tenantId: live.owner.tenantId, kind: 'USE' } }),
    );
    expect(entries).toBe(1);
  });

  it('"No se pudo" non fa uscire nulla; foto e stati restano', async () => {
    const kit = await newVisit(live.owner, 'Tienda Cerrada');
    await startCareVisit(live.staff, kit.visitId);
    await setCareVisitMaterial(live.staff, kit.visitId, {
      catalogItemId: fertilizerId,
      quantity: '1',
    });
    await setCareVisitPlantResult(live.staff, kit.visitId, {
      plantId: kit.monsteraId,
      condition: 'ATTENTION',
    });
    await addCareVisitPhoto(live.staff, kit.visitId, await jpeg({ r: 20, g: 120, b: 40 }), {
      uploadKey: crypto.randomUUID(),
    });
    expect(
      await markCareVisitNotDone(live.staff, kit.visitId, { note: 'Estaba cerrado.' }, deps),
    ).toEqual({ alreadyClosed: false, report: 'not_requested' });
    const visit = await visitRow(kit.visitId);
    expect(visit).toMatchObject({
      status: 'NOT_DONE',
      outcomeNote: 'Estaba cerrado.',
      inventoryEntryId: null,
    });
    expect(await photosOf(kit.visitId)).toHaveLength(1);
    const report = await getPublicCareVisitReport(
      deps.secret,
      await linkToken(live.staff, kit.visitId),
    );
    expect(report?.report).toMatchObject({ status: 'NOT_DONE', note: 'Estaba cerrado.' });
  });
});

describe('foto della visita', () => {
  it('un nuovo tentativo dello stesso file non crea una seconda foto né file orfani', async () => {
    const kit = await newVisit(live.owner, 'Oficinas Foto');
    await startCareVisit(live.staff, kit.visitId);
    const uploadKey = crypto.randomUUID();
    const bytes = await jpeg({ r: 200, g: 40, b: 60 });
    const [first, second] = await Promise.all([
      addCareVisitPhoto(live.staff, kit.visitId, bytes, { uploadKey, plantId: kit.potosId }),
      addCareVisitPhoto(live.staff, kit.visitId, bytes, { uploadKey, plantId: kit.potosId }),
    ]);
    expect(first.id).toBe(second.id);
    const photos = await photosOf(kit.visitId);
    expect(photos).toHaveLength(1);
    expect(photos[0]!.storageKey).toBe(
      `tenants/${live.owner.tenantId}/care-photos/${kit.subscriptionId}-${photos[0]!.id}.jpg`,
    );
    expect(careKeys(live.owner.tenantId).filter((key) => key.includes(photos[0]!.id))).toHaveLength(
      2,
    );
    expect(
      careKeys(live.owner.tenantId).filter((key) => key.includes(kit.subscriptionId)),
    ).toHaveLength(2);
    const image = await getCareVisitPhotoImage(live.staff, kit.visitId, first.id, 'thumb');
    expect(image.contentType).toBe('image/jpeg');
  });

  it('al massimo 20 foto per visita', async () => {
    const kit = await newVisit(live.owner, 'Oficinas Limite');
    await startCareVisit(live.staff, kit.visitId);
    await withSystemContext(db, { reason: 'test: foto già caricate' }, (tx) =>
      tx.carePhoto.createMany({
        data: Array.from({ length: CARE_VISIT_LIMITS.photos }, (_, index) => ({
          tenantId: live.owner.tenantId,
          subscriptionId: kit.subscriptionId,
          visitId: kit.visitId,
          storageKey: `tenants/${live.owner.tenantId}/care-photos/${kit.subscriptionId}-f${index}.jpg`,
          thumbKey: `tenants/${live.owner.tenantId}/care-photos/${kit.subscriptionId}-f${index}-thumb.jpg`,
          contentType: 'image/jpeg',
          width: 10,
          height: 10,
          sizeBytes: 10,
        })),
      }),
    );
    await expect(
      addCareVisitPhoto(live.staff, kit.visitId, await jpeg({ r: 1, g: 2, b: 3 }), {
        uploadKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(new ConflictError('care_photo_limit'));
  });

  it('togliere una foto cancella i file; dopo la chiusura solo chi gestisce', async () => {
    const kit = await newVisit(live.owner, 'Oficinas Quitar');
    await startCareVisit(live.staff, kit.visitId);
    const one = await addCareVisitPhoto(live.staff, kit.visitId, await jpeg({ r: 9, g: 9, b: 9 }), {
      uploadKey: crypto.randomUUID(),
    });
    const two = await addCareVisitPhoto(live.staff, kit.visitId, await jpeg({ r: 8, g: 8, b: 8 }), {
      uploadKey: crypto.randomUUID(),
    });
    await removeCareVisitPhoto(live.staff, kit.visitId, one.id);
    const [removed] = await photosOf(kit.visitId);
    expect(removed).toMatchObject({ id: one.id, removedById: live.staff.userId });
    expect(removed!.deletedAt).toBeInstanceOf(Date);
    expect(careKeys(live.owner.tenantId).some((key) => key.includes(one.id))).toBe(false);
    await expect(
      getCareVisitPhotoImage(live.staff, kit.visitId, one.id, 'full'),
    ).rejects.toBeInstanceOf(NotFoundError);

    await markAllCarePlantsOk(live.staff, kit.visitId);
    await finishCareVisit(live.staff, kit.visitId, {}, deps);
    await expect(removeCareVisitPhoto(live.staff, kit.visitId, two.id)).rejects.toThrow(
      new ConflictError('care_photo_locked'),
    );
    await removeCareVisitPhoto(live.manager, kit.visitId, two.id);
    expect(careKeys(live.owner.tenantId).some((key) => key.includes(two.id))).toBe(false);
  });
});

describe('resoconto per email', () => {
  it('due "Terminar" insieme: un registro, una riga d’uscita, una sola email', async () => {
    const email = `cliente-${STAMP}-a@visitas.example.test`;
    const kit = await newVisit(live.owner, 'Hotel Doble', { email });
    await startCareVisit(live.staff, kit.visitId);
    await setCareVisitMaterial(live.staff, kit.visitId, {
      catalogItemId: fertilizerId,
      quantity: '1',
    });
    await markAllCarePlantsOk(live.staff, kit.visitId);
    const results = await Promise.all([
      finishCareVisit(live.staff, kit.visitId, { sendReport: 'on', confirmShortage: 'on' }, deps),
      finishCareVisit(live.staff, kit.visitId, { sendReport: 'on', confirmShortage: 'on' }, deps),
    ]);
    expect(results.map((result) => result.alreadyClosed).sort()).toEqual([false, true]);
    expect(results.find((result) => !result.alreadyClosed)?.report).toBe('sent');
    expect(await emailsOf(kit.visitId)).toMatchObject([{ status: 'SENT', attempts: 1 }]);
    const sent = mailer.sent.filter((message) => message.to === email);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.category).toBe('care_visit_report');
    expect(sent[0]!.fromName).toBe('Florería Visitas');
    expect(sent[0]!.text).toContain('/visita/');
    expect(sent[0]!.text).not.toContain('$');
  });

  it('demo o cliente senza email: niente riga; un errore di invio lascia la visita hecha', async () => {
    const demoKit = await newVisit(other.owner, 'Cliente Demo', {
      email: `demo-${STAMP}@visitas.example.test`,
      services: otherServiceIds,
    });
    await startCareVisit(other.staff, demoKit.visitId);
    await markAllCarePlantsOk(other.staff, demoKit.visitId);
    expect(
      await finishCareVisit(other.staff, demoKit.visitId, { sendReport: 'on' }, deps),
    ).toMatchObject({ report: 'demo' });
    expect(await emailsOf(demoKit.visitId)).toHaveLength(0);

    const noEmail = await newVisit(live.owner, 'Cliente Sin Correo');
    await startCareVisit(live.staff, noEmail.visitId);
    await markAllCarePlantsOk(live.staff, noEmail.visitId);
    expect(
      await finishCareVisit(live.staff, noEmail.visitId, { sendReport: 'on' }, deps),
    ).toMatchObject({ report: 'no_email' });
    expect(await emailsOf(noEmail.visitId)).toHaveLength(0);

    const failing = await newVisit(live.owner, 'Cliente Correo Caído', {
      email: `caido-${STAMP}@visitas.example.test`,
    });
    await startCareVisit(live.staff, failing.visitId);
    await markAllCarePlantsOk(live.staff, failing.visitId);
    const result = await finishCareVisit(
      live.staff,
      failing.visitId,
      { sendReport: 'on' },
      { ...deps, mailer: new FailingMailer() },
    );
    expect(result.report).toBe('failed');
    expect((await visitRow(failing.visitId)).status).toBe('DONE');
    expect(await emailsOf(failing.visitId)).toMatchObject([
      { status: 'FAILED', attempts: 1, lastError: 'send_failed' },
    ]);

    // Il lavoro giornaliero la riprova e la manda.
    await retryCareEmails(deps);
    expect(await emailsOf(failing.visitId)).toMatchObject([{ status: 'SENT', attempts: 2 }]);
    await expect(sendCareVisitReport(live.staff, failing.visitId, deps)).rejects.toThrow(
      new ConflictError('care_email_not_retryable'),
    );
  });

  it('dopo 3 tentativi basta; una SENDING ferma non si rimanda; un link revocato non si manda', async () => {
    const tries = await newVisit(live.owner, 'Cliente Tres Intentos', {
      email: `tres-${STAMP}@visitas.example.test`,
    });
    await startCareVisit(live.staff, tries.visitId);
    await markAllCarePlantsOk(live.staff, tries.visitId);
    const broken = { ...deps, mailer: new FailingMailer() };
    await finishCareVisit(live.staff, tries.visitId, { sendReport: 'on' }, broken);
    await retryCareEmails(broken);
    await retryCareEmails(broken);
    expect(await emailsOf(tries.visitId)).toMatchObject([{ status: 'FAILED', attempts: 3 }]);
    await retryCareEmails(deps);
    expect(mailer.sent.filter((message) => message.to.startsWith('tres-'))).toHaveLength(0);

    const stuck = await newVisit(live.owner, 'Cliente Atascado', {
      email: `atascado-${STAMP}@visitas.example.test`,
    });
    await startCareVisit(live.staff, stuck.visitId);
    await markAllCarePlantsOk(live.staff, stuck.visitId);
    await finishCareVisit(live.staff, stuck.visitId, { sendReport: 'on' }, null);
    await withSystemContext(db, { reason: 'test: invio interrotto' }, (tx) =>
      tx.careEmail.updateMany({
        where: { visitId: stuck.visitId },
        data: {
          status: 'SENDING',
          attempts: 1,
          createdAt: new Date(Date.now() - 3 * 3_600_000),
          updatedAt: new Date(Date.now() - 2 * 3_600_000),
        },
      }),
    );
    await retryCareEmails(deps);
    expect(await emailsOf(stuck.visitId)).toMatchObject([
      { status: 'FAILED', lastError: 'interrupted', attempts: 3 },
    ]);
    expect(mailer.sent.filter((message) => message.to.startsWith('atascado-'))).toHaveLength(0);

    const revoked = await newVisit(live.owner, 'Cliente Revocado', {
      email: `revocado-${STAMP}@visitas.example.test`,
    });
    await startCareVisit(live.staff, revoked.visitId);
    await markAllCarePlantsOk(live.staff, revoked.visitId);
    await finishCareVisit(live.staff, revoked.visitId, { sendReport: 'on' }, broken);
    await expect(
      revokePublicLink(live.staff, { kind: 'CARE_VISIT', id: revoked.visitId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await revokePublicLink(live.manager, { kind: 'CARE_VISIT', id: revoked.visitId });
    await retryCareEmails(deps);
    expect(await emailsOf(revoked.visitId)).toMatchObject([
      { status: 'FAILED', lastError: 'link_revoked' },
    ]);
  });

  it('"Enviar reporte" dopo: se a "Terminar" non era stato chiesto', async () => {
    const email = `despues-${STAMP}@visitas.example.test`;
    const kit = await newVisit(live.owner, 'Cliente Después', { email });
    await startCareVisit(live.staff, kit.visitId);
    await markAllCarePlantsOk(live.staff, kit.visitId);
    await finishCareVisit(live.staff, kit.visitId, {}, deps);
    expect(await emailsOf(kit.visitId)).toHaveLength(0);
    expect(await sendCareVisitReport(live.staff, kit.visitId, deps)).toBe('sent');
    expect(mailer.sent.filter((message) => message.to === email)).toHaveLength(1);
  });
});

describe('link pubblico del resoconto', () => {
  it('mostra solo la sua visita, senza prezzi né materiali né avvisi', async () => {
    const kit = await newVisit(live.owner, 'Hotel Público');
    const otherKit = await newVisit(live.owner, 'Hotel Vecino');
    await startCareVisit(live.staff, kit.visitId);
    await startCareVisit(live.staff, otherKit.visitId);
    const photo = await addCareVisitPhoto(
      live.staff,
      kit.visitId,
      await jpeg({ r: 50, g: 60, b: 70 }),
      { uploadKey: crypto.randomUUID(), plantId: kit.monsteraId },
    );
    const neighbour = await addCareVisitPhoto(
      live.staff,
      otherKit.visitId,
      await jpeg({ r: 70, g: 60, b: 50 }),
      { uploadKey: crypto.randomUUID() },
    );
    await addCareFollowUp(live.staff, kit.visitId, { kind: 'EXTRA', note: 'Evento el viernes' });
    await setCareVisitMaterial(live.staff, kit.visitId, {
      catalogItemId: fertilizerId,
      quantity: '1',
    });
    await markAllCarePlantsOk(live.staff, kit.visitId);
    await finishCareVisit(live.staff, kit.visitId, { confirmShortage: 'on' }, deps);
    const token = await linkToken(live.staff, kit.visitId);
    const view = await getPublicCareVisitReport(deps.secret, token);
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/Minor|Fertilizante|Evento el viernes/);
    expect(view?.report.photos.map((item) => item.id)).toEqual([photo.id]);
    expect(view?.report.plants.find((plant) => plant.plantId === kit.monsteraId)?.photoIds).toEqual(
      [photo.id],
    );
    expect(await getPublicCareVisitPhoto(deps.secret, token, photo.id, 'thumb')).not.toBeNull();
    expect(await getPublicCareVisitPhoto(deps.secret, token, neighbour.id, 'thumb')).toBeNull();
    expect(await getPublicCareVisitReport(deps.secret, `${token.slice(0, -2)}xx`)).toBeNull();
    await revokePublicLink(live.owner, { kind: 'CARE_VISIT', id: kit.visitId });
    expect(await getPublicCareVisitReport(deps.secret, token)).toBeNull();
  });
});

describe('avvisi per chi gestisce', () => {
  it('una pianta morta crea un solo avviso di reposición; lo risolve chi gestisce', async () => {
    const kit = await newVisit(live.owner, 'Hotel Planta Seca');
    await startCareVisit(live.staff, kit.visitId);
    await setCareVisitPlantResult(live.staff, kit.visitId, {
      plantId: kit.monsteraId,
      condition: 'DEAD',
      note: 'Raíz podrida',
    });
    await addCareFollowUp(live.staff, kit.visitId, {
      kind: 'REPLACEMENT',
      plantId: kit.monsteraId,
      note: 'Reponer Monstera',
    });
    await markAllCarePlantsOk(live.staff, kit.visitId);
    await finishCareVisit(live.staff, kit.visitId, {}, deps);
    const open = await listCareFollowUps(live.staff, 'OPEN');
    const mine = open.items.filter((item) => item.visitId === kit.visitId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'REPLACEMENT', plantName: 'Monstera' });
    expect(open.canResolve).toBe(false);
    await expect(resolveCareFollowUp(live.staff, mine[0]!.id, {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await resolveCareFollowUp(live.manager, mine[0]!.id, {
      resolution: 'NOT_REPLACED',
      note: 'El cliente no la quiere',
    });
    const after = await listCareFollowUps(live.manager, 'OPEN');
    expect(after.items.some((item) => item.id === mine[0]!.id)).toBe(false);
    expect((await getCareAgendaDay(live.manager, iso(today()))).openFollowUps).toEqual(
      expect.any(Number),
    );
  });
});

describe('isolamento fra fiorerie', () => {
  it('visita, foto, avviso e resoconto di una fioreria non esistono per l’altra', async () => {
    const kit = await newVisit(live.owner, 'Hotel Aislado');
    await startCareVisit(live.staff, kit.visitId);
    const photo = await addCareVisitPhoto(
      live.staff,
      kit.visitId,
      await jpeg({ r: 1, g: 1, b: 1 }),
      {
        uploadKey: crypto.randomUUID(),
      },
    );
    await addCareFollowUp(live.staff, kit.visitId, { kind: 'OTHER', note: 'Llave en recepción' });
    const followUp = (await listCareFollowUps(live.owner, 'OPEN')).items.find(
      (item) => item.visitId === kit.visitId,
    )!;
    await expect(getCareVisitSheet(other.owner, kit.visitId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(startCareVisit(other.staff, kit.visitId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      setCareVisitPlantResult(other.staff, kit.visitId, { plantId: kit.potosId, condition: 'OK' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addCareVisitPhoto(other.staff, kit.visitId, await jpeg({ r: 2, g: 2, b: 2 }), {
        uploadKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getCareVisitPhotoImage(other.owner, kit.visitId, photo.id, 'thumb'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeCareVisitPhoto(other.owner, kit.visitId, photo.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      resolveCareFollowUp(other.owner, followUp.id, { resolution: 'HANDLED' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const route = await getDayRoute(other.owner, iso(today()));
    expect(route.stops.some((stop) => stop.kind === 'visit' && stop.visit.id === kit.visitId)).toBe(
      false,
    );
    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.count({ where: { tenantId: null, entityId: kit.visitId } }),
    );
    expect(events).toBeGreaterThan(0);
  });
});

describe('ruta del día e cronologia', () => {
  it('la ruta del giorno ha le visite con la fascia; "mine" solo quelle di chi guarda', async () => {
    const kit = await newVisit(live.owner, 'Hotel Ruta');
    const route = await getDayRoute(live.manager, iso(today()));
    expect(route.includesVisits).toBe(true);
    const stop = route.stops.find((item) => item.kind === 'visit' && item.visit.id === kit.visitId);
    expect(stop).toMatchObject({
      kind: 'visit',
      visit: { windowStart: kit.start, windowEnd: kit.end, plantCount: 13, canStart: true },
    });
    const mine = await getDayRoute(live.manager, iso(today()), { mine: true });
    expect(mine.stops.some((item) => item.kind === 'visit' && item.visit.id === kit.visitId)).toBe(
      false,
    );
    await startCareVisit(live.manager, kit.visitId);
    const mineAfter = await getDayRoute(live.manager, iso(today()), { mine: true });
    expect(
      mineAfter.stops.some((item) => item.kind === 'visit' && item.visit.id === kit.visitId),
    ).toBe(true);
  });

  it('la cronologia del cliente mostra la visita chiusa', async () => {
    const kit = await newVisit(live.owner, 'Hotel Historial');
    await startCareVisit(live.staff, kit.visitId);
    await markAllCarePlantsOk(live.staff, kit.visitId);
    await finishCareVisit(live.staff, kit.visitId, {}, deps);
    const timeline = await getCustomerTimeline(live.owner, kit.customerId);
    expect(timeline.events.find((event) => event.kind === 'care_visit')).toMatchObject({
      kind: 'care_visit',
      visitId: kit.visitId,
      status: 'DONE',
    });
  });

  it('un servizio "una sola vez" fatto non torna nella checklist della visita dopo', async () => {
    const transplant = await createCareService(live.owner, {
      name: `Trasplante ${STAMP}`,
      pricing: 'EXTRA',
      unit: 'ONE_TIME',
      price: '150',
    });
    const kit = await newVisit(live.owner, 'Hotel Una Vez', {
      services: [...serviceIds, transplant.id],
    });
    await startCareVisit(live.staff, kit.visitId);
    await setCareVisitServiceResult(live.staff, kit.visitId, {
      serviceId: transplant.id,
      outcome: 'DONE',
    });
    await markAllCarePlantsOk(live.staff, kit.visitId);
    await finishCareVisit(live.staff, kit.visitId, {}, deps);
    const next = await getCareVisitSheet(live.staff, kit.nextVisitId);
    expect(next.checklist.map((item) => item.serviceId)).not.toContain(transplant.id);
    expect(next.checklist.map((item) => item.serviceId).sort()).toEqual([...serviceIds].sort());
  });
});

describe('cancellazione delle foto a fine contratto', () => {
  async function visitWithPhoto(name: string) {
    const kit = await newVisit(live.owner, name);
    await startCareVisit(live.staff, kit.visitId);
    const photo = await addCareVisitPhoto(
      live.staff,
      kit.visitId,
      await jpeg({ r: 120, g: 120, b: 30 }),
      { uploadKey: crypto.randomUUID() },
    );
    await markAllCarePlantsOk(live.staff, kit.visitId);
    await finishCareVisit(live.staff, kit.visitId, {}, deps);
    return { kit, photoId: photo.id };
  }

  it('30 giorni dopo l’ultimo giorno: prima lo storage, poi la riga; i testi restano', async () => {
    const recent = await visitWithPhoto('Hotel Fin Reciente');
    const old = await visitWithPhoto('Hotel Fin Viejo');
    await endedDaysAgo(recent.kit.subscriptionId, 29);
    await endedDaysAgo(old.kit.subscriptionId, 31);

    // R2 giù: niente si segna; si riprova al giro dopo.
    setObjectStorage(new FailingDeleteStorage());
    const failed = await purgeCarePhotos();
    expect(failed.deleted).toBe(0);
    expect((await photosOf(old.kit.visitId))[0]!.deletedAt).toBeNull();
    setObjectStorage(storage);

    await purgeCarePhotos();
    expect((await photosOf(old.kit.visitId))[0]!.deletedAt).toBeInstanceOf(Date);
    expect(careKeys(live.owner.tenantId).some((key) => key.includes(old.photoId))).toBe(false);
    expect((await photosOf(recent.kit.visitId))[0]!.deletedAt).toBeNull();
    expect(careKeys(live.owner.tenantId).some((key) => key.includes(recent.photoId))).toBe(true);
    const audit = await withTenantContext(
      db,
      { tenantId: live.owner.tenantId, userId: null },
      (tx) =>
        tx.auditLog.findFirst({
          where: {
            tenantId: live.owner.tenantId,
            action: 'care.photos_deleted',
            entityId: old.kit.subscriptionId,
          },
        }),
    );
    expect(audit).toMatchObject({ actorUserId: null, metadata: { job: 'care.photos.purge' } });
    const report = await getPublicCareVisitReport(
      deps.secret,
      await linkToken(live.owner, old.kit.visitId),
    );
    expect(report?.report).toMatchObject({ photosDeleted: true, photos: [] });
    expect(report?.report.tally.total).toBe(13);
  });

  it('se lo storage fallisce da 7 giorni dopo la data, è un errore nel log', async () => {
    const late = await visitWithPhoto('Hotel Fin Atrasado');
    await endedDaysAgo(late.kit.subscriptionId, 40);
    const spy = vi.spyOn(logger, 'error');
    setObjectStorage(new FailingDeleteStorage());
    try {
      await purgeCarePhotos();
      expect(
        spy.mock.calls.some(
          ([payload]) =>
            typeof payload === 'object' &&
            payload !== null &&
            (payload as { subscriptionId?: string }).subscriptionId === late.kit.subscriptionId,
        ),
      ).toBe(true);
    } finally {
      setObjectStorage(storage);
      spy.mockRestore();
    }
    await purgeCarePhotos();
    expect((await photosOf(late.kit.visitId))[0]!.deletedAt).toBeInstanceOf(Date);
  });

  it('cancellando la fioreria (ADR-074) anche le foto delle visite lasciano lo storage', async () => {
    const gone = await createTestShop('Florería Visitas Se Va');
    const { services } = await setUpOffer(gone.owner);
    const kit = await newVisit(gone.owner, 'Cliente De La Que Se Va', { services });
    await startCareVisit(gone.owner, kit.visitId);
    await addCareVisitPhoto(gone.owner, kit.visitId, await jpeg({ r: 3, g: 3, b: 3 }), {
      uploadKey: crypto.randomUUID(),
    });
    await addCareFollowUp(gone.owner, kit.visitId, { kind: 'OTHER', note: 'Llave' });
    await markAllCarePlantsOk(gone.owner, kit.visitId);
    await finishCareVisit(gone.owner, kit.visitId, {}, deps);
    expect(careKeys(gone.tenant.tenantId)).toHaveLength(2);
    await requestTenantDeletion(gone.owner, { confirmName: 'Florería Visitas Se Va' }, null);
    await withSystemContext(db, { reason: 'test: 30 giorni passati' }, (tx) =>
      tx.tenant.update({
        where: { id: gone.tenant.tenantId },
        data: {
          deletionRequestedAt: new Date(Date.now() - 32 * 86_400_000),
          deleteAfter: new Date(Date.now() - 60_000),
        },
      }),
    );
    await purgeDeletedTenants();
    expect(careKeys(gone.tenant.tenantId)).toHaveLength(0);
    const left = await withSystemContext(db, { reason: 'test: righe rimaste' }, (tx) =>
      tx.careVisit.count({ where: { tenantId: gone.tenant.tenantId } }),
    );
    expect(left).toBe(0);
  });
});
