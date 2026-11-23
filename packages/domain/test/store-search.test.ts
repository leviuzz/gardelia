import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELIVERY_RADIUS_KM,
  directoryCities,
  normalizeCity,
  rankStoresForAddress,
} from '../src/index';

/** Ricerca delle fiorerie per chi compra (ADR-066). */
const now = new Date('2026-11-23T12:00:00Z');
const fresh = new Date('2026-11-20T12:00:00Z');
const old = new Date('2026-10-01T12:00:00Z');
const CENTRO = { latitude: 21.8818, longitude: -102.2916 };

function store(
  name: string,
  overrides: Partial<{
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    coordinatesAt: Date | null;
    deliveryRadiusKm: number | null;
  }> = {},
) {
  return {
    name,
    city: 'Aguascalientes',
    latitude: null,
    longitude: null,
    coordinatesAt: null,
    deliveryRadiusKm: null,
    ...overrides,
  };
}

describe('ricerca per indirizzo', () => {
  it('entra chi consegna fin lì, dalla più vicina; fuori raggio no', () => {
    const near = store('Cerca', { latitude: 21.885, longitude: -102.29, coordinatesAt: fresh });
    const mid = store('Medio', {
      latitude: 21.92,
      longitude: -102.3,
      coordinatesAt: fresh,
      deliveryRadiusKm: 8,
    });
    const tooFar = store('Lejos', {
      latitude: 21.95,
      longitude: -102.32,
      coordinatesAt: fresh,
      deliveryRadiusKm: 3,
    });
    const { nearby, sameCity } = rankStoresForAddress(
      [tooFar, mid, near],
      { near: CENTRO, city: null },
      now,
    );
    expect(nearby.map((item) => item.name)).toEqual(['Cerca', 'Medio']);
    expect(nearby[0]!.distanceKm).toBeLessThan(1);
    expect(sameCity).toEqual([]);
  });

  it('senza raggio vale quello predefinito', () => {
    // ~12 km a nord: oltre i 10 km predefiniti.
    const north = store('Norte', { latitude: 21.99, longitude: -102.2916, coordinatesAt: fresh });
    expect(DEFAULT_DELIVERY_RADIUS_KM).toBe(10);
    expect(rankStoresForAddress([north], { near: CENTRO, city: null }, now).nearby).toEqual([]);
  });

  it('posizione sconosciuta o scaduta: conta la stessa città, accenti e maiuscole a parte', () => {
    const unknown = store('Sin ubicación', { city: 'Aguascalientes' });
    const expired = store('Vencida', {
      city: 'AGUASCALIENTES ',
      latitude: 21.885,
      longitude: -102.29,
      coordinatesAt: old,
    });
    const other = store('Otra ciudad', { city: 'León' });
    const result = rankStoresForAddress(
      [unknown, expired, other],
      { near: CENTRO, city: 'aguascálientes' },
      now,
    );
    expect(result.nearby).toEqual([]);
    expect(result.sameCity.map((item) => item.name)).toEqual(['Sin ubicación', 'Vencida']);
  });

  it("solo per città (senza ricerca dell'indirizzo)", () => {
    const located = store('Con ubicación', {
      latitude: 21.885,
      longitude: -102.29,
      coordinatesAt: fresh,
    });
    const result = rankStoresForAddress([located], { near: null, city: 'Aguascalientes' }, now);
    expect(result.sameCity.map((item) => item.name)).toEqual(['Con ubicación']);
  });
});

describe('città', () => {
  it('normalizza e elenca senza doppioni', () => {
    expect(normalizeCity('  San Luis  Potosí ')).toBe('san luis potosi');
    expect(
      directoryCities([
        { city: 'León' },
        { city: 'Aguascalientes' },
        { city: 'aguascalientes' },
        { city: null },
      ]),
    ).toEqual(['Aguascalientes', 'León']);
  });
});
