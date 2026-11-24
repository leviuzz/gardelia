import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext } from '@floral/db';
import {
  ForbiddenError,
  ValidationError,
  createCatalogItem,
  getOpeningHours,
  getPublicStore,
  setOnlineStorePublished,
  updateOpeningHours,
  updateTenantProfile,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Orari di apertura (V1 §2.2): chi gestisce li cambia, tutti li vedono, si sostituiscono insieme;
 * ogni fioreria ha i suoi (isolamento A↔B).
 */

const db = getDb();
let shop: TestShop;
let other: TestShop;

const hm = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return h! * 60 + m!;
};

beforeAll(async () => {
  shop = await createTestShop('Florería Horarios');
  other = await createTestShop('Florería Horarios Vecina');
});

afterAll(async () => {
  await disconnectDb();
});

describe('orari di apertura', () => {
  it("all'inizio non sono indicati; lo staff li vede ma non li cambia", async () => {
    const hours = await getOpeningHours(shop.staff);
    expect(hours.configured).toBe(false);
    expect(hours.canWrite).toBe(false);
    expect(hours.days.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await expect(
      updateOpeningHours(shop.staff, { d1: { start: '09:00', end: '14:00' } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getOpeningHours(shop.manager)).canWrite).toBe(true);
  });

  it('il manager salva più fasce per giorno; un nuovo salvataggio sostituisce tutto', async () => {
    await updateOpeningHours(shop.manager, {
      d1: { start: ['16:00', '09:00', '20:00'], end: ['19:00', '14:00', '22:00'] },
      d6: { start: '10:00', end: '14:00' },
    });
    let hours = await getOpeningHours(shop.owner);
    expect(hours.configured).toBe(true);
    expect(hours.days[1]?.ranges).toEqual([
      { start: hm('09:00'), end: hm('14:00') },
      { start: hm('16:00'), end: hm('19:00') },
      { start: hm('20:00'), end: hm('22:00') },
    ]);
    expect(hours.days[6]?.ranges).toHaveLength(1);
    expect(hours.days[0]?.ranges).toEqual([]);

    await updateOpeningHours(shop.owner, { d2: { start: '08:00', end: '18:00' } });
    hours = await getOpeningHours(shop.owner);
    expect(hours.days[1]?.ranges).toEqual([]);
    expect(hours.days[2]?.ranges).toEqual([{ start: hm('08:00'), end: hm('18:00') }]);

    const audit = await withTenantContext(db, shop.owner, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: shop.owner.tenantId, action: 'location.updated' },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audit.at(-1)?.metadata).toEqual({
      changes: {
        openingHours: {
          from: '1: 09:00–14:00, 16:00–19:00, 20:00–22:00 · 6: 10:00–14:00',
          to: '2: 08:00–18:00',
        },
      },
    });

    // Senza fasce l'orario torna "non indicato".
    await updateOpeningHours(shop.owner, {});
    expect((await getOpeningHours(shop.owner)).configured).toBe(false);
  });

  it('un form sbagliato non cambia nulla', async () => {
    await updateOpeningHours(shop.owner, { d3: { start: '09:00', end: '13:00' } });
    await expect(
      updateOpeningHours(shop.owner, {
        d3: { start: ['09:00', '12:00'], end: ['13:00', '15:00'] },
      }),
    ).rejects.toMatchObject({ fieldErrors: { 'd3.1': 'opening_hours_overlap' } });
    expect(ValidationError).toBeDefined();
    expect((await getOpeningHours(shop.owner)).days[3]?.ranges).toEqual([
      { start: hm('09:00'), end: hm('13:00') },
    ]);
  });

  it('ogni fioreria ha i suoi orari (A↔B)', async () => {
    await updateOpeningHours(other.owner, { d0: { start: '10:00', end: '12:00' } });
    const mine = await getOpeningHours(shop.owner);
    const theirs = await getOpeningHours(other.owner);
    expect(mine.days[0]?.ranges).toEqual([]);
    expect(theirs.days[0]?.ranges).toEqual([{ start: hm('10:00'), end: hm('12:00') }]);
    expect(theirs.days[3]?.ranges).toEqual([]);
    // Nel contesto di A le righe di B non esistono nemmeno.
    const visible = await withTenantContext(db, shop.owner, (tx) =>
      tx.openingHoursRange.count({ where: { tenantId: other.owner.tenantId } }),
    );
    expect(visible).toBe(0);
  });
});

describe('orari nella tienda en línea', () => {
  it('chi compra li vede quando ci sono; senza fasce la tienda non mostra nessun orario', async () => {
    const local = await createTestShop('Florería Horario Público');
    await createCatalogItem(
      local.owner,
      itemInput({ name: 'Ramo público', isOnline: true, priceMinor: 50000 }),
    );
    // Si pubblica solo con un modo di contattare la fioreria.
    await updateTenantProfile(local.owner, {
      displayName: 'Florería Horario Público',
      contactEmail: '',
      contactPhone: '449 555 0120',
      timezone: 'America/Mexico_City',
    });
    await setOnlineStorePublished(local.owner, true);
    expect((await getPublicStore(local.tenant.slug))?.openingHours).toBeNull();

    await updateOpeningHours(local.owner, {
      d1: { start: ['09:00', '16:00'], end: ['14:00', '20:00'] },
      d6: { start: '10:00', end: '14:00' },
    });
    const store = await getPublicStore(local.tenant.slug);
    expect(store?.openingHours?.[1]?.ranges).toEqual([
      { start: hm('09:00'), end: hm('14:00') },
      { start: hm('16:00'), end: hm('20:00') },
    ]);
    expect(store?.openingHours?.[0]?.ranges).toEqual([]);
  });
});
