import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb } from '@floral/db';
import {
  CALENDAR_MAX_DAYS,
  ValidationError,
  addCustomerOccasion,
  createCustomer,
  listCalendarOccasions,
  setCustomerArchived,
} from '../src/index';
import { createTestShop, type TestShop } from '../src/testing';

/**
 * Calendario: le date speciali dei clienti attivi che cadono nei giorni mostrati, solo della
 * propria fioreria; il 29 febbraio negli anni non bisestili cade il 28.
 */
function customer(name: string) {
  return {
    type: 'PERSON',
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
  };
}

let shopA: TestShop;
let shopB: TestShop;

beforeAll(async () => {
  shopA = await createTestShop('Florería Calendario A');
  shopB = await createTestShop('Florería Calendario B');
  await createCustomer(shopA.owner, {
    ...customer('Ana Ruiz'),
    occasions: [
      { type: 'BIRTHDAY', month: 12, day: 14, year: 1990 },
      { type: 'ANNIVERSARY', month: 2, day: 29, year: 2020 },
      { type: 'CUSTOM', label: 'Día de las madres', personName: 'Su mamá', month: 5, day: 10 },
    ],
  });
  const archived = await createCustomer(shopA.owner, {
    ...customer('Cliente archivado'),
    occasions: [{ type: 'BIRTHDAY', month: 12, day: 14 }],
  });
  await setCustomerArchived(shopA.owner, archived.id, true);
  const other = await createCustomer(shopB.owner, customer('Cliente de B'));
  await addCustomerOccasion(shopB.owner, other.id, { type: 'BIRTHDAY', month: '12', day: '20' });
});

afterAll(async () => {
  await disconnectDb();
});

describe('calendario delle date speciali', () => {
  it('le date dei clienti attivi nei giorni mostrati, con gli anni compiuti', async () => {
    const december = await listCalendarOccasions(shopA.staff, {
      from: { year: 2026, month: 12, day: 1 },
      to: { year: 2026, month: 12, day: 31 },
    });
    expect(december).toHaveLength(1);
    expect(december[0]).toMatchObject({
      date: '2026-12-14',
      customerName: 'Ana Ruiz',
      customerPhone: '+524495550199',
      type: 'BIRTHDAY',
      years: 36,
    });
  });

  it('a cavallo dell’anno; il 29 febbraio cade il 28 negli anni non bisestili', async () => {
    const winter = await listCalendarOccasions(shopA.owner, {
      from: { year: 2026, month: 12, day: 10 },
      to: { year: 2027, month: 2, day: 28 },
    });
    expect(winter.map((event) => [event.date, event.type, event.years])).toEqual([
      ['2026-12-14', 'BIRTHDAY', 36],
      ['2027-02-28', 'ANNIVERSARY', 7],
    ]);
    const may = await listCalendarOccasions(shopA.owner, {
      from: { year: 2027, month: 5, day: 1 },
      to: { year: 2027, month: 5, day: 31 },
    });
    expect(may[0]).toMatchObject({
      label: 'Día de las madres',
      personName: 'Su mamá',
      years: null,
    });
  });

  it('un intervallo troppo lungo o al contrario è rifiutato', async () => {
    await expect(
      listCalendarOccasions(shopA.owner, {
        from: { year: 2026, month: 1, day: 1 },
        to: { year: 2026, month: 12, day: 31 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      listCalendarOccasions(shopA.owner, {
        from: { year: 2026, month: 12, day: 31 },
        to: { year: 2026, month: 12, day: 1 },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(CALENDAR_MAX_DAYS).toBeGreaterThanOrEqual(60);
  });

  it('A ↔ B: ognuno vede solo le date dei propri clienti', async () => {
    const range = {
      from: { year: 2026, month: 12, day: 1 },
      to: { year: 2026, month: 12, day: 31 },
    };
    const fromA = await listCalendarOccasions(shopA.owner, range);
    const fromB = await listCalendarOccasions(shopB.owner, range);
    expect(fromA.map((event) => event.customerName)).toEqual(['Ana Ruiz']);
    expect(fromB.map((event) => event.customerName)).toEqual(['Cliente de B']);
  });
});
