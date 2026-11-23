import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addDeliveryWindow,
  getDeliverySettings,
  removeDeliveryWindow,
  updateDeliverySettings,
} from '../src/index';
import { createTestShop, type TestShop } from '../src/testing';

/** Impostazioni di consegna (ADR-055): fasce, giorni di chiusura e costo predefinito. */

const db = getDb();
let shop: TestShop;
let other: TestShop;

beforeAll(async () => {
  shop = await createTestShop('Florería Entregas');
  other = await createTestShop('Florería Entregas Ajena');
});

afterAll(async () => {
  await disconnectDb();
});

describe('impostazioni di consegna', () => {
  it('senza nulla: nessuna fascia, sempre aperta, nessun costo', async () => {
    expect(await getDeliverySettings(shop.staff)).toEqual({
      windows: [],
      closedWeekdays: [],
      defaultFeeMinor: 0,
      // Costo per distanza (ADR-069): nessuna fascia, e senza la sede scelta con Google nessuna posizione.
      feeTiers: [],
      origin: null,
      canWrite: false,
    });
  });

  it('giorni chiusi e costo predefinito, con audit solo se cambiano', async () => {
    await updateDeliverySettings(shop.manager, { closedWeekdays: ['0', '1'], defaultFee: '80' });
    await updateDeliverySettings(shop.manager, { closedWeekdays: ['1', '0'], defaultFee: '80.00' });
    const settings = await getDeliverySettings(shop.owner);
    expect(settings).toMatchObject({
      closedWeekdays: [0, 1],
      defaultFeeMinor: 8000,
      canWrite: true,
    });

    const audit = await withSystemContext(db, { reason: 'test: audit' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: shop.tenant.tenantId, action: 'delivery_settings.updated' },
      }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({
      changes: {
        closedWeekdays: { from: [], to: [0, 1] },
        defaultDeliveryFeeMinor: { from: 0, to: 8000 },
      },
    });

    await expect(
      updateDeliverySettings(shop.owner, { closedWeekdays: ['9'], defaultFee: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('fasce in ordine, senza doppioni e con un massimo', async () => {
    const afternoon = await addDeliveryWindow(shop.owner, { start: '15:00', end: '18:00' });
    await addDeliveryWindow(shop.owner, { start: '09:00', end: '12:00' });
    await expect(
      addDeliveryWindow(shop.owner, { start: '09:00', end: '12:00' }),
    ).rejects.toMatchObject({ reason: 'delivery_window_exists' });
    await expect(
      addDeliveryWindow(shop.owner, { start: '12:00', end: '11:00' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await getDeliverySettings(shop.staff)).windows.map((w) => [w.start, w.end])).toEqual([
      ['09:00', '12:00'],
      ['15:00', '18:00'],
    ]);

    for (const hour of [10, 11, 12, 13, 14, 16]) {
      await addDeliveryWindow(shop.owner, { start: `${hour}:00`, end: `${hour}:30` });
    }
    await expect(
      addDeliveryWindow(shop.owner, { start: '19:00', end: '20:00' }),
    ).rejects.toMatchObject({ reason: 'delivery_window_limit' });

    await removeDeliveryWindow(shop.owner, afternoon.id);
    expect((await getDeliverySettings(shop.owner)).windows).toHaveLength(7);
    await expect(removeDeliveryWindow(shop.owner, afternoon.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('lo staff le legge ma non le cambia', async () => {
    await expect(
      updateDeliverySettings(shop.staff, { closedWeekdays: [], defaultFee: '' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addDeliveryWindow(shop.staff, { start: '08:00', end: '09:00' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [window] = (await getDeliverySettings(shop.staff)).windows;
    await expect(removeDeliveryWindow(shop.staff, window!.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('il database rifiuta fasce al contrario e giorni inesistenti', async () => {
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.deliveryWindow.create({
          data: { tenantId: shop.tenant.tenantId, startMinutes: 600, endMinutes: 540 },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.tenant.update({
          where: { id: shop.tenant.tenantId },
          data: { deliveryClosedWeekdays: [7] },
        }),
      ),
    ).rejects.toThrow();
  });

  it('un’altra fioreria non vede né toglie le fasce altrui', async () => {
    const [window] = (await getDeliverySettings(shop.owner)).windows;
    expect((await getDeliverySettings(other.owner)).windows).toEqual([]);
    await expect(removeDeliveryWindow(other.owner, window!.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const visible = await withTenantContext(db, other.owner, (tx) =>
      tx.deliveryWindow.findMany({ where: { id: window!.id } }),
    );
    expect(visible).toEqual([]);
    const events = await withSystemContext(db, { reason: 'test: security' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: null,
          entityId: window!.id,
          action: 'security.cross_tenant_access_attempt',
        },
      }),
    );
    expect(events.length).toBeGreaterThan(0);
    expect((await getDeliverySettings(shop.owner)).windows.map((w) => w.id)).toContain(window!.id);
  });
});
