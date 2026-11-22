import { describe, expect, it } from 'vitest';
import {
  addMonths,
  calendarRange,
  monthsInRange,
  parseCalendarQuery,
  parseIsoDate,
  shiftDate,
  toIsoDate,
  weekStartsOn,
  yearlyOccurrences,
  type CalendarDate,
} from '../src/calendar';

const d = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });
const iso = (dates: readonly CalendarDate[]) => dates.map(toIsoDate);

describe('calendario: date', () => {
  it('legge e scrive "AAAA-MM-GG", rifiuta date impossibili', () => {
    expect(parseIsoDate('2026-11-22')).toEqual(d(2026, 11, 22));
    expect(parseIsoDate('2028-02-29')).toEqual(d(2028, 2, 29));
    expect(parseIsoDate('2026-02-29')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('22/11/2026')).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
    expect(toIsoDate(d(2026, 1, 5))).toBe('2026-01-05');
  });

  it('un mese dopo il 31 gennaio è l’ultimo di febbraio', () => {
    expect(addMonths(d(2026, 1, 31), 1)).toEqual(d(2026, 2, 28));
    expect(addMonths(d(2028, 1, 31), 1)).toEqual(d(2028, 2, 29));
    expect(addMonths(d(2026, 12, 15), 1)).toEqual(d(2027, 1, 15));
    expect(addMonths(d(2026, 1, 15), -1)).toEqual(d(2025, 12, 15));
  });

  it('vista e data dalla query, con il mese di oggi come ripiego', () => {
    const today = d(2026, 11, 22);
    expect(parseCalendarQuery({}, today)).toEqual({ view: 'month', date: today });
    expect(parseCalendarQuery({ view: 'week', date: '2026-12-01' }, today)).toEqual({
      view: 'week',
      date: d(2026, 12, 1),
    });
    expect(parseCalendarQuery({ view: 'year', date: 'ieri' }, today)).toEqual({
      view: 'month',
      date: today,
    });
  });
});

describe('calendario: viste', () => {
  it('la settimana parte la domenica in Messico e il lunedì in Italia', () => {
    expect(weekStartsOn('es-MX')).toBe(0);
    expect(weekStartsOn('en-US')).toBe(0);
    expect(weekStartsOn('it-IT')).toBe(1);
    // Domenica 22 novembre 2026.
    expect(iso(calendarRange('week', d(2026, 11, 22), 0).days)).toEqual([
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
    ]);
    expect(toIsoDate(calendarRange('week', d(2026, 11, 22), 1).from)).toBe('2026-11-16');
  });

  it('il mese è fatto di settimane intere, anche a cavallo dell’anno', () => {
    const november = calendarRange('month', d(2026, 11, 22), 0);
    expect(toIsoDate(november.from)).toBe('2026-11-01'); // domenica
    expect(toIsoDate(november.to)).toBe('2026-12-05'); // sabato
    expect(november.days.length % 7).toBe(0);
    const december = calendarRange('month', d(2026, 12, 3), 1);
    expect(toIsoDate(december.from)).toBe('2026-11-30'); // lunedì
    expect(toIsoDate(december.to)).toBe('2027-01-03'); // domenica
  });

  it('giorno e agenda; avanti e indietro per ogni vista', () => {
    expect(calendarRange('day', d(2026, 11, 22), 0).days).toHaveLength(1);
    const agenda = calendarRange('agenda', d(2026, 11, 22), 0);
    expect(agenda.days).toHaveLength(60);
    expect(toIsoDate(agenda.to)).toBe('2027-01-20');
    expect(shiftDate('month', d(2026, 1, 31), 1)).toEqual(d(2026, 2, 28));
    expect(shiftDate('week', d(2026, 11, 22), -1)).toEqual(d(2026, 11, 15));
    expect(shiftDate('day', d(2026, 12, 31), 1)).toEqual(d(2027, 1, 1));
    expect(shiftDate('agenda', d(2026, 11, 22), 1)).toEqual(d(2027, 1, 21));
  });
});

describe('date che si ripetono ogni anno', () => {
  it('cadono nell’intervallo, anche a cavallo dell’anno', () => {
    expect(iso(yearlyOccurrences(1, 5, d(2026, 12, 1), d(2027, 1, 31)))).toEqual(['2027-01-05']);
    expect(iso(yearlyOccurrences(12, 14, d(2026, 12, 1), d(2027, 1, 31)))).toEqual(['2026-12-14']);
    expect(yearlyOccurrences(6, 1, d(2026, 12, 1), d(2027, 1, 31))).toEqual([]);
  });

  it('il 29 febbraio cade il 28 negli anni non bisestili', () => {
    expect(iso(yearlyOccurrences(2, 29, d(2027, 2, 1), d(2027, 2, 28)))).toEqual(['2027-02-28']);
    expect(iso(yearlyOccurrences(2, 29, d(2028, 2, 1), d(2028, 2, 29)))).toEqual(['2028-02-29']);
  });

  it('mesi toccati da un intervallo (per leggere solo le date utili)', () => {
    expect(monthsInRange(d(2026, 11, 1), d(2026, 12, 5))).toEqual([11, 12]);
    expect(monthsInRange(d(2026, 11, 30), d(2027, 1, 3))).toEqual([1, 11, 12]);
    expect(monthsInRange(d(2026, 11, 22), d(2026, 11, 22))).toEqual([11]);
  });
});
