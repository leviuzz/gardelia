import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import {
  addCarePeriods,
  addDays,
  careChargeDueDate,
  carePeriodOf,
  dayOfWeek,
  sameCarePeriod,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
} from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  NotFoundError,
  addCarePlant,
  addCustomerAddress,
  cancelCareVisit,
  changeCareSchedule,
  confirmCareContract,
  createCareContract,
  createCareExtraVisit,
  createCareService,
  createCareSlot,
  createCustomer,
  endCareContract,
  finishCareVisit,
  getCareCharge,
  getCareChargesOverview,
  getCareContract,
  getCareSettings,
  getCustomerCareStatement,
  getCustomerTimeline,
  listCareCharges,
  listCareContracts,
  listContractCharges,
  markAllCarePlantsOk,
  markCareVisitNotDone,
  moveCareVisit,
  recordCareChargePayment,
  recordCustomerCarePayment,
  refundCareCharge,
  repriceCareContract,
  reverseCarePayment,
  setCareVisitServiceResult,
  startCareVisit,
  updateCareSettings,
  updateCareSlot,
  updatePrimaryLocation,
  type CareMailDeps,
  type TenantContext,
} from '../src/index';
import { issueCareCharges } from '../src/jobs/care';
import { jobWriteScope, loadJobScope } from '../src/scope';
import { issueNextCareChargeTx } from '../src/services/care-charges';
import { createTestShop, type TestShop } from '../src/testing';

/**
 * Floral Care, blocco 3a (ADR-082): il cargo del mese (alla conferma e dal lavoro giornaliero),
 * le variazioni sul cargo del mese dopo, il cargo finale a favore del cliente, il cambio di prezzo,
 * i pagamenti (su un cargo, distribuiti, storni, devoluciones), permessi, isolamento fra fiorerie
 * e concorrenza con le visite. "Il mese dopo" si simula passando il suo primo giorno all'emissione.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const STAMP = Date.now().toString(36);
const today = (): CalendarDate => todayInTimeZone(TZ);
const iso = (date: CalendarDate) => toIsoDate(date);
const thisMonth = () => carePeriodOf(today());
const monthsAhead = (count: number) => addCarePeriods(thisMonth(), count);
const dayOf = (date: Date): CalendarDate => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});
const deps: CareMailDeps = {
  mailer: new MemoryMailer(),
  appUrl: 'https://gardelia.example.test',
  secret: 'z'.repeat(48),
};

let shop: TestShop;
let other: TestShop;
let oneTimeServiceId: string;

interface Kit {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly slotId: string;
  readonly perVisitMinor: number;
  /** Le visite del calendario, in ordine: la prima è di oggi. */
  readonly visits: readonly { readonly id: string; readonly date: CalendarDate }[];
}

const slotsUsed = new Map<string, number>();

/** Una fascia nuova di 20 minuti, con 2 posti, diversa per ogni contratto. */
async function nextSlot(ctx: TenantContext, weekday = dayOfWeek(today())): Promise<string> {
  const index = (slotsUsed.get(ctx.tenantId) ?? 0) + 1;
  slotsUsed.set(ctx.tenantId, index);
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const slot = await createCareSlot(ctx, {
    weekday: String(weekday),
    start: time(index * 20),
    end: time(index * 20 + 20),
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
    placeId: `ChIJ_charges_${ctx.tenantSlug}`,
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

async function newCustomer(ctx: TenantContext, name: string): Promise<string> {
  const customer = await createCustomer(ctx, {
    type: 'COMPANY',
    displayName: name,
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550199',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });
  return customer.id;
}

/** Un contratto settimanale confermato che parte oggi (la prima visita è di oggi). */
async function newContract(
  ctx: TenantContext,
  name: string,
  options: { readonly customerId?: string; readonly oneTime?: boolean } = {},
): Promise<Kit> {
  const slotId = await nextSlot(ctx);
  const customerId = options.customerId ?? (await newCustomer(ctx, name));
  const place = await addCustomerAddress(ctx, customerId, {
    label: name,
    recipientName: '',
    recipientPhone: '',
    addressLine1: `Av. Universidad ${100 + (slotsUsed.get(ctx.tenantId) ?? 0)}`,
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
  const watering = settings.services
    .filter((service) => service.presetKey === 'watering')
    .map((service) => service.id);
  const contract = await createCareContract(ctx, customerId, {
    customerAddressId: place.id,
    frequency: 'WEEKLY',
    slotIds: [slotId],
    startDate: iso(today()),
    seats: '',
    serviceIds:
      options.oneTime && ctx.tenantId === shop.tenant.tenantId
        ? [...watering, oneTimeServiceId]
        : watering,
    contactName: 'Recepción',
    contactPhone: '',
    accessNotes: '',
    notes: '',
    outOfRangeConfirmed: '',
  });
  await addCarePlant(ctx, contract.id, { name: 'Potos', quantity: '12', size: 'MEDIUM' });
  await addCarePlant(ctx, contract.id, { name: 'Monstera', quantity: '1', size: 'LARGE' });
  await confirmCareContract(ctx, contract.id);
  const detail = await getCareContract(ctx, contract.id);
  const visits = await withSystemContext(db, { reason: 'test: visite' }, (tx) =>
    tx.careVisit.findMany({
      where: { subscriptionId: contract.id, isExtra: false, status: 'SCHEDULED' },
      orderBy: { originalDate: 'asc' },
      select: { id: true, scheduledDate: true },
    }),
  );
  return {
    subscriptionId: contract.id,
    customerId,
    slotId,
    perVisitMinor: detail.saved?.perVisitMinor ?? 0,
    visits: visits.map((visit) => ({ id: visit.id, date: dayOf(visit.scheduledDate!) })),
  };
}

/** L'emissione del mese come la fa il lavoro giornaliero, con il giorno indicato. */
async function issueOn(ctx: TenantContext, subscriptionId: string, day: CalendarDate) {
  return withTenantContext(db, { tenantId: ctx.tenantId, userId: null }, async (tx) => {
    const job = await loadJobScope(tx, ctx.tenantId, 'care.charges.issue');
    if (!job) throw new Error('fioreria non attiva');
    return issueNextCareChargeTx(tx, jobWriteScope(job), subscriptionId, { today: day });
  });
}

async function chargesOf(subscriptionId: string) {
  return withSystemContext(db, { reason: 'test: cargos' }, (tx) =>
    tx.careCharge.findMany({
      where: { subscriptionId },
      orderBy: [{ period: 'asc' }, { number: 'asc' }],
      include: { lines: { orderBy: { position: 'asc' } } },
    }),
  );
}

async function chargeIn(subscriptionId: string, month: CalendarDate) {
  const all = await chargesOf(subscriptionId);
  return all.find((charge) => sameCarePeriod(dayOf(charge.period), month)) ?? null;
}

/** Le visite del calendario ancora dovute in un mese (programmate o in corso). */
async function liveVisitsIn(subscriptionId: string, month: CalendarDate): Promise<number> {
  const visits = await withSystemContext(db, { reason: 'test: visite del mese' }, (tx) =>
    tx.careVisit.findMany({
      where: { subscriptionId, isExtra: false, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      select: { scheduledDate: true },
    }),
  );
  return visits.filter(
    (visit) => visit.scheduledDate && sameCarePeriod(dayOf(visit.scheduledDate), month),
  ).length;
}

/** Un contratto di prima del blocco 3: senza cargos e senza visite cobrate. */
async function forgetCharges(subscriptionId: string): Promise<void> {
  await withSystemContext(db, { reason: 'test: contratto senza cargos' }, async (tx) => {
    await tx.careChargeLine.deleteMany({ where: { subscriptionId } });
    await tx.careCharge.deleteMany({ where: { subscriptionId } });
    await tx.careVisitBilling.deleteMany({ where: { visit: { subscriptionId } } });
    await tx.customerSubscription.update({
      where: { id: subscriptionId },
      data: { chargedThrough: null },
    });
  });
}

const paid = (amount: number, extra: Record<string, string> = {}) => ({
  amount: (amount / 100).toFixed(2),
  method: 'TRANSFER',
  ...extra,
});

beforeAll(async () => {
  shop = await createTestShop('Florería Cobros');
  other = await createTestShop('Florería Cobros Ajena');
  await setUpOffer(shop.owner);
  await setUpOffer(other.owner);
  oneTimeServiceId = (
    await createCareService(shop.owner, {
      name: 'Trasplante a maceta grande',
      pricing: 'EXTRA',
      unit: 'ONE_TIME',
      price: '150',
    })
  ).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe('cargos: emissione', () => {
  it('alla conferma nasce il cargo del mese con le visite che restano, e le regole si copiano', async () => {
    const kit = await newContract(shop.owner, 'Hotel Cargo Inicio');
    const charges = await chargesOf(kit.subscriptionId);
    expect(charges).toHaveLength(1);
    const charge = charges[0]!;
    const inMonth = kit.visits.filter((visit) => sameCarePeriod(visit.date, thisMonth())).length;
    expect(inMonth).toBeGreaterThan(0);
    expect(iso(dayOf(charge.period))).toBe(iso(thisMonth()));
    expect(charge).toMatchObject({
      visitCount: inMonth,
      unitPriceMinor: kit.perVisitMinor,
      totalMinor: inMonth * kit.perVisitMinor,
      paidMinor: 0,
      balanceMinor: inMonth * kit.perVisitMinor,
      final: false,
      issuedById: shop.owner.userId,
    });
    expect(iso(dayOf(charge.dueDate))).toBe(iso(careChargeDueDate(thisMonth(), today(), 10)));
    expect(charge.lines).toEqual([
      expect.objectContaining({
        kind: 'VISITS',
        quantity: inMonth,
        amountMinor: charge.totalMinor,
      }),
    ]);
    const contract = await getCareContract(shop.owner, kit.subscriptionId);
    expect(contract.rules).toEqual({ missedVisitPolicy: 'COUNTS', deadPlantPolicy: 'QUOTE' });
    expect(contract.canPayments).toBe(true);
    const billed = await withSystemContext(db, { reason: 'test: visite cobrate' }, (tx) =>
      tx.careVisitBilling.findMany({ where: { visit: { subscriptionId: kit.subscriptionId } } }),
    );
    expect(billed).toHaveLength(inMonth);
    expect(billed.every((row) => row.billedMinor === kit.perVisitMinor && !row.stableAt)).toBe(
      true,
    );
    const audit = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
      tx.auditLog.findFirst({ where: { action: 'care.charge_issued', entityId: charge.id } }),
    );
    expect(audit?.metadata).toMatchObject({ period: iso(thisMonth()), visits: inMonth });
  });

  it('il lavoro giornaliero e una seconda emissione non fanno un altro cargo nello stesso mese', async () => {
    const kit = await newContract(shop.owner, 'Hotel Cargo Doble');
    await issueCareCharges();
    expect(await issueOn(shop.owner, kit.subscriptionId, today())).toEqual({ kind: 'done' });
    expect(await chargesOf(kit.subscriptionId)).toHaveLength(1);
  });

  it('un contratto senza cargos (di prima del blocco 3) lo prende il lavoro, senza utente', async () => {
    const kit = await newContract(shop.owner, 'Hotel Cargo Atrasado');
    await forgetCharges(kit.subscriptionId);
    // Il database di test non si svuota: in locale il lavoro può avere altri contratti prima.
    for (let run = 0; run < 30 && !(await chargeIn(kit.subscriptionId, thisMonth())); run += 1) {
      await issueCareCharges();
    }
    const charge = await chargeIn(kit.subscriptionId, thisMonth());
    expect(charge).toMatchObject({ issuedById: null, visitCount: expect.any(Number) });
    const audit = await withSystemContext(db, { reason: 'test: registro del lavoro' }, (tx) =>
      tx.auditLog.findFirst({ where: { action: 'care.charge_issued', entityId: charge!.id } }),
    );
    expect(audit).toMatchObject({ actorUserId: null, metadata: { job: 'care.charges.issue' } });
  });

  it('mesi saltati: uno per volta, in ordine, finché non si arriva a quello di oggi', async () => {
    const kit = await newContract(shop.owner, 'Hotel Cargo Saltos');
    const first = await issueOn(shop.owner, kit.subscriptionId, monthsAhead(3));
    expect(first).toMatchObject({ kind: 'issued', period: monthsAhead(1), more: true });
    expect(await issueOn(shop.owner, kit.subscriptionId, monthsAhead(3))).toMatchObject({
      period: monthsAhead(2),
      more: true,
    });
    expect(await issueOn(shop.owner, kit.subscriptionId, monthsAhead(3))).toMatchObject({
      period: monthsAhead(3),
      more: false,
    });
    expect(await issueOn(shop.owner, kit.subscriptionId, monthsAhead(3))).toEqual({ kind: 'done' });
    const periods = (await chargesOf(kit.subscriptionId)).map((charge) =>
      iso(dayOf(charge.period)),
    );
    expect(new Set(periods).size).toBe(periods.length);
  });
});

describe('cargos: le variazioni vanno sul cargo del mese dopo', () => {
  it('credito se la fioreria toglie la visita o non può andare; niente se è il cliente', async () => {
    const notDoneShop = await newContract(shop.owner, 'Oficina No Pudimos');
    const notDoneCustomer = await newContract(shop.owner, 'Oficina Cerrada');
    const cancelledShop = await newContract(shop.owner, 'Oficina Cancelada Florería');
    const cancelledCustomer = await newContract(shop.owner, 'Oficina Cancelada Cliente');
    await markCareVisitNotDone(shop.staff, notDoneShop.visits[0]!.id, { cause: 'SHOP' }, deps);
    await markCareVisitNotDone(shop.staff, notDoneCustomer.visits[0]!.id, {}, deps);
    await cancelCareVisit(shop.manager, cancelledShop.visits[0]!.id, {
      reason: 'SHOP',
      customerNotified: 'on',
    });
    await cancelCareVisit(shop.manager, cancelledCustomer.visits[0]!.id, {
      reason: 'CUSTOMER',
      customerNotified: 'on',
    });
    const cause = await withSystemContext(db, { reason: 'test: causa' }, (tx) =>
      tx.careVisit.findUniqueOrThrow({ where: { id: notDoneCustomer.visits[0]!.id } }),
    );
    expect(cause.notDoneCause).toBe('CUSTOMER');

    const next = monthsAhead(1);
    for (const kit of [notDoneShop, notDoneCustomer, cancelledShop, cancelledCustomer]) {
      await issueOn(shop.owner, kit.subscriptionId, next);
    }
    const credits = async (kit: Kit) =>
      ((await chargeIn(kit.subscriptionId, next))?.lines ?? [])
        .filter((line) => line.kind === 'VISIT_CREDIT')
        .map((line) => [line.visitId, line.creditReason, line.amountMinor]);
    expect(await credits(notDoneShop)).toEqual([
      [notDoneShop.visits[0]!.id, 'NOT_DONE', -notDoneShop.perVisitMinor],
    ]);
    expect(await credits(cancelledShop)).toEqual([
      [cancelledShop.visits[0]!.id, 'SHOP', -cancelledShop.perVisitMinor],
    ]);
    expect(await credits(notDoneCustomer)).toEqual([]);
    expect(await credits(cancelledCustomer)).toEqual([]);
    // Il cargo del mese dopo ha le sue visite al prezzo del contratto.
    const charge = await chargeIn(notDoneCustomer.subscriptionId, next);
    const nextVisits = await liveVisitsIn(notDoneCustomer.subscriptionId, next);
    const visitsLine = charge?.lines.find((line) => line.kind === 'VISITS');
    expect(visitsLine?.quantity ?? 0).toBe(nextVisits);
    // Le visite chiuse sono sistemate e non si guardano più.
    const stable = await withSystemContext(db, { reason: 'test: visite sistemate' }, (tx) =>
      tx.careVisitBilling.findUnique({
        where: {
          tenantId_visitId: {
            tenantId: shop.tenant.tenantId,
            visitId: notDoneShop.visits[0]!.id,
          },
        },
      }),
    );
    expect(stable).toMatchObject({ billedMinor: null, stableAt: expect.any(Date) });
  });

  it('una visita extra fatta e un servizio "una sola vez" fatto si cobran una volta', async () => {
    const kit = await newContract(shop.owner, 'Hotel Extras Cobrados', { oneTime: true });
    const visit = kit.visits[0]!.id;
    await startCareVisit(shop.staff, visit);
    await setCareVisitServiceResult(shop.staff, visit, {
      serviceId: oneTimeServiceId,
      outcome: 'DONE',
    });
    await markAllCarePlantsOk(shop.staff, visit);
    await finishCareVisit(shop.staff, visit, {}, deps);
    const extra = await createCareExtraVisit(shop.manager, kit.subscriptionId, {
      kind: 'EXTRA',
      placement: 'TIME',
      date: iso(today()),
      start: '23:00',
      end: '23:30',
      fee: 'VISIT_FEE',
    });
    await startCareVisit(shop.staff, extra.visitId);
    await markAllCarePlantsOk(shop.staff, extra.visitId);
    await finishCareVisit(shop.staff, extra.visitId, {}, deps);

    await issueOn(shop.owner, kit.subscriptionId, monthsAhead(1));
    const charge = await chargeIn(kit.subscriptionId, monthsAhead(1));
    const extras = charge!.lines.filter((line) =>
      ['EXTRA_VISIT', 'ONE_TIME_SERVICE'].includes(line.kind),
    );
    expect(extras.map((line) => [line.kind, line.amountMinor, line.label])).toEqual([
      ['EXTRA_VISIT', 45_000, null],
      ['ONE_TIME_SERVICE', 15_000, 'Trasplante a maceta grande'],
    ]);
    // Il mese dopo ancora: niente di nuovo.
    await issueOn(shop.owner, kit.subscriptionId, monthsAhead(2));
    const later = await chargeIn(kit.subscriptionId, monthsAhead(2));
    expect(
      (later?.lines ?? []).filter((line) =>
        ['EXTRA_VISIT', 'ONE_TIME_SERVICE'].includes(line.kind),
      ),
    ).toEqual([]);
  });

  it('cambio di calendario: le visite tolte tornano come credito e le nuove come debito', async () => {
    const kit = await newContract(shop.owner, 'Hotel Nuevo Horario');
    const slot = await nextSlot(shop.owner);
    const result = await changeCareSchedule(shop.owner, kit.subscriptionId, {
      frequency: 'WEEKLY',
      slotIds: [slot],
      startDate: iso(today()),
      seats: '',
      customerNotified: 'on',
    });
    expect(result.cancelled).toBeGreaterThan(0);
    await issueOn(shop.owner, kit.subscriptionId, monthsAhead(1));
    const charge = await chargeIn(kit.subscriptionId, monthsAhead(1));
    const credits = charge!.lines.filter((line) => line.kind === 'VISIT_CREDIT');
    const debits = charge!.lines.filter((line) => line.kind === 'VISIT_DEBIT');
    expect(credits.length).toBeGreaterThan(0);
    expect(credits.every((line) => line.creditReason === 'SCHEDULE_CHANGE')).toBe(true);
    // Le visite di questo mese sono le stesse in giorni nuovi: credito e debito si compensano.
    expect(debits.length).toBe(credits.length);
    const sum = (lines: typeof credits) =>
      lines.reduce((total, line) => total + line.amountMinor, 0);
    expect(sum(credits) + sum(debits)).toBe(0);
  });
});

describe('cargos: contratto finito e cambio di prezzo', () => {
  it('il cargo dopo la fine resta a favore del cliente e si chiude con la devolución', async () => {
    const kit = await newContract(shop.owner, 'Hotel Fin de Contrato');
    await markCareVisitNotDone(shop.staff, kit.visits[0]!.id, { cause: 'SHOP' }, deps);
    await endCareContract(shop.owner, kit.subscriptionId, {
      endDate: iso(today()),
      customerNotified: 'on',
    });
    await issueOn(shop.owner, kit.subscriptionId, monthsAhead(1));
    const charge = await chargeIn(kit.subscriptionId, monthsAhead(1));
    expect(charge).toMatchObject({ final: true });
    expect(charge!.totalMinor).toBeLessThan(0);
    expect(charge!.lines.every((line) => line.kind === 'VISIT_CREDIT')).toBe(true);
    expect(charge!.lines.some((line) => line.creditReason === 'NOT_DONE')).toBe(true);
    const credit = -charge!.totalMinor;
    const detail = await getCareCharge(shop.owner, kit.subscriptionId, charge!.id);
    expect(detail).toMatchObject({ status: 'IN_FAVOR', canRefund: true, canPay: false });

    await expect(
      refundCareCharge(shop.owner, kit.subscriptionId, charge!.id, paid(credit + 100)),
    ).rejects.toMatchObject({ fieldErrors: { amount: 'care_refund_exceeds_credit' } });
    await expect(
      recordCareChargePayment(shop.owner, kit.subscriptionId, charge!.id, paid(100)),
    ).rejects.toMatchObject({ fieldErrors: { amount: 'payment_exceeds_balance' } });
    await refundCareCharge(shop.owner, kit.subscriptionId, charge!.id, paid(credit));
    const refunded = await getCareCharge(shop.owner, kit.subscriptionId, charge!.id);
    expect(refunded).toMatchObject({ status: 'REFUNDED', balanceMinor: 0, paidMinor: -credit });
    expect(refunded.payments).toEqual([
      expect.objectContaining({ kind: 'REFUND', amountMinor: -credit }),
    ]);
    await expect(
      refundCareCharge(shop.owner, kit.subscriptionId, charge!.id, paid(100)),
    ).rejects.toThrow(new ConflictError('care_charge_not_in_favor'));
  });

  it('un cambio di prezzo vale dal mese dopo: il mese in corso si emette prima al prezzo vecchio', async () => {
    const kit = await newContract(shop.owner, 'Hotel Precio Nuevo');
    await forgetCharges(kit.subscriptionId);
    await addCarePlant(shop.owner, kit.subscriptionId, {
      name: 'Palma',
      quantity: '2',
      size: 'LARGE',
    });
    expect(
      await repriceCareContract(shop.owner, kit.subscriptionId, { customerNotified: 'on' }),
    ).toEqual({ changed: true });
    const current = await chargeIn(kit.subscriptionId, thisMonth());
    expect(current?.unitPriceMinor).toBe(kit.perVisitMinor);
    const repriced = (await getCareContract(shop.owner, kit.subscriptionId)).saved!.perVisitMinor;
    expect(repriced).toBe(kit.perVisitMinor + 2 * 4000);
    await issueOn(shop.owner, kit.subscriptionId, monthsAhead(1));
    const next = await chargeIn(kit.subscriptionId, monthsAhead(1));
    if (next) expect(next.unitPriceMinor).toBe(repriced);
  });
});

describe('pagamenti', () => {
  it('su un cargo: parziale, poi pagato; mai oltre il saldo, mai 0, mai una data futura', async () => {
    const kit = await newContract(shop.owner, 'Hotel Pago Parcial');
    const charge = (await chargeIn(kit.subscriptionId, thisMonth()))!;
    const pay = (input: Record<string, string>) =>
      recordCareChargePayment(shop.manager, kit.subscriptionId, charge.id, input);
    await expect(pay(paid(0))).rejects.toMatchObject({
      fieldErrors: { amount: 'care_payment_zero' },
    });
    await expect(pay(paid(100, { paidOn: iso(addDays(today(), 1)) }))).rejects.toMatchObject({
      fieldErrors: { paidOn: 'care_paid_on_future' },
    });
    await expect(pay(paid(charge.totalMinor + 100))).rejects.toMatchObject({
      fieldErrors: { amount: 'payment_exceeds_balance' },
    });
    await pay(paid(10_000, { reference: 'SPEI 0001', note: 'Primer abono' }));
    expect(await getCareCharge(shop.owner, kit.subscriptionId, charge.id)).toMatchObject({
      status: 'PARTIAL',
      paidMinor: 10_000,
      balanceMinor: charge.totalMinor - 10_000,
    });
    await pay(paid(charge.totalMinor - 10_000, { paidOn: iso(today()) }));
    const detail = await getCareCharge(shop.owner, kit.subscriptionId, charge.id);
    expect(detail).toMatchObject({ status: 'PAID', balanceMinor: 0, canPay: false });
    expect(detail.payments.map((payment) => payment.amountMinor)).toEqual([
      10_000,
      charge.totalMinor - 10_000,
    ]);
    // Nel registro numeri e importi, mai la referencia o la nota.
    const audit = await withSystemContext(db, { reason: 'test: registro pagamenti' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: shop.tenant.tenantId, action: 'care.payment_recorded' },
      }),
    );
    expect(JSON.stringify(audit)).not.toContain('SPEI 0001');
    expect(JSON.stringify(audit)).not.toContain('Primer abono');
    const list = await listCareCharges(shop.owner, { view: 'paid' });
    expect(list.items.some((item) => item.id === charge.id)).toBe(true);
    const open = await listCareCharges(shop.owner, { view: 'open' });
    expect(open.items.some((item) => item.id === charge.id)).toBe(false);
  });

  it('"Anular" una volta sola, anche con due richieste insieme', async () => {
    const kit = await newContract(shop.owner, 'Hotel Anular Pago');
    const charge = (await chargeIn(kit.subscriptionId, thisMonth()))!;
    const { paymentId } = await recordCareChargePayment(
      shop.owner,
      kit.subscriptionId,
      charge.id,
      paid(charge.totalMinor),
    );
    const results = await Promise.allSettled([
      reverseCarePayment(shop.owner, paymentId),
      reverseCarePayment(shop.manager, paymentId),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      reason: 'payment_already_reversed',
    });
    const detail = await getCareCharge(shop.owner, kit.subscriptionId, charge.id);
    expect(detail).toMatchObject({ status: 'PENDING', paidMinor: 0 });
    const reversal = detail.payments.find((payment) => payment.kind === 'REVERSAL');
    expect(reversal?.amountMinor).toBe(-charge.totalMinor);
    expect(detail.payments.find((payment) => payment.id === paymentId)?.reversed).toBe(true);
    await expect(reverseCarePayment(shop.owner, reversal!.id)).rejects.toThrow(
      new ConflictError('care_payment_not_reversible'),
    );
  });

  it('due pagamenti insieme non superano il saldo; lo stesso modulo due volte vale uno', async () => {
    const kit = await newContract(shop.owner, 'Hotel Pagos Juntos');
    const charge = (await chargeIn(kit.subscriptionId, thisMonth()))!;
    const part = Math.ceil((charge.totalMinor * 0.6) / 100) * 100;
    const results = await Promise.allSettled([
      recordCareChargePayment(shop.owner, kit.subscriptionId, charge.id, paid(part)),
      recordCareChargePayment(shop.manager, kit.subscriptionId, charge.id, paid(part)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    let detail = await getCareCharge(shop.owner, kit.subscriptionId, charge.id);
    expect(detail.paidMinor).toBe(part);

    const submitKey = randomUUID();
    const first = await recordCareChargePayment(
      shop.owner,
      kit.subscriptionId,
      charge.id,
      paid(100, { submitKey }),
    );
    const again = await recordCareChargePayment(
      shop.owner,
      kit.subscriptionId,
      charge.id,
      paid(100, { submitKey }),
    );
    expect(again.paymentId).toBe(first.paymentId);
    detail = await getCareCharge(shop.owner, kit.subscriptionId, charge.id);
    expect(detail.paidMinor).toBe(part + 100);
  });

  it('estado de cuenta: un pagamento per due sedi va ai cargos più vecchi', async () => {
    const customerId = await newCustomer(shop.owner, 'Corporativo Dos Sedes');
    const north = await newContract(shop.owner, 'Sede Norte', { customerId });
    const south = await newContract(shop.owner, 'Sede Sur', { customerId });
    await issueOn(shop.owner, north.subscriptionId, monthsAhead(1));
    const northNow = (await chargeIn(north.subscriptionId, thisMonth()))!;
    const southNow = (await chargeIn(south.subscriptionId, thisMonth()))!;
    const northNext = await chargeIn(north.subscriptionId, monthsAhead(1));
    const statement = await getCustomerCareStatement(shop.owner, customerId);
    expect(statement.contracts.map((contract) => contract.id)).toEqual([
      north.subscriptionId,
      south.subscriptionId,
    ]);
    const owed = northNow.totalMinor + southNow.totalMinor + (northNext?.totalMinor ?? 0);
    expect(statement.totals.openMinor).toBe(owed);

    await expect(
      recordCustomerCarePayment(shop.owner, customerId, paid(owed + 100)),
    ).rejects.toMatchObject({ fieldErrors: { amount: 'payment_exceeds_balance' } });
    const amount = northNow.totalMinor + southNow.totalMinor + (northNext ? 100 : 0);
    const result = await recordCustomerCarePayment(shop.owner, customerId, paid(amount));
    expect(result.charges).toBe(northNext ? 3 : 2);
    const after = await getCustomerCareStatement(shop.owner, customerId);
    const balances = new Map(after.charges.map((charge) => [charge.id, charge.balanceMinor]));
    expect(balances.get(northNow.id)).toBe(0);
    expect(balances.get(southNow.id)).toBe(0);
    if (northNext) expect(balances.get(northNext.id)).toBe(northNext.totalMinor - 100);
    const movement = after.payments.find((payment) => payment.id === result.paymentId);
    expect(movement?.charges.map((charge) => charge.id)).toEqual(
      [northNow.id, southNow.id, northNext?.id].filter(Boolean),
    );

    // Annullato, torna tutto com'era.
    await reverseCarePayment(shop.owner, result.paymentId);
    const restored = await getCustomerCareStatement(shop.owner, customerId);
    expect(restored.totals.openMinor).toBe(owed);
  });
});

describe('permessi e isolamento', () => {
  it('lo staff non vede né registra i soldi; il gerente sì', async () => {
    const kit = await newContract(shop.owner, 'Hotel Permisos Cobro');
    const charge = (await chargeIn(kit.subscriptionId, thisMonth()))!;
    await expect(listCareCharges(shop.staff, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getCareCharge(shop.staff, kit.subscriptionId, charge.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      recordCareChargePayment(shop.staff, kit.subscriptionId, charge.id, paid(100)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getCustomerCareStatement(shop.staff, kit.customerId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listContractCharges(shop.staff, kit.subscriptionId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await getCareChargesOverview(shop.staff)).toBeNull();
    expect((await getCareContract(shop.staff, kit.subscriptionId)).canPayments).toBe(false);
    const timeline = await getCustomerTimeline(shop.staff, kit.customerId);
    expect(timeline.events.some((event) => event.kind === 'care_charge')).toBe(false);
    expect((await listCareCharges(shop.manager, {})).items.length).toBeGreaterThan(0);
  });

  it('un’altra fioreria non trova cargos, pagamenti né l’estado de cuenta (404 con evento)', async () => {
    const kit = await newContract(shop.owner, 'Hotel Aislado Cobros');
    const charge = (await chargeIn(kit.subscriptionId, thisMonth()))!;
    const { paymentId } = await recordCareChargePayment(
      shop.owner,
      kit.subscriptionId,
      charge.id,
      paid(1000),
    );
    await expect(getCareCharge(other.owner, kit.subscriptionId, charge.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      recordCareChargePayment(other.owner, kit.subscriptionId, charge.id, paid(100)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      refundCareCharge(other.owner, kit.subscriptionId, charge.id, paid(100)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(reverseCarePayment(other.owner, paymentId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCustomerCareStatement(other.owner, kit.customerId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      recordCustomerCarePayment(other.owner, kit.customerId, paid(100)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(listContractCharges(other.owner, kit.subscriptionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const theirs = await listCareCharges(other.owner, { view: 'open' });
    expect(theirs.items.some((item) => item.id === charge.id)).toBe(false);
    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: null,
          entityId: { in: [charge.id, paymentId] },
          action: 'security.cross_tenant_access_attempt',
        },
      }),
    );
    expect(new Set(events.map((event) => event.entityType))).toEqual(
      new Set(['CareCharge', 'CarePayment']),
    );
    // Niente cambia nella fioreria vera.
    expect((await getCareCharge(shop.owner, kit.subscriptionId, charge.id)).paidMinor).toBe(1000);
  });

  it('il database non lascia distribuire un pagamento sui cargos di un altro cliente', async () => {
    const first = await newContract(shop.owner, 'Cliente Uno Cobro');
    const second = await newContract(shop.owner, 'Cliente Dos Cobro');
    const firstCharge = (await chargeIn(first.subscriptionId, thisMonth()))!;
    const secondCharge = (await chargeIn(second.subscriptionId, thisMonth()))!;
    const { paymentId } = await recordCareChargePayment(
      shop.owner,
      first.subscriptionId,
      firstCharge.id,
      paid(100),
    );
    await expect(
      withSystemContext(db, { reason: 'test: distribuzione sbagliata' }, (tx) =>
        tx.carePaymentAllocation.create({
          data: {
            tenantId: shop.tenant.tenantId,
            paymentId,
            chargeId: secondCharge.id,
            customerId: first.customerId,
            amountMinor: 100,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('concorrenza con le visite', () => {
  it('emissione, "Terminar", uno spostamento e il cambio di una fascia insieme: niente stalli', async () => {
    const kit = await newContract(shop.owner, 'Hotel Todo a la Vez');
    const today0 = kit.visits[0]!.id;
    const later = kit.visits[1]!;
    await startCareVisit(shop.staff, today0);
    await markAllCarePlantsOk(shop.staff, today0);
    const target = addDays(later.date, 1);
    const targetSlot = await nextSlot(shop.owner, dayOfWeek(target));
    const results = await Promise.allSettled([
      issueOn(shop.owner, kit.subscriptionId, monthsAhead(1)),
      finishCareVisit(shop.staff, today0, {}, deps),
      moveCareVisit(shop.manager, later.id, {
        date: iso(target),
        slotId: targetSlot,
        customerNotified: 'on',
      }),
      updateCareSlot(shop.owner, kit.slotId, {
        weekday: String(dayOfWeek(today())),
        start: '22:00',
        end: '22:20',
        capacity: '2',
        customerNotified: 'on',
      }),
    ]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [String(result.reason)] : [],
    );
    expect(failures).toEqual([]);
    const periods = (await chargesOf(kit.subscriptionId)).map((charge) =>
      iso(dayOf(charge.period)),
    );
    expect(new Set(periods).size).toBe(periods.length);
  });
});

describe('cronologia, pannello ed elenco', () => {
  it('cargos e pagamenti nella cronologia; il pannello e l’elenco segnano i vencidos', async () => {
    const kit = await newContract(shop.owner, 'Hotel Vencido');
    const charge = (await chargeIn(kit.subscriptionId, thisMonth()))!;
    await recordCareChargePayment(shop.owner, kit.subscriptionId, charge.id, paid(500));
    const timeline = await getCustomerTimeline(shop.owner, kit.customerId);
    expect(timeline.events.some((event) => event.kind === 'care_charge')).toBe(true);
    expect(timeline.events.some((event) => event.kind === 'care_payment')).toBe(true);

    // Scaduto da due giorni (emesso il giorno prima della scadenza).
    const due = addDays(today(), -2);
    await withSystemContext(db, { reason: 'test: cargo scaduto' }, (tx) =>
      tx.careCharge.update({
        where: { id: charge.id },
        data: {
          issuedOn: new Date(Date.UTC(due.year, due.month - 1, due.day - 1)),
          dueDate: new Date(Date.UTC(due.year, due.month - 1, due.day)),
        },
      }),
    );
    const detail = await getCareCharge(shop.owner, kit.subscriptionId, charge.id);
    expect(detail.status).toBe('OVERDUE');
    const overview = await getCareChargesOverview(shop.owner);
    expect(overview?.overdueCount).toBeGreaterThanOrEqual(1);
    expect(overview?.overdueMinor).toBeGreaterThanOrEqual(detail.balanceMinor);
    const overdue = await listCareCharges(shop.owner, { view: 'overdue' });
    expect(overdue.items.some((item) => item.id === charge.id)).toBe(true);
    const contracts = await listCareContracts(shop.owner, { q: 'Hotel Vencido' });
    expect(contracts.items.find((item) => item.id === kit.subscriptionId)?.overdue).toBe(true);
    const staffContracts = await listCareContracts(shop.staff, { q: 'Hotel Vencido' });
    expect(staffContracts.items.find((item) => item.id === kit.subscriptionId)?.overdue).toBe(
      false,
    );
    const summary = await listContractCharges(shop.owner, kit.subscriptionId);
    expect(summary).toMatchObject({ total: 1, overdueCount: 1 });
  });
});
