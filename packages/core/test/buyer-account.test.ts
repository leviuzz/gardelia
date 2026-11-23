import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext, withUserContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  NotFoundError,
  ValidationError,
  addBuyerAddress,
  archiveBuyerAddress,
  hasBuyerAccount,
  openBuyerAccount,
  updateBuyerAddress,
  updateBuyerProfile,
  type BuyerContext,
} from '../src/index';
import { createTestShop } from '../src/testing';

/** Conto del cliente del marketplace (blocco C1): dati per persona, isolati con la RLS per utente. */

const db = getDb();
let ana: BuyerContext;
let beto: BuyerContext;

function address(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Casa',
    recipientName: '',
    recipientPhone: '',
    addressLine1: 'Av. Madero 120',
    addressLine2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryNotes: 'Portón verde',
    ...overrides,
  };
}

beforeAll(async () => {
  ana = { userId: (await createTestUser(db)).id, country: 'MX' };
  beto = { userId: (await createTestUser(db)).id, country: 'MX' };
});

afterAll(async () => {
  await disconnectDb();
});

describe('apertura del conto', () => {
  it('non esiste finché la persona non apre "Mi cuenta"; aprirlo è idempotente', async () => {
    expect(await hasBuyerAccount(ana)).toBe(false);
    const first = await openBuyerAccount(ana);
    expect(first).toMatchObject({ phone: null, addresses: [] });
    expect(first.email).toContain('@');
    expect(await hasBuyerAccount(ana)).toBe(true);
    await openBuyerAccount(ana);
    expect(await hasBuyerAccount(ana)).toBe(true);
    // Il conto di Ana non apre quello di Beto.
    expect(await hasBuyerAccount(beto)).toBe(false);
    expect(await hasBuyerAccount({ userId: 'non-un-uuid' })).toBe(false);
  });

  it('il telefono si normalizza; uno non valido si rifiuta con il codice del campo', async () => {
    await updateBuyerProfile(ana, { phone: '449 555 0142' });
    expect((await openBuyerAccount(ana)).phone).toBe('+524495550142');
    await expect(updateBuyerProfile(ana, { phone: '123' })).rejects.toMatchObject({
      fieldErrors: { phone: 'invalid_phone' },
    });
    await updateBuyerProfile(ana, { phone: '' });
    expect((await openBuyerAccount(ana)).phone).toBeNull();
  });
});

describe('indirizzi', () => {
  it('il primo è predefinito; un nuovo predefinito sostituisce il precedente', async () => {
    const home = await addBuyerAddress(ana, address());
    const office = await addBuyerAddress(ana, address({ label: 'Oficina', isDefault: 'on' }));
    const account = await openBuyerAccount(ana);
    expect(account.addresses.map((item) => [item.id, item.isDefault])).toEqual([
      [office.id, true],
      [home.id, false],
    ]);
    expect(account.addresses[1]).toMatchObject({ label: 'Casa', deliveryNotes: 'Portón verde' });
  });

  it('salva place ID e coordinate di Google; correggendo la via a mano si tolgono', async () => {
    const { id } = await addBuyerAddress(
      ana,
      address({ placeId: 'ChIJ_madero_120', latitude: '21.88', longitude: '-102.29' }),
    );
    const stored = () =>
      withUserContext(db, ana.userId, (tx) =>
        tx.buyerAddress.findUniqueOrThrow({
          where: { id },
          select: { placeId: true, latitude: true, coordinatesAt: true },
        }),
      );
    expect(await stored()).toMatchObject({ placeId: 'ChIJ_madero_120', latitude: 21.88 });
    await updateBuyerAddress(ana, id, address({ addressLine1: 'Juárez 5' }));
    expect(await stored()).toEqual({ placeId: null, latitude: null, coordinatesAt: null });
  });

  it('archiviando il predefinito diventa predefinito il più vecchio rimasto', async () => {
    const before = await openBuyerAccount(ana);
    const current = before.addresses.find((item) => item.isDefault)!;
    await archiveBuyerAddress(ana, current.id);
    const after = await openBuyerAccount(ana);
    expect(after.addresses.map((item) => item.id)).not.toContain(current.id);
    expect(after.addresses.filter((item) => item.isDefault)).toHaveLength(1);
  });

  it('dati non validi: errori per campo, niente salvato', async () => {
    const count = (await openBuyerAccount(ana)).addresses.length;
    await expect(
      addBuyerAddress(ana, address({ addressLine1: '', postalCode: '123' })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await openBuyerAccount(ana)).addresses).toHaveLength(count);
  });

  it('salvataggi contemporanei della stessa persona non creano due predefiniti', async () => {
    const carla: BuyerContext = { userId: (await createTestUser(db)).id, country: 'MX' };
    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        addBuyerAddress(carla, address({ label: `Casa ${index}`, isDefault: 'on' })),
      ),
    );
    const { addresses } = await openBuyerAccount(carla);
    expect(addresses).toHaveLength(4);
    expect(addresses.filter((item) => item.isDefault)).toHaveLength(1);
  });
});

describe('isolamento fra persone (A↔B)', () => {
  it('Beto non vede, non modifica e non archivia gli indirizzi di Ana', async () => {
    const { id } = await addBuyerAddress(ana, address({ label: 'Mamá' }));
    await openBuyerAccount(beto);
    expect((await openBuyerAccount(beto)).addresses).toEqual([]);
    await expect(updateBuyerAddress(beto, id, address({ label: 'Mía' }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(archiveBuyerAddress(beto, id)).rejects.toBeInstanceOf(NotFoundError);
    const mine = (await openBuyerAccount(ana)).addresses.find((item) => item.id === id);
    expect(mine?.label).toBe('Mamá');
  });

  it('il database rifiuta righe per un altro utente e le nasconde senza contesto', async () => {
    await expect(
      withUserContext(db, beto.userId, (tx) =>
        tx.buyerAddress.create({
          data: {
            userId: ana.userId,
            addressLine1: 'Intruso 1',
            city: 'Aguascalientes',
            region: 'AGU',
            postalCode: '20000',
            countryCode: 'MX',
          },
        }),
      ),
    ).rejects.toThrow();
    // Una fioreria (contesto di tenant) non vede i dati di chi compra.
    const shop = await createTestShop('Florería Ajena al Cliente');
    const visible = await withTenantContext(db, shop.owner, (tx) =>
      Promise.all([tx.buyerAddress.count(), tx.buyerProfile.count()]),
    );
    expect(visible).toEqual([0, 0]);
  });
});
