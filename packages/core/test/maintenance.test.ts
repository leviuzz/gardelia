/**
 * Scadenze (fase 0): le letture non modificano più i dati. Lo stato "scaduto" si calcola in
 * lettura (anche nei filtri e nei cambi di stato); il lavoro giornaliero lo salva per tutte le
 * fiorerie, ciascuna nel proprio calendario.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withTenantContext, withUserContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { todayInTimeZone } from '@floral/domain';
import {
  ConflictError,
  MemoryMailer,
  addCatalogItemToQuote,
  changeQuoteStatus,
  createCatalogItem,
  createCustomer,
  createQuote,
  getQuote,
  getTeam,
  inviteMember,
  listQuotes,
  runDailyMaintenance,
  type CatalogItemDto,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
const deps = { mailer: new MemoryMailer(), appUrl: 'http://localhost:3000/' };

interface Shop {
  readonly shop: TestShop;
  readonly item: CatalogItemDto;
  readonly customerId: string;
}

async function prepareShop(): Promise<Shop> {
  const shop = await createTestShop();
  const item = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa', priceMinor: 3500 }));
  const { id: customerId } = await createCustomer(shop.owner, {
    type: 'PERSON',
    displayName: 'Cliente de prueba',
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550142',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });
  return { shop, item, customerId };
}

/** Giorno di calendario nel fuso della fioreria, spostato di `days` (colonna DATE). */
function localDay(shop: TestShop, days: number): Date {
  const today = todayInTimeZone(shop.owner.timezone);
  return new Date(Date.UTC(today.year, today.month - 1, today.day + days));
}

async function sentQuote({ shop, item, customerId }: Shop, validUntil: Date): Promise<string> {
  const { id } = await createQuote(shop.owner, { customerId });
  await addCatalogItemToQuote(shop.owner, id, { catalogItemId: item.id, quantity: '1' });
  await changeQuoteStatus(shop.owner, id, 'SENT');
  await withTenantContext(db, shop.owner, (tx) =>
    tx.quote.update({ where: { id }, data: { validUntil } }),
  );
  return id;
}

async function storedQuoteStatus(shop: TestShop, id: string) {
  return withTenantContext(db, shop.owner, async (tx) => {
    const quote = await tx.quote.findFirstOrThrow({ where: { id, tenantId: shop.owner.tenantId } });
    return quote.status;
  });
}

let a: Shop;
let b: Shop;

beforeAll(async () => {
  a = await prepareShop();
  b = await prepareShop();
});

afterAll(async () => {
  await disconnectDb();
});

describe('scadenze dei preventivi', () => {
  it('le letture non scrivono: un inviato scaduto si vede scaduto ma resta salvato come inviato', async () => {
    const id = await sentQuote(a, localDay(a.shop, -1));
    expect((await getQuote(a.shop.owner, id)).status).toBe('EXPIRED');
    const expired = await listQuotes(a.shop.owner, { status: 'EXPIRED' });
    const sent = await listQuotes(a.shop.owner, { status: 'SENT' });
    expect(expired.items.map((quote) => quote.id)).toContain(id);
    expect(sent.items.map((quote) => quote.id)).not.toContain(id);
    // Nessuna lettura l'ha modificato...
    expect(await storedQuoteStatus(a.shop, id)).toBe('SENT');
    // ...ma per i cambi di stato conta lo stato effettivo.
    await expect(changeQuoteStatus(a.shop.owner, id, 'ACCEPTED')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('il lavoro giornaliero chiude gli scaduti di tutte le fiorerie, nel loro calendario', async () => {
    const overdueA = await sentQuote(a, localDay(a.shop, -1));
    const lastDayA = await sentQuote(a, localDay(a.shop, 0));
    const overdueB = await sentQuote(b, localDay(b.shop, -3));

    const result = await runDailyMaintenance();
    expect(result.quotesExpired).toBeGreaterThanOrEqual(2);
    expect(await storedQuoteStatus(a.shop, overdueA)).toBe('EXPIRED');
    expect(await storedQuoteStatus(b.shop, overdueB)).toBe('EXPIRED');
    // L'ultimo giorno di validità il preventivo è ancora valido.
    expect(await storedQuoteStatus(a.shop, lastDayA)).toBe('SENT');
    expect((await getQuote(a.shop.owner, lastDayA)).status).toBe('SENT');

    // Idempotente: una seconda esecuzione non cambia nulla di ciò che è già a posto.
    await runDailyMaintenance();
    expect(await storedQuoteStatus(a.shop, overdueA)).toBe('EXPIRED');
    expect(await storedQuoteStatus(a.shop, lastDayA)).toBe('SENT');
  });
});

describe('scadenze degli inviti', () => {
  it('gli inviti scaduti non compaiono nel team e il lavoro li chiude; quelli validi restano', async () => {
    const expiredUser = await createTestUser(db);
    const validUser = await createTestUser(db);
    const expired = await inviteMember(
      a.shop.owner,
      { email: expiredUser.email, role: 'STAFF' },
      deps,
    );
    const valid = await inviteMember(a.shop.owner, { email: validUser.email, role: 'STAFF' }, deps);
    await withTenantContext(db, a.shop.owner, (tx) =>
      tx.invitation.update({
        where: { id: expired.invitationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );

    const listed = (await getTeam(a.shop.owner)).invitations.map((invitation) => invitation.id);
    expect(listed).toContain(valid.invitationId);
    expect(listed).not.toContain(expired.invitationId);

    const status = (id: string) =>
      withTenantContext(db, a.shop.owner, async (tx) => {
        const row = await tx.invitation.findFirstOrThrow({
          where: { id, tenantId: a.shop.owner.tenantId },
        });
        return row.status;
      });
    // La lettura del team non ha scritto nulla.
    expect(await status(expired.invitationId)).toBe('PENDING');

    const result = await runDailyMaintenance();
    expect(result.invitationsExpired).toBeGreaterThanOrEqual(1);
    expect(await status(expired.invitationId)).toBe('EXPIRED');
    expect(await status(valid.invitationId)).toBe('PENDING');
  });
});

describe('coordinate di Google Places (ADR-059)', () => {
  it('dopo 30 giorni si cancellano; il place ID resta; le recenti restano', async () => {
    const { shop, customerId } = await prepareShop();
    const day = 24 * 60 * 60 * 1000;
    const ids = await withTenantContext(db, shop.owner, async (tx) => {
      const base = {
        tenantId: shop.owner.tenantId,
        customerId,
        addressLine1: 'Av. Madero 120',
        city: 'Aguascalientes',
        region: 'AGU',
        postalCode: '20000',
        countryCode: 'MX',
        placeId: 'ChIJ_test_place_id',
        latitude: 21.88,
        longitude: -102.29,
      };
      const old = await tx.customerAddress.create({
        data: { ...base, label: 'Vieja', coordinatesAt: new Date(Date.now() - 31 * day) },
      });
      const recent = await tx.customerAddress.create({
        data: { ...base, label: 'Reciente', coordinatesAt: new Date(Date.now() - 2 * day) },
      });
      return { old: old.id, recent: recent.id };
    });

    const result = await runDailyMaintenance();
    expect(result.coordinatesPurged).toBeGreaterThanOrEqual(1);
    const rows = await withTenantContext(db, shop.owner, (tx) =>
      tx.customerAddress.findMany({
        where: { id: { in: [ids.old, ids.recent] } },
        select: { id: true, placeId: true, latitude: true, coordinatesAt: true },
      }),
    );
    const old = rows.find((row) => row.id === ids.old)!;
    const recent = rows.find((row) => row.id === ids.recent)!;
    expect(old).toMatchObject({
      placeId: 'ChIJ_test_place_id',
      latitude: null,
      coordinatesAt: null,
    });
    expect(recent.latitude).toBe(21.88);
  });

  it('vale anche per gli indirizzi di chi compra (conto cliente)', async () => {
    const buyer = await createTestUser(db);
    const day = 24 * 60 * 60 * 1000;
    const id = await withUserContext(db, buyer.id, async (tx) => {
      await tx.buyerProfile.create({ data: { userId: buyer.id } });
      const address = await tx.buyerAddress.create({
        data: {
          userId: buyer.id,
          addressLine1: 'Av. Madero 120',
          city: 'Aguascalientes',
          region: 'AGU',
          postalCode: '20000',
          countryCode: 'MX',
          placeId: 'ChIJ_buyer_place',
          latitude: 21.88,
          longitude: -102.29,
          coordinatesAt: new Date(Date.now() - 31 * day),
        },
      });
      return address.id;
    });
    await runDailyMaintenance();
    const row = await withUserContext(db, buyer.id, (tx) =>
      tx.buyerAddress.findUniqueOrThrow({
        where: { id },
        select: { placeId: true, latitude: true, longitude: true, coordinatesAt: true },
      }),
    );
    expect(row).toEqual({
      placeId: 'ChIJ_buyer_place',
      latitude: null,
      longitude: null,
      coordinatesAt: null,
    });
  });

  it('il database rifiuta coordinate senza data o fuori dal globo', async () => {
    const { shop, customerId } = await prepareShop();
    const base = {
      tenantId: shop.owner.tenantId,
      customerId,
      addressLine1: 'Av. Madero 120',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      countryCode: 'MX',
    };
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.customerAddress.create({ data: { ...base, latitude: 21.88, longitude: -102.29 } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantContext(db, shop.owner, (tx) =>
        tx.customerAddress.create({
          data: { ...base, latitude: 120, longitude: -102.29, coordinatesAt: new Date() },
        }),
      ),
    ).rejects.toThrow();
  });
});
