import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb } from '@floral/db';
import {
  MemoryStorage,
  addCatalogItemToQuote,
  changeQuoteStatus,
  createCatalogItem,
  createCustomer,
  createQuote,
  getLetterhead,
  getPublicQuote,
  getPublicShopLogo,
  removeStoreImage,
  revokePublicLink,
  setObjectStorage,
  setStoreImage,
  sharePublicLink,
  updateOpeningHours,
  updatePrimaryLocation,
  updateTenantProfile,
} from '../src/index';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * Intestazione delle stampe e logo nei link pubblici (V1 §2.2): stesso logo della tienda en
 * línea, indirizzo e orario della tienda principale; isolamento A↔B; logo del link solo finché il
 * link è attivo.
 */

const SECRET = 'test-secret-for-letterhead-0123456789';
const storage = new MemoryStorage();
let shop: TestShop;
let other: TestShop;

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 600, height: 600, channels: 3, background: '#1e7850' } })
      .jpeg()
      .toBuffer(),
  );
}

async function sentQuote(target: TestShop): Promise<string> {
  const customer = await createCustomer(target.owner, {
    type: 'PERSON',
    displayName: 'Cliente Membrete',
    legalName: null,
    taxId: null,
    email: null,
    phone: null,
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });
  const item = await createCatalogItem(target.owner, itemInput({ name: 'Rosa membrete' }));
  const { id } = await createQuote(target.owner, { customerId: customer.id });
  await addCatalogItemToQuote(target.owner, id, { catalogItemId: item.id, quantity: '3' });
  await changeQuoteStatus(target.owner, id, 'SENT');
  return id;
}

beforeAll(async () => {
  setObjectStorage(storage);
  shop = await createTestShop('Florería Membrete');
  other = await createTestShop('Florería Membrete Vecina');
});

afterAll(async () => {
  setObjectStorage(null);
  await disconnectDb();
});

describe('intestazione delle stampe', () => {
  it('nome, contatti, indirizzo con lo stato per esteso, logo e orario; anche lo staff la legge', async () => {
    await updateTenantProfile(shop.owner, {
      displayName: 'Florería Membrete',
      contactEmail: 'hola@membrete.test',
      contactPhone: '449 555 0110',
      timezone: 'America/Mexico_City',
    });
    await updatePrimaryLocation(shop.owner, {
      addressLine1: 'Av. Madero 120',
      addressLine2: 'Local 3',
      neighborhood: 'Centro',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '20000',
      phone: '',
      deliveryRadiusKm: '',
    });
    let letterhead = await getLetterhead(shop.staff);
    expect(letterhead).toMatchObject({
      name: 'Florería Membrete',
      phone: '+524495550110',
      email: 'hola@membrete.test',
      logoId: null,
      openingHours: null,
      address: {
        line: 'Av. Madero 120 Local 3',
        neighborhood: 'Centro',
        postalCode: '20000',
        city: 'Aguascalientes',
        region: 'Aguascalientes',
      },
    });

    const logo = await setStoreImage(shop.owner, 'LOGO', await jpeg());
    await updateOpeningHours(shop.manager, { d1: { start: '09:00', end: '19:00' } });
    letterhead = await getLetterhead(shop.staff);
    expect(letterhead.logoId).toBe(logo.id);
    expect(letterhead.openingHours?.[1]?.ranges).toEqual([{ start: 540, end: 1140 }]);

    // L'altra fioreria ha la sua intestazione, senza logo né orario di questa.
    const theirs = await getLetterhead(other.owner);
    expect(theirs.name).not.toBe('Florería Membrete');
    expect(theirs.logoId).toBeNull();
    expect(theirs.openingHours).toBeNull();
  });
});

describe('logo nei link pubblici', () => {
  it('il cliente lo vede finché il link è attivo; senza logo o con il link spento, niente', async () => {
    const quoteId = await sentQuote(shop);
    const link = await sharePublicLink(shop.owner, SECRET, { kind: 'QUOTE', id: quoteId });
    const { logoId } = await getLetterhead(shop.owner);
    expect((await getPublicQuote(SECRET, link.token))?.shop.logoId).toBe(logoId);
    expect((await getPublicShopLogo(SECRET, link.token, 'QUOTE'))?.bytes.length).toBeGreaterThan(0);
    // Il token di un preventivo non vale come link di un ordine.
    expect(await getPublicShopLogo(SECRET, link.token, 'ORDER')).toBeNull();
    expect(await getPublicShopLogo(SECRET, 'token-inventato', 'QUOTE')).toBeNull();

    await removeStoreImage(shop.owner, 'LOGO');
    expect((await getPublicQuote(SECRET, link.token))?.shop.logoId).toBeNull();
    expect(await getPublicShopLogo(SECRET, link.token, 'QUOTE')).toBeNull();

    await setStoreImage(shop.owner, 'LOGO', await jpeg());
    await revokePublicLink(shop.owner, { kind: 'QUOTE', id: quoteId });
    expect(await getPublicShopLogo(SECRET, link.token, 'QUOTE')).toBeNull();
  });

  it("il link di un'altra fioreria porta il suo logo, non questo (A↔B)", async () => {
    const quoteId = await sentQuote(other);
    const link = await sharePublicLink(other.owner, SECRET, { kind: 'QUOTE', id: quoteId });
    expect((await getPublicQuote(SECRET, link.token))?.shop.logoId).toBeNull();
    expect(await getPublicShopLogo(SECRET, link.token, 'QUOTE')).toBeNull();
  });
});
