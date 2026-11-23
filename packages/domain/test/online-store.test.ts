import { describe, expect, it } from 'vitest';
import {
  canShowOnline,
  catalogItemInputSchema,
  onlineStoreFormSchema,
  storePublishBlockers,
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
