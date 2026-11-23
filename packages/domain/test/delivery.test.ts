import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS_FROM_MONDAY,
  deliverySettingsSchema,
  deliveryWindowSchema,
  isClosedOn,
  toFieldErrors,
  weekdayOf,
} from '../src/index';

describe('giorni della settimana', () => {
  it('riconosce il giorno di una data di calendario', () => {
    expect(weekdayOf('2026-11-23')).toBe(1); // lunedì
    expect(weekdayOf('2026-11-29')).toBe(0); // domenica
    expect(weekdayOf('23/11/2026')).toBeNull();
    expect(WEEKDAYS_FROM_MONDAY[0]).toBe(1);
    expect(WEEKDAYS_FROM_MONDAY.at(-1)).toBe(0);
  });

  it('dice se la fioreria è chiusa quel giorno', () => {
    expect(isClosedOn('2026-11-29', [0])).toBe(true);
    expect(isClosedOn('2026-11-23', [0])).toBe(false);
    expect(isClosedOn('', [0, 1, 2, 3, 4, 5, 6])).toBe(false);
  });
});

describe('fasce orarie', () => {
  it('legge una fascia in minuti', () => {
    expect(deliveryWindowSchema.parse({ start: '09:00', end: '12:30' })).toEqual({
      start: 540,
      end: 750,
    });
  });

  it('vuole entrambi gli orari, in ordine', () => {
    const empty = deliveryWindowSchema.safeParse({ start: '', end: '12:00' });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(toFieldErrors(empty.error)).toMatchObject({ start: 'required' });
    const reversed = deliveryWindowSchema.safeParse({ start: '15:00', end: '12:00' });
    expect(reversed.success).toBe(false);
    if (!reversed.success) {
      expect(toFieldErrors(reversed.error)).toMatchObject({ end: 'invalid_time_window' });
    }
    expect(deliveryWindowSchema.safeParse({ start: '25:00', end: '26:00' }).success).toBe(false);
  });
});

describe('impostazioni', () => {
  it('giorni chiusi dai checkbox, ordinati e senza doppioni; costo vuoto = 0', () => {
    expect(
      deliverySettingsSchema('MXN').parse({ closedWeekdays: ['0', '6', '0'], defaultFee: '' }),
    ).toEqual({ closedWeekdays: [0, 6], defaultFee: 0 });
    expect(deliverySettingsSchema('MXN').parse({ closedWeekdays: '1', defaultFee: '80' })).toEqual({
      closedWeekdays: [1],
      defaultFee: 8000,
    });
    expect(deliverySettingsSchema('MXN').parse({ defaultFee: '0' })).toEqual({
      closedWeekdays: [],
      defaultFee: 0,
    });
  });

  it('rifiuta giorni inesistenti e costi negativi', () => {
    expect(deliverySettingsSchema('MXN').safeParse({ closedWeekdays: ['7'] }).success).toBe(false);
    expect(deliverySettingsSchema('MXN').safeParse({ defaultFee: '-5' }).success).toBe(false);
  });
});
