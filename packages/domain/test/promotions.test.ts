import { describe, expect, it } from 'vitest';
import {
  duePromoOccurrences,
  formatDiscount,
  occasionPromoFormSchema,
  promoSendDate,
  toFieldErrors,
  toIsoDate,
} from '../src';

const schema = occasionPromoFormSchema('MXN');

function errorsOf(input: Record<string, unknown>) {
  const parsed = schema.safeParse(input);
  return parsed.success ? null : toFieldErrors(parsed.error);
}

describe('modulo della promo delle date speciali', () => {
  it('percentuale o importo fisso, validando solo il campo del tipo scelto', () => {
    expect(schema.parse({ enabled: 'on', kind: 'PERCENT', percent: '15', amount: 'x' })).toEqual({
      enabled: true,
      kind: 'PERCENT',
      value: 15,
    });
    expect(schema.parse({ kind: 'AMOUNT', percent: '200', amount: '150.50' })).toEqual({
      enabled: false,
      kind: 'AMOUNT',
      value: 15_050,
    });
  });

  it('attivarla richiede uno sconto; spenta può restare senza', () => {
    expect(errorsOf({ enabled: 'on', kind: 'PERCENT', percent: '' })).toEqual({
      percent: 'required',
    });
    expect(errorsOf({ enabled: 'on', kind: 'AMOUNT', amount: '' })).toEqual({
      amount: 'required',
    });
    expect(schema.parse({ kind: 'PERCENT', percent: '' })).toEqual({
      enabled: false,
      kind: 'PERCENT',
      value: null,
    });
  });

  it('rifiuta percentuali fuori 1–90, importi a zero e tipi sconosciuti', () => {
    expect(errorsOf({ enabled: 'on', kind: 'PERCENT', percent: '95' })).toEqual({
      percent: 'out_of_range',
    });
    expect(errorsOf({ kind: 'PERCENT', percent: '0' })).toEqual({ percent: 'out_of_range' });
    expect(errorsOf({ kind: 'PERCENT', percent: 'diez' })).toEqual({ percent: 'invalid_number' });
    expect(errorsOf({ enabled: 'on', kind: 'AMOUNT', amount: '0' })).toEqual({
      amount: 'out_of_range',
    });
    expect(errorsOf({ kind: 'AMOUNT', amount: '12,345.6.7' })).toEqual({
      amount: 'invalid_money',
    });
    expect(errorsOf({ kind: 'GRATIS', percent: '10' })).toEqual({ kind: 'invalid_option' });
  });
});

describe('sconto scritto per il cliente', () => {
  it('percentuale nella sua lingua, importo nella valuta della fioreria', () => {
    expect(formatDiscount({ kind: 'PERCENT', value: 15 }, 'MXN', 'es-MX')).toBe('15%');
    expect(formatDiscount({ kind: 'AMOUNT', value: 10_000 }, 'MXN', 'es-MX')).toBe('$100.00');
  });
});

describe('giorni di invio della promo', () => {
  const today = { year: 2026, month: 12, day: 7 };
  const occasion = (id: string, month: number, day: number, remindDaysBefore = 7) => ({
    id,
    month,
    day,
    remindDaysBefore,
  });

  it('parte quando la data cade entro il suo preavviso, oggi compreso', () => {
    const due = duePromoOccurrences(
      [
        occasion('a', 12, 14), // fra 7 giorni: sì
        occasion('b', 12, 15), // fra 8 giorni: non ancora
        occasion('c', 12, 7, 0), // oggi, senza preavviso: sì
        occasion('d', 12, 6), // ieri: la prossima è fra un anno
        occasion('e', 12, 31, 30), // preavviso lungo: sì
      ],
      today,
    );
    expect(due.map((entry) => [entry.occasion.id, toIsoDate(entry.date), entry.daysUntil])).toEqual(
      [
        ['a', '2026-12-14', 7],
        ['c', '2026-12-07', 0],
        ['e', '2026-12-31', 24],
      ],
    );
  });

  it("guarda oltre la fine dell'anno e porta il 29 febbraio al 28", () => {
    const due = duePromoOccurrences(
      [occasion('capodanno', 1, 2), occasion('bisestile', 2, 29, 30)],
      { year: 2026, month: 12, day: 30 },
    );
    expect(due.map((entry) => toIsoDate(entry.date))).toEqual(['2027-01-02']);
    const leap = duePromoOccurrences([occasion('bisestile', 2, 29, 30)], {
      year: 2027,
      month: 2,
      day: 1,
    });
    expect(leap.map((entry) => toIsoDate(entry.date))).toEqual(['2027-02-28']);
  });

  it('il giorno di invio è la data meno il preavviso', () => {
    expect(toIsoDate(promoSendDate({ year: 2027, month: 1, day: 3 }, 7))).toBe('2026-12-27');
  });
});
