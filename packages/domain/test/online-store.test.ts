import { describe, expect, it } from 'vitest';
import {
  CATALOG_BULK_LIMIT,
  canShowOnline,
  catalogItemInputSchema,
  catalogListFiltersSchema,
  isStoreImageKind,
  onlineStoreFormSchema,
  parseCatalogBulkIds,
  STORE_READINESS_MIN_ITEMS,
  storePublishBlockers,
  storeReadiness,
} from '../src/index';

/** "Mi tienda en línea" (ADR-065). */
describe('prodotti in linea', () => {
  it('solo ramos, piante, fiori e accessori', () => {
    expect(['BOUQUET', 'PLANT', 'CUT_FLOWER', 'ACCESSORY'].every(canShowOnline)).toBe(true);
    expect(
      ['FOLIAGE', 'PACKAGING', 'CONTAINER', 'SERVICE', 'SERVICE_ADDON'].some(canShowOnline),
    ).toBe(false);
  });

  it('il catalogo forza "in linea" a falso per gli altri tipi e lo lascia spento se non chiesto', () => {
    const base = {
      name: 'x',
      description: null,
      sku: null,
      canonicalFlowerId: null,
      variety: null,
      colors: [],
      priceMinor: 100,
      costMinor: null,
      availability: 'AVAILABLE',
      prepMinutes: null,
      heightCm: null,
      widthCm: null,
      tags: [],
    };
    const parse = (input: Record<string, unknown>) =>
      catalogItemInputSchema.parse({ ...base, ...input });
    expect(parse({ type: 'FOLIAGE', saleUnit: 'STEM', isOnline: true }).isOnline).toBe(false);
    expect(parse({ type: 'BOUQUET', saleUnit: 'PIECE', isOnline: true }).isOnline).toBe(true);
    expect(parse({ type: 'BOUQUET', saleUnit: 'PIECE' }).isOnline).toBe(false);
  });
});

describe('impostazioni della tienda', () => {
  it('forme di pagamento conosciute, testi facoltativi', () => {
    expect(
      onlineStoreFormSchema.parse({ paymentMethods: ['TRANSFER', 'CASH'], description: ' ' }),
    ).toEqual({
      paymentMethods: ['TRANSFER', 'CASH'],
      description: null,
      paymentInstructions: null,
    });
    expect(onlineStoreFormSchema.parse({ paymentMethods: 'CASH' }).paymentMethods).toEqual([
      'CASH',
    ]);
    expect(onlineStoreFormSchema.safeParse({ paymentMethods: ['BITCOIN'] }).success).toBe(false);
  });

  it('per pubblicare servono prodotti visibili e il telefono', () => {
    expect(storePublishBlockers({ onlineItems: 0, contactPhone: null })).toEqual([
      'store_needs_items',
      'store_needs_contact',
    ]);
    expect(storePublishBlockers({ onlineItems: 2, contactPhone: '+524495550101' })).toEqual([]);
  });
});

describe('immagini della tienda', () => {
  it('solo logo e copertina', () => {
    expect(isStoreImageKind('LOGO')).toBe(true);
    expect(isStoreImageKind('COVER')).toBe(true);
    expect(isStoreImageKind('logo')).toBe(false);
    expect(isStoreImageKind(undefined)).toBe(false);
  });
});

/** «Completa la tua vetrina» (M1-2, ADR-087). */
describe('vetrina completa', () => {
  const empty = {
    hasLogo: false,
    hasCover: false,
    hasDescription: false,
    onlineItems: 0,
    onlineWithoutPhoto: 0,
    featuredItems: 0,
    hasDeliveryFee: false,
    paymentMethods: 0,
    policies: 0,
  };

  it('vetrina vuota: tutti gli 8 passi da fare, anche le foto senza prodotti', () => {
    const readiness = storeReadiness(empty);
    expect(readiness.steps.map((entry) => entry.step)).toEqual([
      'images',
      'description',
      'products',
      'photos',
      'featured',
      'deliveryFee',
      'payment',
      'policies',
    ]);
    expect(readiness.steps.every((entry) => !entry.done)).toBe(true);
    expect(readiness.missing).toBe(8);
  });

  it('a metà: logo senza copertina non basta, un prodotto senza foto tiene aperto il passo', () => {
    const readiness = storeReadiness({
      ...empty,
      hasLogo: true,
      hasDescription: true,
      onlineItems: STORE_READINESS_MIN_ITEMS - 1,
      onlineWithoutPhoto: 1,
      paymentMethods: 2,
    });
    const done = Object.fromEntries(readiness.steps.map((entry) => [entry.step, entry.done]));
    expect(done).toEqual({
      images: false,
      description: true,
      products: false,
      photos: false,
      featured: false,
      deliveryFee: false,
      payment: true,
      policies: false,
    });
    expect(readiness.missing).toBe(6);
  });

  it('completa con 8 prodotti tutti con foto, una stella, costo, pagamento e una politica', () => {
    const readiness = storeReadiness({
      hasLogo: true,
      hasCover: true,
      hasDescription: true,
      onlineItems: STORE_READINESS_MIN_ITEMS,
      onlineWithoutPhoto: 0,
      featuredItems: 1,
      hasDeliveryFee: true,
      paymentMethods: 1,
      policies: 1,
    });
    expect(readiness.missing).toBe(0);
  });
});

/** Catalogo (M1-2): filtro «Negozio online» e più prodotti insieme. */
describe('catalogo e negozio online', () => {
  it('il filtro accetta sì, no e senza foto; il resto lo ignora', () => {
    expect(catalogListFiltersSchema.parse({ online: 'no_photo' }).online).toBe('no_photo');
    expect(catalogListFiltersSchema.parse({ online: 'yes' }).online).toBe('yes');
    expect(catalogListFiltersSchema.parse({ online: 'tal vez' }).online).toBeNull();
    expect(catalogListFiltersSchema.parse({}).online).toBeNull();
  });

  it('gli ID scelti: almeno uno, senza doppioni, al massimo una pagina, solo ID veri', () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    expect(parseCatalogBulkIds([])).toEqual({ error: 'empty' });
    expect(parseCatalogBulkIds('x')).toEqual({ error: 'empty' });
    expect(parseCatalogBulkIds([id(1), 'nope'])).toEqual({ error: 'invalid' });
    expect(parseCatalogBulkIds([id(1), id(1), id(2)])).toEqual({ ids: [id(1), id(2)] });
    const many = Array.from({ length: CATALOG_BULK_LIMIT + 1 }, (_, n) => id(n));
    expect(parseCatalogBulkIds(many)).toEqual({ error: 'too_many' });
    // I doppioni non contano nel limite.
    expect(parseCatalogBulkIds([...many.slice(0, CATALOG_BULK_LIMIT), id(0)])).toEqual({
      ids: many.slice(0, CATALOG_BULK_LIMIT),
    });
  });
});
