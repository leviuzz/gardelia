import { describe, expect, it } from 'vitest';
import {
  OPENING_HOURS_LIMITS,
  closedButDelivering,
  formatOpeningRanges,
  groupOpeningDays,
  hasOpeningHours,
  openingHoursSchema,
  type OpeningDay,
} from '../src/index';
import { toFieldErrors } from '../src/validation';

/** Orari di apertura: fasce senza limite pratico per giorno, giorno senza fasce = chiuso. */

const hm = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return h! * 60 + m!;
};

function errorsOf(input: unknown) {
  const result = openingHoursSchema.safeParse(input);
  return result.success ? null : toFieldErrors(result.error);
}

describe('form degli orari', () => {
  it('più fasce per giorno, in ordine; i giorni senza fasce sono chiusi', () => {
    const days = openingHoursSchema.parse({
      d1: { start: ['16:00', '09:00', '20:30'], end: ['19:00', '14:00', '22:00'] },
      d6: { start: '10:00', end: '14:00' },
    });
    expect(days).toHaveLength(7);
    expect(days.find((day) => day.weekday === 1)?.ranges).toEqual([
      { start: hm('09:00'), end: hm('14:00') },
      { start: hm('16:00'), end: hm('19:00') },
      { start: hm('20:30'), end: hm('22:00') },
    ]);
    expect(days.find((day) => day.weekday === 6)?.ranges).toEqual([
      { start: hm('10:00'), end: hm('14:00') },
    ]);
    expect(days.find((day) => day.weekday === 0)?.ranges).toEqual([]);
    expect(hasOpeningHours(days)).toBe(true);
    expect(hasOpeningHours(openingHoursSchema.parse({}))).toBe(false);
  });

  it("dice quale fascia è sbagliata: vuota, al contrario, sovrapposta o attaccata all'altra", () => {
    expect(errorsOf({ d1: { start: ['09:00', ''], end: ['14:00', '20:00'] } })).toEqual({
      'd1.1': 'required',
    });
    expect(errorsOf({ d2: { start: ['14:00'], end: ['09:00'] } })).toEqual({
      'd2.0': 'invalid_time_window',
    });
    expect(errorsOf({ d3: { start: ['9am'], end: ['14:00'] } })).toEqual({
      'd3.0': 'invalid_time_window',
    });
    expect(errorsOf({ d4: { start: ['13:00', '09:00'], end: ['18:00', '14:00'] } })).toEqual({
      'd4.0': 'opening_hours_overlap',
    });
    expect(errorsOf({ d5: { start: ['09:00', '14:00'], end: ['14:00', '18:00'] } })).toEqual({
      'd5.1': 'opening_hours_overlap',
    });
  });

  it('form manomesso: liste di lunghezza diversa o troppe fasce', () => {
    expect(errorsOf({ d1: { start: ['09:00', '16:00'], end: ['14:00'] } })).toEqual({
      d1: 'invalid_option',
    });
    const many = Array.from({ length: OPENING_HOURS_LIMITS.rangesPerDay + 1 }, (_, i) => i);
    expect(
      errorsOf({
        d1: {
          start: many.map((i) => `${String(i + 8).padStart(2, '0')}:00`),
          end: many.map((i) => `${String(i + 8).padStart(2, '0')}:30`),
        },
      }),
    ).toEqual({ d1: 'too_many_items' });
  });
});

describe("l'orario in poche righe", () => {
  const morning = { start: hm('09:00'), end: hm('14:00') };
  const afternoon = { start: hm('16:00'), end: hm('20:00') };
  const week: OpeningDay[] = [
    { weekday: 1, ranges: [morning, afternoon] },
    { weekday: 2, ranges: [morning, afternoon] },
    { weekday: 3, ranges: [morning, afternoon] },
    { weekday: 4, ranges: [morning, afternoon] },
    { weekday: 5, ranges: [morning, afternoon] },
    { weekday: 6, ranges: [morning] },
  ];

  it('unisce i giorni consecutivi con le stesse fasce, da lunedì; quelli mancanti sono chiusi', () => {
    expect(groupOpeningDays(week)).toEqual([
      { first: 1, last: 5, ranges: [morning, afternoon] },
      { first: 6, last: 6, ranges: [morning] },
      { first: 0, last: 0, ranges: [] },
    ]);
    expect(formatOpeningRanges([morning, afternoon])).toBe('09:00–14:00, 16:00–20:00');
  });

  it('segnala i giorni con la tienda chiusa ma con consegne e ritiri', () => {
    expect(closedButDelivering(week, [])).toEqual([0]);
    expect(closedButDelivering(week, [0])).toEqual([]);
    // Senza orario indicato non si segnala nulla.
    expect(closedButDelivering([], [])).toEqual([]);
  });
});
