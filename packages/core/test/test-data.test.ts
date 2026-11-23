import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { addDays, todayInTimeZone } from '@floral/domain';
import {
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  listCalendarOccasions,
  setBackgroundRemover,
  setObjectStorage,
} from '../src/index';
import {
  TEST_CATALOG,
  TEST_CUSTOMERS,
  TEST_SELF_CUSTOMER,
  TEST_SKU_PREFIX,
  fillTestShop,
  placeholderTestPhoto,
  testPhotoPrompt,
  type TestCatalogItem,
} from '../src/platform';
import { createTestShop, type TestShop } from '../src/testing';

/**
 * Dati di prova di una fioreria (CLI di piattaforma, ADR-049): passa dai servizi veri, solo per
 * un amministratore che è anche proprietario o manager di quella fioreria, e rilanciata non
 * duplica nulla.
 */

const db = getDb();
const storage = new MemoryStorage();
const WITH_PHOTO = TEST_CATALOG.filter((item) => item.photo !== null).length;
const DATES = TEST_CUSTOMERS.reduce((sum, customer) => sum + customer.occasions.length, 0) + 1;
let shop: TestShop;
let other: TestShop;

async function makePlatformAdmin(userId: string) {
  await withSystemContext(db, { reason: 'test: amministratore di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: userId }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
}

async function countsOf(target: TestShop) {
  const ctx = target.owner;
  return withTenantContext(db, ctx, async (tx) => ({
    customers: await tx.customer.count({ where: { tenantId: ctx.tenantId } }),
    occasions: await tx.customerOccasion.count({ where: { tenantId: ctx.tenantId } }),
    items: await tx.catalogItem.count({ where: { tenantId: ctx.tenantId } }),
    photos: await tx.catalogItemPhoto.count({ where: { tenantId: ctx.tenantId } }),
  }));
}

beforeAll(async () => {
  setObjectStorage(storage);
  // Niente scontorni qui: li prova photos.test.ts.
  setBackgroundRemover(null);
  shop = await createTestShop('Florería Datos de Prueba');
  other = await createTestShop('Florería Ajena');
  await makePlatformAdmin(shop.tenant.owner.id);
});

afterAll(async () => {
  setObjectStorage(null);
  setBackgroundRemover(undefined);
  await disconnectDb();
});

describe('dati di prova di una fioreria', () => {
  it('aggiunge clienti con date, prodotti e foto; rilanciata non duplica nulla', async () => {
    const photo = vi.fn(placeholderTestPhoto);
    const input = { operatorEmail: shop.tenant.owner.email, tenantSlug: shop.tenant.slug, photo };

    const first = await fillTestShop(input);
    expect(first.tenantId).toBe(shop.owner.tenantId);
    expect(first.customers).toEqual({ created: TEST_CUSTOMERS.length + 1, existing: 0 });
    expect(first.dates).toBe(DATES);
    expect(first.items).toEqual({ created: TEST_CATALOG.length, existing: 0 });
    expect(first.photos).toEqual({ added: WITH_PHOTO, existing: 0, failed: 0 });
    expect(await countsOf(shop)).toEqual({
      customers: TEST_CUSTOMERS.length + 1,
      occasions: DATES,
      items: TEST_CATALOG.length,
      // Foto e miniatura sono una riga sola.
      photos: WITH_PHOTO,
    });

    const again = await fillTestShop(input);
    expect(again.customers).toEqual({ created: 0, existing: TEST_CUSTOMERS.length + 1 });
    expect(again.dates).toBe(0);
    expect(again.items).toEqual({ created: 0, existing: TEST_CATALOG.length });
    expect(again.photos).toEqual({ added: 0, existing: WITH_PHOTO, failed: 0 });
    // Nessuna foto generata (e pagata) due volte.
    expect(photo).toHaveBeenCalledTimes(WITH_PHOTO);
    expect((await countsOf(shop)).customers).toBe(TEST_CUSTOMERS.length + 1);
  });

  it('il calendario dei prossimi giorni si riempie; la promo può arrivare solo all’operatore', async () => {
    const ctx = shop.owner;
    const today = todayInTimeZone(ctx.timezone);
    const events = await listCalendarOccasions(ctx, { from: today, to: addDays(today, 30) });
    expect(events.length).toBeGreaterThanOrEqual(10);
    expect(events.map((event) => event.customerName)).toContain(TEST_SELF_CUSTOMER);

    // Email inventate senza consenso: la promo automatica non scrive a indirizzi falsi.
    const consenting = await withTenantContext(db, ctx, (tx) =>
      tx.customer.findMany({
        where: { tenantId: ctx.tenantId, marketingConsent: true },
        select: { displayName: true, email: true },
      }),
    );
    expect(consenting).toEqual([
      { displayName: TEST_SELF_CUSTOMER, email: shop.tenant.owner.email },
    ]);
    const others = await withTenantContext(db, ctx, (tx) =>
      tx.customer.findMany({
        where: { tenantId: ctx.tenantId, displayName: { not: TEST_SELF_CUSTOMER } },
        select: { email: true, tags: true },
      }),
    );
    expect(others.every((customer) => customer.email?.endsWith('@example.com'))).toBe(true);
    expect(others.every((customer) => customer.tags.includes('prueba'))).toBe(true);
  });

  it('i prodotti hanno codice PRB-, specie per fiori e verde e prezzi in pesos', async () => {
    const ctx = shop.owner;
    const items = await withTenantContext(db, ctx, (tx) =>
      tx.catalogItem.findMany({
        where: { tenantId: ctx.tenantId },
        select: { sku: true, type: true, currency: true, canonicalFlowerId: true },
      }),
    );
    expect(items.every((item) => item.sku?.startsWith(TEST_SKU_PREFIX))).toBe(true);
    expect(items.every((item) => item.currency === 'MXN')).toBe(true);
    const plants = items.filter((item) => item.type === 'CUT_FLOWER' || item.type === 'FOLIAGE');
    expect(plants.length).toBe(WITH_PHOTO);
    expect(plants.every((item) => item.canonicalFlowerId !== null)).toBe(true);
  });

  it('una foto che non riesce non ferma le altre', async () => {
    const third = await createTestShop('Florería Fotos Fallidas');
    await makePlatformAdmin(third.tenant.owner.id);
    const failing = (item: TestCatalogItem) =>
      item.sku === `${TEST_SKU_PREFIX}GIRASOL`
        ? Promise.reject(new Error('generatore non disponibile'))
        : placeholderTestPhoto(item);
    const result = await fillTestShop({
      operatorEmail: third.tenant.owner.email,
      tenantSlug: third.tenant.slug,
      photo: failing,
    });
    expect(result.photos).toEqual({ added: WITH_PHOTO - 1, existing: 0, failed: 1 });
    expect(result.items.created).toBe(TEST_CATALOG.length);
  });

  it('chi non è amministratore della piattaforma non può usarla', async () => {
    await expect(
      fillTestShop({ operatorEmail: shop.managerUser.email, tenantSlug: shop.tenant.slug }),
    ).rejects.toMatchObject({ reason: 'platform_admin_required' });
  });

  it('solo una fioreria di cui l’operatore è proprietario o manager', async () => {
    // L'amministratore non entra nella fioreria di un altro: 404, e lì non cambia nulla.
    await expect(
      fillTestShop({ operatorEmail: shop.tenant.owner.email, tenantSlug: other.tenant.slug }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await countsOf(other)).toEqual({ customers: 0, occasions: 0, items: 0, photos: 0 });

    // Lo staff (anche se amministratore della piattaforma) non scrive catalogo e clienti.
    await makePlatformAdmin(shop.staffUser.id);
    await expect(
      fillTestShop({ operatorEmail: shop.staffUser.email, tenantSlug: shop.tenant.slug }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('la foto si chiede su fondo liso, senza testo (grigio chiaro per i fiori bianchi)', () => {
    const rose = TEST_CATALOG.find((item) => item.sku === `${TEST_SKU_PREFIX}ROSA-ROJA`)!;
    const white = TEST_CATALOG.find((item) => item.sku === `${TEST_SKU_PREFIX}ROSA-BLANCA`)!;
    expect(testPhotoPrompt(rose)).toContain('plain pure white seamless background');
    expect(testPhotoPrompt(white)).toContain('plain light grey seamless background');
    for (const item of [rose, white]) {
      expect(testPhotoPrompt(item)).toContain('no text, no watermark');
      expect(testPhotoPrompt(item)).toContain(item.photo!);
    }
  });
});
