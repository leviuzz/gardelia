import { describe, expect, it } from 'vitest';
import { deliveryFeeTierSchema, quoteDeliveryFee, roundedDistanceKm } from '../src/index';

/** Costo di consegna per distanza (ADR-069). */
const store = { latitude: 21.8818, longitude: -102.2916 }; // centro di Aguascalientes
// ~1 km verso nord per ogni 0.009 gradi di latitudine.
const at = (km: number) => ({
  latitude: store.latitude + km * 0.008993,
  longitude: store.longitude,
});
const tiers = [
  { maxMeters: 6000, feeMinor: 12000 },
  { maxMeters: 3000, feeMinor: 8000 },
];

describe('fasce di distanza', () => {
  it('km con un decimale, punto o virgola; limiti 0.1–100 km', () => {
    const schema = deliveryFeeTierSchema('MXN');
    expect(schema.parse({ upToKm: '3,5', fee: '80' })).toEqual({ upToKm: 3500, fee: 8000 });
    expect(schema.parse({ upToKm: '10', fee: '0' })).toEqual({ upToKm: 10000, fee: 0 });
    for (const upToKm of ['', '0', '0.05', '101', '3.55', 'tres']) {
      expect(schema.safeParse({ upToKm, fee: '80' }).success).toBe(false);
    }
    expect(schema.safeParse({ upToKm: '3', fee: '' }).success).toBe(false);
  });

  it('la prima fascia che arriva fin lì, in ordine di distanza', () => {
    expect(quoteDeliveryFee({ tiers, defaultFeeMinor: 5000, from: store, to: at(2) })).toEqual({
      kind: 'distance',
      feeMinor: 8000,
      distanceKm: 2,
    });
    expect(
      quoteDeliveryFee({ tiers, defaultFeeMinor: 5000, from: store, to: at(3) }),
    ).toMatchObject({ kind: 'distance', feeMinor: 8000 });
    expect(quoteDeliveryFee({ tiers, defaultFeeMinor: 5000, from: store, to: at(4.2) })).toEqual({
      kind: 'distance',
      feeMinor: 12000,
      distanceKm: 4.2,
    });
    expect(quoteDeliveryFee({ tiers, defaultFeeMinor: 5000, from: store, to: at(7) })).toEqual({
      kind: 'out_of_zone',
      distanceKm: 7,
      maxKm: 6,
    });
  });

  it('senza fasce o senza posizioni: il costo abituale', () => {
    expect(quoteDeliveryFee({ tiers: [], defaultFeeMinor: 5000, from: store, to: at(2) })).toEqual({
      kind: 'default',
      feeMinor: 5000,
    });
    expect(quoteDeliveryFee({ tiers, defaultFeeMinor: 5000, from: null, to: at(2) })).toEqual({
      kind: 'default',
      feeMinor: 5000,
    });
    expect(quoteDeliveryFee({ tiers, defaultFeeMinor: 0, from: store, to: null })).toEqual({
      kind: 'default',
      feeMinor: 0,
    });
    expect(roundedDistanceKm(store, store)).toBe(0);
  });
});
