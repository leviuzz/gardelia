import { describe, expect, it } from 'vitest';
import {
  productStructuredData,
  serializeStructuredData,
  storeStructuredData,
} from '@/lib/structured-data';

/** Dati strutturati per Google (M1-2, ADR-087). */
describe('dati strutturati della vetrina', () => {
  const store = {
    name: 'Florería <Las Camelias>',
    description: null,
    phone: '+524495550100',
    address: {
      line: 'Av. Madero 120',
      neighborhood: 'Centro',
      city: 'Aguascalientes',
      region: 'Aguascalientes',
    },
    openingHours: [
      {
        weekday: 1 as const,
        ranges: [
          { start: 9 * 60, end: 14 * 60 },
          { start: 16 * 60, end: 19 * 60 },
        ],
      },
      { weekday: 0 as const, ranges: [] },
    ],
    currency: 'MXN',
  };

  it('la fioreria: indirizzo, telefono e orari dai dati della pagina', () => {
    const data = storeStructuredData(store, { url: 'https://x.test/f/a', imageUrl: null });
    expect(data).toMatchObject({
      '@type': 'Florist',
      telephone: '+524495550100',
      address: { addressLocality: 'Aguascalientes', streetAddress: 'Av. Madero 120' },
    });
    expect(data.openingHoursSpecification).toEqual([
      expect.objectContaining({
        dayOfWeek: 'https://schema.org/Monday',
        opens: '09:00',
        closes: '14:00',
      }),
      expect.objectContaining({
        dayOfWeek: 'https://schema.org/Monday',
        opens: '16:00',
        closes: '19:00',
      }),
    ]);
    expect('image' in data).toBe(false);
  });

  it('il prodotto: prezzo in decimali e disponibilità', () => {
    const data = productStructuredData(
      { name: 'Ramo', description: 'Rosas', priceMinor: 69000, availability: 'OUT_OF_STOCK' },
      store,
      { url: 'https://x.test/f/a/p/1', imageUrls: ['https://x.test/1.jpg'] },
    );
    expect(data).toMatchObject({
      '@type': 'Product',
      image: ['https://x.test/1.jpg'],
      offers: {
        price: '690.00',
        priceCurrency: 'MXN',
        availability: 'https://schema.org/OutOfStock',
      },
    });
  });

  it('nessun testo della fioreria chiude lo script', () => {
    const json = serializeStructuredData({
      name: '</script><script>alert(1)</script> & co \u2028',
    });
    expect(json).not.toContain('<');
    expect(json).not.toContain('>');
    expect(json).not.toContain('&');
    expect(json).not.toContain('\u2028');
    expect(JSON.parse(json)).toEqual({
      name: '</script><script>alert(1)</script> & co \u2028',
    });
  });
});
