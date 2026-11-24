import { describe, expect, it } from 'vitest';
import {
  allocateCarePayment,
  careAdjustmentSchema,
  careBillingPeriods,
  careChargeDueDate,
  careChargeListFiltersSchema,
  careChargeStatus,
  careCollectionConfirmSchema,
  careCollectionRejectSchema,
  careCreditReason,
  careExtraVisitCharge,
  careNotDoneSchema,
  carePaymentSchema,
  careSettingsSchema,
  careVisitCollectionSchema,
  careVisitOwed,
  careVisitRecoverable,
  formatCareChargeNumber,
  isCareChargeOpen,
  planCareChargeLines,
  toFieldErrors,
  type CalendarDate,
  type CareBillableVisit,
  type CareChargePlanInput,
} from '../src/index';

function d(iso: string): CalendarDate {
  const [year, month, day] = iso.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

let counter = 0;
function visit(
  overrides: Partial<CareBillableVisit> & { readonly date: string },
): CareBillableVisit {
  counter += 1;
  const { date, ...rest } = overrides;
  return {
    id: `v-${String(counter).padStart(3, '0')}`,
    isExtra: false,
    status: 'SCHEDULED',
    cancelReason: null,
    notDoneCause: null,
    scheduledDate: d(date),
    originalDate: d(date),
    extraFee: null,
    extraFeeMinor: null,
    billedMinor: null,
    ...rest,
  };
}

function plan(overrides: Partial<CareChargePlanInput>) {
  const result = planCareChargeLines({
    period: d('2026-12-01'),
    unitPriceMinor: 49_000,
    pastPrices: new Map(),
    visits: [],
    oneTimeServices: [],
    carriedIn: [],
    final: false,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

function errors(result: { success: boolean; error?: unknown }) {
  if (result.success) return {};
  return toFieldErrors(result.error as Parameters<typeof toFieldErrors>[0]);
}

describe('cargos: visita dovuta', () => {
  it('si pagano le programmate, le fatte, il cliente che non apre e la cancellazione del cliente', () => {
    const owed = (input: Partial<Parameters<typeof careVisitOwed>[0]>) =>
      careVisitOwed({ status: 'SCHEDULED', cancelReason: null, notDoneCause: null, ...input });
    expect(owed({ status: 'SCHEDULED' })).toBe(true);
    expect(owed({ status: 'IN_PROGRESS' })).toBe(true);
    expect(owed({ status: 'DONE' })).toBe(true);
    expect(owed({ status: 'NOT_DONE', notDoneCause: 'CUSTOMER' })).toBe(true);
    // Le visite "No se pudo" del blocco 2 non hanno la causa: valgono come il cliente che non apre.
    expect(owed({ status: 'NOT_DONE', notDoneCause: null })).toBe(true);
    expect(owed({ status: 'CANCELLED', cancelReason: 'CUSTOMER' })).toBe(true);
  });

  it('non si pagano quelle tolte dalla fioreria né "Por reprogramar"', () => {
    const owed = (input: Partial<Parameters<typeof careVisitOwed>[0]>) =>
      careVisitOwed({ status: 'SCHEDULED', cancelReason: null, notDoneCause: null, ...input });
    expect(owed({ status: 'NOT_DONE', notDoneCause: 'SHOP' })).toBe(false);
    expect(owed({ status: 'TO_RESCHEDULE' })).toBe(false);
    for (const reason of ['SHOP', 'SCHEDULE_CHANGE', 'CONTRACT_END'] as const) {
      expect(owed({ status: 'CANCELLED', cancelReason: reason })).toBe(false);
    }
  });

  it('una visita extra si cobra solo fatta e con la tariffa per visita', () => {
    expect(
      careExtraVisitCharge({ status: 'DONE', extraFee: 'VISIT_FEE', extraFeeMinor: 35_000 }),
    ).toBe(35_000);
    expect(
      careExtraVisitCharge({ status: 'SCHEDULED', extraFee: 'VISIT_FEE', extraFeeMinor: 35_000 }),
    ).toBe(0);
    expect(careExtraVisitCharge({ status: 'DONE', extraFee: 'FREE', extraFeeMinor: 0 })).toBe(0);
    expect(careExtraVisitCharge({ status: 'DONE', extraFee: 'QUOTE', extraFeeMinor: 0 })).toBe(0);
    expect(
      careExtraVisitCharge({ status: 'NOT_DONE', extraFee: 'VISIT_FEE', extraFeeMinor: 35_000 }),
    ).toBe(0);
  });

  it('il credito ricorda perché', () => {
    expect(careCreditReason({ status: 'TO_RESCHEDULE', cancelReason: null })).toBe('TO_RESCHEDULE');
    expect(careCreditReason({ status: 'NOT_DONE', cancelReason: null })).toBe('NOT_DONE');
    expect(careCreditReason({ status: 'CANCELLED', cancelReason: 'SHOP' })).toBe('SHOP');
    expect(careCreditReason({ status: 'CANCELLED', cancelReason: 'SCHEDULE_CHANGE' })).toBe(
      'SCHEDULE_CHANGE',
    );
    expect(careCreditReason({ status: 'CANCELLED', cancelReason: 'CONTRACT_END' })).toBe(
      'CONTRACT_END',
    );
  });
});

describe('cargos: i mesi da emettere', () => {
  it('dal mese di inizio fino a quello in corso, al massimo 3 per giro', () => {
    expect(
      careBillingPeriods({
        firstPeriod: d('2026-11-18'),
        chargedThrough: null,
        currentPeriod: d('2026-11-24'),
        max: 3,
      }),
    ).toEqual([d('2026-11-01')]);
    expect(
      careBillingPeriods({
        firstPeriod: d('2026-08-10'),
        chargedThrough: null,
        currentPeriod: d('2026-12-02'),
        max: 3,
      }),
    ).toEqual([d('2026-08-01'), d('2026-09-01'), d('2026-10-01')]);
    // Il giro dopo riparte dal mese dopo l'ultimo emesso.
    expect(
      careBillingPeriods({
        firstPeriod: d('2026-08-10'),
        chargedThrough: d('2026-10-01'),
        currentPeriod: d('2026-12-02'),
        max: 3,
      }),
    ).toEqual([d('2026-11-01'), d('2026-12-01')]);
  });

  it('niente se è già emesso o se il contratto parte più avanti; fine anno compresa', () => {
    expect(
      careBillingPeriods({
        firstPeriod: d('2026-11-01'),
        chargedThrough: d('2026-12-01'),
        currentPeriod: d('2026-12-15'),
        max: 3,
      }),
    ).toEqual([]);
    expect(
      careBillingPeriods({
        firstPeriod: d('2027-01-05'),
        chargedThrough: null,
        currentPeriod: d('2026-12-15'),
        max: 3,
      }),
    ).toEqual([]);
    expect(
      careBillingPeriods({
        firstPeriod: d('2026-12-01'),
        chargedThrough: d('2026-12-01'),
        currentPeriod: d('2027-01-01'),
        max: 3,
      }),
    ).toEqual([d('2027-01-01')]);
  });
});

describe('cargos: le righe del mese', () => {
  it('primo mese in proporzione: le visite che restano nel mese, insieme', () => {
    const result = plan({
      period: d('2026-11-01'),
      visits: [
        visit({ date: '2026-11-24' }),
        visit({ date: '2026-11-26' }),
        visit({ date: '2026-12-01' }),
      ],
    });
    expect(result.lines).toEqual([
      expect.objectContaining({
        kind: 'VISITS',
        quantity: 2,
        unitPriceMinor: 49_000,
        amountMinor: 98_000,
      }),
    ]);
    expect(result.totalMinor).toBe(98_000);
    expect(result.visitCount).toBe(2);
    // La visita di dicembre resta per il cargo di dicembre.
    expect(result.billing.map((row) => row.billedMinor)).toEqual([49_000, 49_000]);
    expect(result.billing.every((row) => !row.stable)).toBe(true);
  });

  it('una visita cobrada e spostata in un altro mese non si cobra due volte', () => {
    const moved = visit({ date: '2026-12-09', originalDate: d('2026-11-25'), billedMinor: 49_000 });
    const result = plan({ visits: [moved, visit({ date: '2026-12-02' })] });
    expect(result.lines).toEqual([expect.objectContaining({ kind: 'VISITS', quantity: 1 })]);
    expect(result.billing.find((row) => row.visitId === moved.id)).toBeUndefined();
  });

  it('cobrada e poi "Por reprogramar": credito; quando torna programmata si cobra come debito', () => {
    const pending = visit({
      date: '2026-11-17',
      status: 'TO_RESCHEDULE',
      scheduledDate: null,
      billedMinor: 49_000,
    });
    const december = plan({ visits: [pending] });
    expect(december.lines).toEqual([
      expect.objectContaining({
        kind: 'VISIT_CREDIT',
        visitId: pending.id,
        creditReason: 'TO_RESCHEDULE',
        amountMinor: -49_000,
      }),
      expect.objectContaining({ kind: 'CREDIT_CARRIED_OUT', amountMinor: 49_000 }),
    ]);
    expect(december.totalMinor).toBe(0);
    expect(december.billing).toEqual([{ visitId: pending.id, billedMinor: null, stable: false }]);

    // A gennaio è di nuovo programmata (il 30 novembre, già fatta): debito al prezzo di novembre.
    const rescheduled = {
      ...pending,
      status: 'DONE' as const,
      scheduledDate: d('2026-11-30'),
      billedMinor: null,
    };
    const january = plan({
      period: d('2027-01-01'),
      unitPriceMinor: 52_000,
      pastPrices: new Map([['2026-11', 49_000]]),
      visits: [rescheduled],
      carriedIn: [{ chargeId: 'c-dic', amountMinor: 49_000 }],
    });
    expect(january.lines).toEqual([
      expect.objectContaining({
        kind: 'VISIT_DEBIT',
        amountMinor: 49_000,
        visitDate: d('2026-11-30'),
      }),
      expect.objectContaining({
        kind: 'CREDIT_CARRIED_IN',
        sourceChargeId: 'c-dic',
        amountMinor: -49_000,
      }),
    ]);
    expect(january.totalMinor).toBe(0);
    expect(january.billing).toEqual([{ visitId: pending.id, billedMinor: 49_000, stable: true }]);
  });

  it('crediti per la fioreria, niente per il cliente che non apre o cancella', () => {
    const shopCancel = visit({
      date: '2026-11-10',
      status: 'CANCELLED',
      cancelReason: 'SHOP',
      billedMinor: 49_000,
    });
    const shopNotDone = visit({
      date: '2026-11-11',
      status: 'NOT_DONE',
      notDoneCause: 'SHOP',
      billedMinor: 49_000,
    });
    const customerNotDone = visit({
      date: '2026-11-12',
      status: 'NOT_DONE',
      notDoneCause: 'CUSTOMER',
      billedMinor: 49_000,
    });
    const customerCancel = visit({
      date: '2026-11-13',
      status: 'CANCELLED',
      cancelReason: 'CUSTOMER',
      billedMinor: 49_000,
    });
    const result = plan({
      visits: [
        shopCancel,
        shopNotDone,
        customerNotDone,
        customerCancel,
        visit({ date: '2026-12-02' }),
        visit({ date: '2026-12-16' }),
      ],
    });
    expect(
      result.lines.map((row) => [row.kind, row.visitId, row.creditReason, row.amountMinor]),
    ).toEqual([
      ['VISITS', null, null, 98_000],
      ['VISIT_CREDIT', shopCancel.id, 'SHOP', -49_000],
      ['VISIT_CREDIT', shopNotDone.id, 'NOT_DONE', -49_000],
    ]);
    expect(result.totalMinor).toBe(0);
    // Le quattro visite chiuse sono sistemate per sempre.
    const stable = result.billing.filter((row) => row.stable).map((row) => row.visitId);
    expect(stable).toEqual([shopCancel.id, shopNotDone.id, customerNotDone.id, customerCancel.id]);
  });

  it('una visita nata dopo il cargo del suo mese si cobra il mese dopo, al prezzo di quel mese', () => {
    const late = visit({ date: '2026-11-28', status: 'DONE' });
    const result = plan({
      unitPriceMinor: 52_000,
      pastPrices: new Map([['2026-11', 49_000]]),
      visits: [late, visit({ date: '2026-12-05' })],
    });
    expect(result.lines.map((row) => [row.kind, row.amountMinor])).toEqual([
      ['VISITS', 52_000],
      ['VISIT_DEBIT', 49_000],
    ]);
    // Senza cargo in quel mese vale il prezzo di oggi.
    const noCharge = plan({ unitPriceMinor: 52_000, visits: [late] });
    expect(noCharge.lines).toEqual([
      expect.objectContaining({ kind: 'VISIT_DEBIT', amountMinor: 52_000 }),
    ]);
  });

  it('visite extra fatte e servizi "una sola vez" si cobrano una volta', () => {
    const extra = visit({
      date: '2026-11-20',
      isExtra: true,
      status: 'DONE',
      extraFee: 'VISIT_FEE',
      extraFeeMinor: 35_000,
    });
    const free = visit({
      date: '2026-11-21',
      isExtra: true,
      status: 'DONE',
      extraFee: 'FREE',
      extraFeeMinor: 0,
    });
    const later = visit({
      date: '2026-12-20',
      isExtra: true,
      status: 'SCHEDULED',
      extraFee: 'VISIT_FEE',
      extraFeeMinor: 35_000,
    });
    const result = plan({
      visits: [extra, free, later],
      oneTimeServices: [
        {
          serviceResultId: 'r-1',
          serviceId: 's-1',
          name: 'Trasplante',
          priceMinor: 12_000,
          day: d('2026-11-20'),
        },
        // Lo stesso servizio segnato due volte si cobra una volta.
        {
          serviceResultId: 'r-2',
          serviceId: 's-1',
          name: 'Trasplante',
          priceMinor: 12_000,
          day: d('2026-11-27'),
        },
      ],
    });
    expect(result.lines.map((row) => [row.kind, row.amountMinor, row.label])).toEqual([
      ['EXTRA_VISIT', 35_000, null],
      ['ONE_TIME_SERVICE', 12_000, 'Trasplante'],
    ]);
    expect(result.billing).toEqual([
      { visitId: extra.id, billedMinor: 35_000, stable: true },
      { visitId: free.id, billedMinor: null, stable: true },
    ]);
    // Già cobrata: niente.
    const again = plan({ visits: [{ ...extra, billedMinor: 35_000 }] });
    expect(again.lines).toEqual([]);
  });

  it('nel cargo finale si guarda tutto e il saldo resta a favore del cliente', () => {
    const cancelled = visit({
      date: '2027-01-05',
      status: 'CANCELLED',
      cancelReason: 'CONTRACT_END',
      billedMinor: 49_000,
    });
    const result = plan({
      final: true,
      visits: [cancelled],
      carriedIn: [{ chargeId: 'c-nov', amountMinor: 10_000 }],
    });
    expect(result.lines.map((row) => [row.kind, row.amountMinor])).toEqual([
      ['VISIT_CREDIT', -49_000],
      ['CREDIT_CARRIED_IN', -10_000],
    ]);
    expect(result.totalMinor).toBe(-59_000);
  });

  it('niente da cobrar: nessuna riga (il cargo non nasce), ma le visite chiuse si sistemano', () => {
    const done = visit({ date: '2026-11-10', status: 'DONE', billedMinor: 49_000 });
    const result = plan({ visits: [done] });
    expect(result.lines).toEqual([]);
    expect(result.totalMinor).toBe(0);
    expect(result.billing).toEqual([{ visitId: done.id, billedMinor: 49_000, stable: true }]);
  });

  it('importi troppo grandi si rifiutano', () => {
    const visits = Array.from({ length: 31 }, (_, index) =>
      visit({ date: `2026-12-${String(index + 1).padStart(2, '0')}` }),
    );
    expect(
      planCareChargeLines({
        period: d('2026-12-01'),
        unitPriceMinor: 900_000_000,
        pastPrices: new Map(),
        visits,
        oneTimeServices: [],
        carriedIn: [],
        final: false,
      }),
    ).toEqual({ ok: false, error: 'amount_too_large' });
  });
});

describe('cargos: scadenza e stato', () => {
  it('scade dopo i giorni scelti, contati dal primo del mese o dal giorno in cui nasce', () => {
    expect(careChargeDueDate(d('2026-12-01'), d('2026-12-01'), 10)).toEqual(d('2026-12-11'));
    // Un lavoro in ritardo o un contratto confermato a metà mese.
    expect(careChargeDueDate(d('2026-11-01'), d('2026-11-24'), 10)).toEqual(d('2026-12-04'));
  });

  it('pendiente, parziale, pagato, vencido, sin saldo, a favor e devuelto', () => {
    const status = (totalMinor: number, paidMinor: number, today = '2026-12-05') =>
      careChargeStatus({ totalMinor, paidMinor, dueDate: d('2026-12-11'), today: d(today) });
    expect(status(98_000, 0)).toBe('PENDING');
    expect(status(98_000, 40_000)).toBe('PARTIAL');
    expect(status(98_000, 98_000)).toBe('PAID');
    // Il giorno della scadenza non è ancora vencido; il giorno dopo sì.
    expect(status(98_000, 0, '2026-12-11')).toBe('PENDING');
    expect(status(98_000, 40_000, '2026-12-12')).toBe('OVERDUE');
    expect(status(98_000, 0, '2027-01-02')).toBe('OVERDUE');
    expect(status(98_000, 98_000, '2027-01-02')).toBe('PAID');
    expect(status(0, 0)).toBe('NO_BALANCE');
    expect(status(-59_000, 0)).toBe('IN_FAVOR');
    expect(status(-59_000, -20_000)).toBe('IN_FAVOR');
    expect(status(-59_000, -59_000)).toBe('REFUNDED');
    expect(isCareChargeOpen('OVERDUE')).toBe(true);
    expect(isCareChargeOpen('IN_FAVOR')).toBe(false);
  });
});

describe('cargos: un pagamento distribuito', () => {
  const charges = [
    { id: 'dic', period: d('2026-12-01'), number: 4, balanceMinor: 98_000 },
    { id: 'nov-b', period: d('2026-11-01'), number: 2, balanceMinor: 49_000 },
    { id: 'nov-a', period: d('2026-11-01'), number: 1, balanceMinor: 20_000 },
    { id: 'pagato', period: d('2026-10-01'), number: 0, balanceMinor: 0 },
  ];

  it('va prima ai cargos più vecchi, mai oltre il saldo di ognuno', () => {
    expect(allocateCarePayment(100_000, charges)).toEqual({
      ok: true,
      allocations: [
        { chargeId: 'nov-a', amountMinor: 20_000 },
        { chargeId: 'nov-b', amountMinor: 49_000 },
        { chargeId: 'dic', amountMinor: 31_000 },
      ],
    });
    expect(allocateCarePayment(167_000, charges)).toMatchObject({ ok: true });
  });

  it('più di quanto c’è da pagare si rifiuta', () => {
    expect(allocateCarePayment(167_001, charges)).toEqual({
      ok: false,
      error: 'payment_exceeds_balance',
    });
    expect(allocateCarePayment(100, [])).toEqual({ ok: false, error: 'payment_exceeds_balance' });
  });
});

describe('cargos: i moduli', () => {
  it('il pagamento vuole un importo maggiore di 0 e la forma di pago', () => {
    expect(errors(carePaymentSchema('MXN').safeParse({ amount: '0', method: 'CASH' }))).toEqual({
      amount: 'care_payment_zero',
    });
    expect(errors(carePaymentSchema('MXN').safeParse({ amount: '490' }))).toEqual({
      method: 'required',
    });
    expect(
      errors(
        carePaymentSchema('MXN').safeParse({ amount: '490', method: 'CASH', paidOn: '2026-02-30' }),
      ),
    ).toEqual({
      paidOn: 'invalid_date',
    });
    expect(
      carePaymentSchema('MXN').parse({
        amount: '490.50',
        method: 'TRANSFER',
        paidOn: '',
        reference: ' SPEI 123 ',
      }),
    ).toEqual({
      amount: 49_050,
      method: 'TRANSFER',
      paidOn: null,
      reference: 'SPEI 123',
      note: null,
      submitKey: null,
    });
  });

  it('"No se pudo" propone "El cliente no abrió"', () => {
    expect(careNotDoneSchema.parse({}).cause).toBe('CUSTOMER');
    expect(careNotDoneSchema.parse({ cause: 'SHOP' }).cause).toBe('SHOP');
    expect(errors(careNotDoneSchema.safeParse({ cause: 'WEATHER' }))).toEqual({
      cause: 'invalid_option',
    });
  });

  it('"Días para pagar": vuoto vale 10, da 1 a 90', () => {
    const base = {
      visitFee: '300',
      frequencies: 'MONTHLY_1',
      minNoticeHours: '24',
      missedVisitPolicy: 'COUNTS',
      deadPlantPolicy: 'QUOTE',
    };
    expect(careSettingsSchema('MXN').parse(base).paymentDueDays).toBe(10);
    expect(careSettingsSchema('MXN').parse({ ...base, paymentDueDays: '15' }).paymentDueDays).toBe(
      15,
    );
    expect(errors(careSettingsSchema('MXN').safeParse({ ...base, paymentDueDays: '0' }))).toEqual({
      paymentDueDays: 'out_of_range',
    });
  });

  it('filtri di "Cobros" e numero del cargo', () => {
    expect(careChargeListFiltersSchema.parse({ view: 'overdue', month: '2026-11' })).toMatchObject({
      view: 'overdue',
      month: d('2026-11-01'),
      page: 1,
    });
    expect(careChargeListFiltersSchema.parse({ view: 'x', month: '2026-13' })).toMatchObject({
      view: 'open',
      month: null,
    });
    expect(formatCareChargeNumber(12)).toBe('CAR-0012');
  });
});

describe('cargos: blocco 3b', () => {
  it('gli ajustes entrano una volta nel cargo dopo, con il segno e il motivo', () => {
    const result = plan({
      visits: [visit({ date: '2026-12-08' })],
      adjustments: [
        { id: 'a-1', amountMinor: -10_000, reason: 'Descuento por la visita del 3' },
        { id: 'a-2', amountMinor: 2_500, reason: 'Maceta extra' },
      ],
    });
    expect(result.lines.map((item) => [item.kind, item.amountMinor, item.adjustmentId])).toEqual([
      ['VISITS', 49_000, null],
      ['ADJUSTMENT', -10_000, 'a-1'],
      ['ADJUSTMENT', 2_500, 'a-2'],
    ]);
    expect(result.lines[1]).toMatchObject({
      label: 'Descuento por la visita del 3',
      quantity: 1,
      unitPriceMinor: 10_000,
    });
    expect(result.totalMinor).toBe(41_500);
  });

  it('un ajuste a favore più grande del cargo passa come saldo al cargo dopo', () => {
    const result = plan({
      adjustments: [{ id: 'a-3', amountMinor: -60_000, reason: 'Error en noviembre' }],
    });
    expect(result.lines.map((item) => [item.kind, item.amountMinor])).toEqual([
      ['ADJUSTMENT', -60_000],
      ['CREDIT_CARRIED_OUT', 60_000],
    ]);
    expect(result.totalMinor).toBe(0);
    // Nel cargo finale resta a favore del cliente.
    const last = plan({
      final: true,
      adjustments: [{ id: 'a-4', amountMinor: -60_000, reason: 'Error en noviembre' }],
    });
    expect(last.totalMinor).toBe(-60_000);
  });

  it('"Por recuperar": solo le visite del calendario mancate per il cliente, con «Se agenda otra visita»', () => {
    const missed = { isExtra: false, status: 'NOT_DONE', notDoneCause: 'CUSTOMER' } as const;
    expect(careVisitRecoverable(missed, 'RECOVER')).toBe(true);
    expect(careVisitRecoverable({ ...missed, notDoneCause: null }, 'RECOVER')).toBe(true);
    expect(careVisitRecoverable(missed, 'COUNTS')).toBe(false);
    expect(careVisitRecoverable(missed, null)).toBe(false);
    expect(careVisitRecoverable({ ...missed, notDoneCause: 'SHOP' }, 'RECOVER')).toBe(false);
    expect(careVisitRecoverable({ ...missed, isExtra: true }, 'RECOVER')).toBe(false);
    expect(careVisitRecoverable({ ...missed, status: 'DONE' }, 'RECOVER')).toBe(false);
  });

  it('i moduli di incasso, conferma, rifiuto e ajuste', () => {
    const collection = careVisitCollectionSchema('MXN');
    expect(collection.parse({ amount: '450', method: 'CASH', note: '' })).toEqual({
      amount: 45_000,
      method: 'CASH',
      note: null,
      submitKey: null,
    });
    expect(errors(collection.safeParse({ amount: '0', method: 'CASH' }))).toMatchObject({
      amount: 'care_payment_zero',
    });
    expect(errors(collection.safeParse({ amount: '100', method: '' }))).toMatchObject({
      method: 'required',
    });

    const confirm = careCollectionConfirmSchema('MXN');
    expect(confirm.parse({ amount: '400', reference: '' })).toEqual({
      amount: 40_000,
      reference: null,
    });
    expect(errors(confirm.safeParse({ amount: '' }))).toHaveProperty('amount');

    expect(errors(careCollectionRejectSchema.safeParse({ reason: '  ' }))).toMatchObject({
      reason: 'required',
    });
    expect(careCollectionRejectSchema.parse({ reason: 'No estaba en caja' })).toEqual({
      reason: 'No estaba en caja',
    });

    const adjustment = careAdjustmentSchema('MXN');
    expect(adjustment.parse({ direction: 'CREDIT', amount: '100', reason: 'Descuento' })).toEqual({
      amountMinor: -10_000,
      reason: 'Descuento',
    });
    expect(adjustment.parse({ direction: 'DEBIT', amount: '25.50', reason: 'Maceta' })).toEqual({
      amountMinor: 2_550,
      reason: 'Maceta',
    });
    expect(errors(adjustment.safeParse({ direction: '', amount: '0', reason: '' }))).toMatchObject({
      direction: 'required',
      amount: 'care_payment_zero',
      reason: 'required',
    });
    expect(
      errors(adjustment.safeParse({ direction: 'DEBIT', amount: '1', reason: 'x'.repeat(121) })),
    ).toMatchObject({ reason: 'too_long' });
  });
});
