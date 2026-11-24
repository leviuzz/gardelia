import { describe, expect, it } from 'vitest';
import {
  careContractListFiltersSchema,
  careContractSchema,
  careEndSchema,
  careScheduleChangeSchema,
  careTravelForDistance,
  careVisitCancelSchema,
  careVisitMoveSchema,
  findCareServicePreset,
  careScheduleProblem,
  careServiceSchema,
  careSettingsSchema,
  carePlantSchema,
  careSlotSchema,
  careVisitDates,
  careVisitsPerMonth,
  estimateCareMonth,
  formatSubscriptionNumber,
  nthWeekdayOfMonth,
  pickCareSlot,
  priceCareVisit,
  quoteCareTravel,
  toFieldErrors,
  toIsoDate,
  type CalendarDate,
  type SlotAvailability,
} from '../src/index';

const day = (iso: string): CalendarDate => {
  const [year, month, date] = iso.split('-').map(Number);
  return { year: year!, month: month!, day: date! };
};
const isoList = (dates: readonly CalendarDate[]) => dates.map((date) => toIsoDate(date));

describe('date delle visite (ADR-075)', () => {
  it('trova il 1º e il 3º martes del mese, e nessun 5º se non c’è', () => {
    expect(nthWeekdayOfMonth(2026, 11, 2, 1)).toEqual(day('2026-11-03'));
    expect(nthWeekdayOfMonth(2026, 11, 2, 3)).toEqual(day('2026-11-17'));
    expect(nthWeekdayOfMonth(2026, 11, 2, 5)).toBeNull();
    expect(nthWeekdayOfMonth(2026, 12, 2, 1)).toEqual(day('2026-12-01'));
  });

  it('mensile: le occorrenze dei mesi nell’intervallo, saltando quelle già passate', () => {
    expect(
      isoList(
        careVisitDates({
          frequency: 'MONTHLY_2',
          weekdays: [2],
          from: day('2026-11-24'),
          until: day('2027-01-31'),
        }),
      ),
    ).toEqual(['2026-12-01', '2026-12-15', '2027-01-05', '2027-01-19']);
    expect(
      isoList(
        careVisitDates({
          frequency: 'MONTHLY_1',
          weekdays: [5],
          from: day('2026-11-01'),
          until: day('2026-12-31'),
        }),
      ),
    ).toEqual(['2026-11-06', '2026-12-04']);
  });

  it('settimanale: ogni settimana nei giorni scelti', () => {
    expect(
      isoList(
        careVisitDates({
          frequency: 'WEEKLY',
          weekdays: [2, 4],
          from: day('2026-11-24'),
          until: day('2026-12-06'),
        }),
      ),
    ).toEqual(['2026-11-24', '2026-11-26', '2026-12-01', '2026-12-03']);
    expect(
      careVisitDates({
        frequency: 'WEEKLY',
        weekdays: [2],
        from: day('2026-12-02'),
        until: day('2026-12-01'),
      }),
    ).toEqual([]);
  });

  it('quante visite in un mese: fisse per le mensili, 4 o 5 a settimana per le settimanali', () => {
    expect(careVisitsPerMonth('MONTHLY_1', 1)).toEqual({ min: 1, max: 1 });
    expect(careVisitsPerMonth('MONTHLY_2', 1)).toEqual({ min: 2, max: 2 });
    expect(careVisitsPerMonth('WEEKLY', 2)).toEqual({ min: 8, max: 10 });
  });
});

describe('fasce scelte per un contratto', () => {
  it('mensile: una fascia sola; settimanale: giorni diversi, al massimo tre', () => {
    const tue = { id: 'a', weekday: 2 };
    const thu = { id: 'b', weekday: 4 };
    expect(careScheduleProblem('MONTHLY_2', [tue])).toBeNull();
    expect(careScheduleProblem('MONTHLY_1', [tue, thu])).toBe('care_one_slot');
    expect(careScheduleProblem('WEEKLY', [tue, thu])).toBeNull();
    expect(careScheduleProblem('WEEKLY', [tue, { id: 'c', weekday: 2 }])).toBe(
      'care_repeated_weekday',
    );
    expect(careScheduleProblem('WEEKLY', [])).toBe('required');
  });
});

describe('dove va una visita', () => {
  const slot = (iso: string, slotId: string, free: number, startMinutes = 540) =>
    ({ date: day(iso), slotId, free, startMinutes }) satisfies SlotAvailability;

  it('la fascia preferita se ha posto, altrimenti un’altra lo stesso giorno', () => {
    const candidates = [
      slot('2026-12-01', 'morning', 1, 540),
      slot('2026-12-01', 'afternoon', 2, 900),
    ];
    expect(
      pickCareSlot({ date: day('2026-12-01'), preferredSlotId: 'morning', seats: 1, candidates }),
    ).toMatchObject({ slotId: 'morning' });
    expect(
      pickCareSlot({ date: day('2026-12-01'), preferredSlotId: 'morning', seats: 2, candidates }),
    ).toMatchObject({ slotId: 'afternoon' });
  });

  it('poi il giorno più vicino della stessa settimana, mai nel mese dopo', () => {
    expect(
      pickCareSlot({
        date: day('2026-12-15'),
        preferredSlotId: 'morning',
        seats: 1,
        candidates: [
          slot('2026-12-15', 'morning', 0),
          slot('2026-12-17', 'thursday', 1),
          slot('2026-12-16', 'wednesday', 1),
        ],
      }),
    ).toMatchObject({ slotId: 'wednesday' });
    expect(
      pickCareSlot({
        date: day('2026-11-30'),
        preferredSlotId: 'monday',
        seats: 1,
        candidates: [slot('2026-11-30', 'monday', 0), slot('2026-12-01', 'tuesday', 3)],
      }),
    ).toBeNull();
  });
});

describe('distanza e prezzo', () => {
  const shop = { latitude: 21.8818, longitude: -102.2916 };
  const near = { latitude: 21.8818, longitude: -102.2616 };
  const far = { latitude: 21.8818, longitude: -101.9 };

  it('sovrapprezzo dalla fascia; oltre l’ultima vale l’ultima; oltre il raggio no', () => {
    const tiers = [
      { maxMeters: 2_000, feeMinor: 0 },
      { maxMeters: 3_000, feeMinor: 5_000 },
    ];
    expect(quoteCareTravel({ tiers, maxDistanceKm: 20, from: shop, to: near })).toMatchObject({
      kind: 'in_range',
      surchargeMinor: 5_000,
    });
    expect(quoteCareTravel({ tiers, maxDistanceKm: 20, from: shop, to: far })).toMatchObject({
      kind: 'out_of_range',
      maxKm: 20,
    });
    expect(quoteCareTravel({ tiers: [], maxDistanceKm: null, from: shop, to: far })).toMatchObject({
      kind: 'in_range',
      surchargeMinor: 0,
    });
    expect(quoteCareTravel({ tiers, maxDistanceKm: 20, from: null, to: near })).toEqual({
      kind: 'unknown',
    });
  });

  it('una visita: tariffa + sovrapprezzo + care per misura + extra; a parte gli una tantum', () => {
    const result = priceCareVisit({
      visitFeeMinor: 45_000,
      travelSurchargeMinor: 5_000,
      careFees: { SMALL: 1_000, MEDIUM: 2_000, LARGE: 4_000 },
      plants: [
        { size: 'MEDIUM', quantity: 10 },
        { size: 'LARGE', quantity: 2 },
      ],
      extras: [
        { unit: 'PER_VISIT', priceMinor: 3_000 },
        { unit: 'PER_PLANT', priceMinor: 500 },
        { unit: 'ONE_TIME', priceMinor: 10_000 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      price: {
        plantCount: 12,
        visitFeeMinor: 45_000,
        travelSurchargeMinor: 5_000,
        careMinor: 28_000,
        extrasMinor: 9_000,
        perVisitMinor: 87_000,
        oneTimeMinor: 10_000,
      },
    });
    expect(estimateCareMonth(87_000, 'WEEKLY', 2)).toEqual({
      minMinor: 696_000,
      maxMinor: 870_000,
    });
    expect(
      priceCareVisit({
        visitFeeMinor: 999_999_999,
        travelSurchargeMinor: 0,
        careFees: { SMALL: 0, MEDIUM: 0, LARGE: 999_999_999 },
        plants: [{ size: 'LARGE', quantity: 500 }],
        extras: [],
      }),
    ).toEqual({ ok: false, error: 'amount_too_large' });
  });

  it('una distanza già salvata dà lo stesso sovrapprezzo; senza distanza non si sa', () => {
    const tiers = [
      { maxMeters: 2_000, feeMinor: 0 },
      { maxMeters: 5_000, feeMinor: 5_000 },
    ];
    expect(careTravelForDistance({ tiers, maxDistanceKm: 20, distanceKm: 3 })).toEqual({
      kind: 'in_range',
      surchargeMinor: 5_000,
      distanceKm: 3,
    });
    expect(careTravelForDistance({ tiers, maxDistanceKm: 20, distanceKm: 12 })).toMatchObject({
      kind: 'in_range',
      surchargeMinor: 5_000,
    });
    expect(careTravelForDistance({ tiers, maxDistanceKm: 20, distanceKm: 25 })).toEqual({
      kind: 'out_of_range',
      distanceKm: 25,
      maxKm: 20,
    });
    expect(careTravelForDistance({ tiers, maxDistanceKm: null, distanceKm: null })).toEqual({
      kind: 'unknown',
    });
  });

  it('numera i contratti come SUS-0001', () => {
    expect(formatSubscriptionNumber(7)).toBe('SUS-0007');
  });
});

describe('moduli di Floral Care', () => {
  it('impostazioni: frequenze in ordine, care vuoto = 0, almeno una frequenza', () => {
    const parsed = careSettingsSchema('MXN').parse({
      visitFee: '450',
      careFeeMedium: '20',
      frequencies: ['WEEKLY', 'MONTHLY_2'],
      maxDistanceKm: '',
      minNoticeHours: '24',
      missedVisitPolicy: 'COUNTS',
      deadPlantPolicy: 'QUOTE',
      termsText: '',
    });
    expect(parsed).toMatchObject({
      visitFee: 45_000,
      careFeeSmall: 0,
      careFeeMedium: 2_000,
      frequencies: ['MONTHLY_2', 'WEEKLY'],
      maxDistanceKm: null,
      minNoticeHours: 24,
    });
    const missing = careSettingsSchema('MXN').safeParse({
      visitFee: '450',
      minNoticeHours: '24',
      missedVisitPolicy: 'COUNTS',
      deadPlantPolicy: 'QUOTE',
    });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(toFieldErrors(missing.error).frequencies).toBe('required');
  });

  it('servizio extra con prezzo; incluso senza prezzo', () => {
    const schema = careServiceSchema('MXN');
    const extra = schema.safeParse({ name: 'Trasplante', pricing: 'EXTRA', unit: 'PER_PLANT' });
    expect(extra.success).toBe(false);
    if (!extra.success) expect(toFieldErrors(extra.error).price).toBe('required');
    expect(
      schema.parse({ name: 'Riego', pricing: 'INCLUDED', unit: 'ONE_TIME', price: '50' }),
    ).toMatchObject({ price: 0, unit: 'PER_VISIT' });
  });

  it('fascia in ordine e con capienza; pianta con quantità e misura', () => {
    const slot = careSlotSchema.safeParse({
      weekday: '2',
      start: '12:00',
      end: '09:00',
      capacity: '2',
    });
    expect(slot.success).toBe(false);
    if (!slot.success) expect(toFieldErrors(slot.error).end).toBe('invalid_time_window');
    expect(
      careSlotSchema.parse({ weekday: '2', start: '09:00', end: '12:00', capacity: '2' }),
    ).toEqual({ weekday: 2, start: 540, end: 720, capacity: 2 });
    expect(
      carePlantSchema.parse({
        name: 'Potos en jardinera',
        canonicalFlowerId: '',
        quantity: '12',
        size: 'SMALL',
        light: 'MEDIUM',
      }),
    ).toMatchObject({ quantity: 12, size: 'SMALL', canonicalFlowerId: null, light: 'MEDIUM' });
  });

  it('contratto: sede e almeno una fascia; un posto se non si dice', () => {
    const schema = careContractSchema('MX');
    const empty = schema.safeParse({ frequency: 'MONTHLY_2', startDate: '2026-12-01' });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(toFieldErrors(empty.error)).toMatchObject({
        customerAddressId: 'required',
        slotIds: 'required',
      });
    }
    const parsed = schema.parse({
      customerAddressId: '018f0000-0000-7000-8000-000000000001',
      frequency: 'MONTHLY_2',
      slotIds: '018f0000-0000-7000-8000-000000000002',
      startDate: '2026-12-01',
      contactPhone: '449 555 0101',
    });
    expect(parsed).toMatchObject({ seats: 1, slotIds: ['018f0000-0000-7000-8000-000000000002'] });
    expect(parsed.startDate).toEqual(day('2026-12-01'));
  });
});

describe('moduli dei cambi che toccano visite', () => {
  const uuid = '018f0000-0000-7000-8000-000000000002';

  it('la casella "Sí, avisé al cliente" arriva come booleano, assente = false', () => {
    expect(
      careScheduleChangeSchema.parse({
        frequency: 'WEEKLY',
        slotIds: [uuid],
        startDate: '2026-12-01',
        customerNotified: 'on',
      }),
    ).toMatchObject({ customerNotified: true, seats: 1 });
    expect(careEndSchema.parse({ endDate: '2026-12-31' })).toMatchObject({
      customerNotified: false,
    });
  });

  it('spostare chiede giorno e fascia; cancellare chi la toglie (non i motivi del sistema)', () => {
    const move = careVisitMoveSchema.safeParse({ date: '', slotId: '' });
    expect(move.success).toBe(false);
    if (!move.success) {
      expect(toFieldErrors(move.error)).toMatchObject({ date: 'required', slotId: 'required' });
    }
    expect(careVisitCancelSchema.parse({ reason: 'SHOP', note: ' Vacaciones ' })).toEqual({
      reason: 'SHOP',
      note: 'Vacaciones',
      customerNotified: false,
    });
    expect(careVisitCancelSchema.safeParse({ reason: 'SCHEDULE_CHANGE' }).success).toBe(false);
  });

  it('filtri dell’elenco: valori sconosciuti tornano ai predefiniti; proposte per chiave', () => {
    expect(careContractListFiltersSchema.parse({ view: 'x', page: '-3' })).toEqual({
      view: 'active',
      q: '',
      page: 1,
    });
    expect(findCareServicePreset('fertilizing')).toMatchObject({ pricing: 'EXTRA' });
    expect(findCareServicePreset('nope')).toBeNull();
  });
});
