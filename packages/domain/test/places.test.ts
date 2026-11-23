import { describe, expect, it } from 'vitest';
import {
  EMPTY_PLACE,
  areCoordinatesFresh,
  distanceKm,
  freshCoordinates,
  isSamePlace,
  mxRegionCode,
  nearestNeighborOrder,
  nextStoredPlace,
  parsePlaceAddress,
  readCoordinates,
  readPlaceFields,
} from '../src/index';

/** Risposta tipica di Places API (New) per un indirizzo di Aguascalientes. */
const MADERO = [
  { longText: '120', shortText: '120', types: ['street_number'] },
  {
    longText: 'Avenida Francisco I. Madero',
    shortText: 'Av. Francisco I. Madero',
    types: ['route'],
  },
  {
    longText: 'Zona Centro',
    shortText: 'Zona Centro',
    types: ['sublocality_level_1', 'sublocality', 'political'],
  },
  { longText: 'Aguascalientes', shortText: 'Aguascalientes', types: ['locality', 'political'] },
  {
    longText: 'Aguascalientes',
    shortText: 'Ags.',
    types: ['administrative_area_level_2', 'political'],
  },
  {
    longText: 'Aguascalientes',
    shortText: 'Ags.',
    types: ['administrative_area_level_1', 'political'],
  },
  { longText: 'México', shortText: 'MX', types: ['country', 'political'] },
  { longText: '20000', shortText: '20000', types: ['postal_code'] },
];

describe('indirizzo da Google Places', () => {
  it('ricava via e numero, colonia, CP, municipio e stato', () => {
    expect(parsePlaceAddress(MADERO)).toEqual({
      addressLine1: 'Avenida Francisco I. Madero 120',
      addressLine2: null,
      neighborhood: 'Zona Centro',
      postalCode: '20000',
      city: 'Aguascalientes',
      region: 'AGU',
      countryCode: 'MX',
    });
  });

  it('senza numero usa la via; CP non a 5 cifre si scarta; interior dal subpremise', () => {
    const parsed = parsePlaceAddress([
      { longText: 'Calle Juárez', types: ['route'] },
      { longText: 'Depto 4', types: ['subpremise'] },
      { longText: '2000', types: ['postal_code'] },
      { longText: 'Ciudad de México', types: ['administrative_area_level_1'] },
    ]);
    expect(parsed).toMatchObject({
      addressLine1: 'Calle Juárez',
      addressLine2: 'Depto 4',
      postalCode: null,
      region: 'CMX',
    });
  });

  it('riconosce i nomi ufficiali degli stati', () => {
    expect(mxRegionCode('Michoacán de Ocampo')).toBe('MIC');
    expect(mxRegionCode('Estado de México')).toBe('MEX');
    expect(mxRegionCode('México')).toBe('MEX');
    expect(mxRegionCode('Nuevo León')).toBe('NLE');
    expect(mxRegionCode('Texas')).toBeNull();
    expect(mxRegionCode(null)).toBeNull();
  });
});

describe('coordinate dal form', () => {
  it('servono place ID e coordinate valide; altrimenti niente coordinate', () => {
    expect(
      readPlaceFields({
        placeId: 'ChIJ1234567890abc',
        latitude: '21.8818',
        longitude: '-102.2916',
      }),
    ).toEqual({
      placeId: 'ChIJ1234567890abc',
      coordinates: { latitude: 21.8818, longitude: -102.2916 },
    });
    expect(
      readPlaceFields({ placeId: 'ChIJ1234567890abc', latitude: '200', longitude: '0' }),
    ).toEqual({ placeId: 'ChIJ1234567890abc', coordinates: null });
    expect(readPlaceFields({ placeId: '<script>', latitude: '1', longitude: '1' })).toEqual({
      placeId: null,
      coordinates: null,
    });
    expect(readPlaceFields({})).toEqual({ placeId: null, coordinates: null });
  });

  it('le coordinate da sole (preferenza per i dintorni): entrambe valide o nessuna', () => {
    expect(readCoordinates(21.88, '-102.29')).toEqual({ latitude: 21.88, longitude: -102.29 });
    expect(readCoordinates(21.88, undefined)).toBeNull();
    expect(readCoordinates('', '')).toBeNull();
    expect(readCoordinates(Number.NaN, 0)).toBeNull();
    expect(readCoordinates(0, 181)).toBeNull();
  });

  it('coordinate salvate: entrambe e ancora valide, altrimenti null', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    const recent = new Date('2026-11-20T12:00:00Z');
    const old = new Date('2026-10-20T12:00:00Z');
    expect(
      freshCoordinates({ latitude: 21.8, longitude: -102.2, coordinatesAt: recent }, now),
    ).toEqual({ latitude: 21.8, longitude: -102.2 });
    // Lo zero è una coordinata valida, non "assente".
    expect(freshCoordinates({ latitude: 0, longitude: 0, coordinatesAt: recent }, now)).toEqual({
      latitude: 0,
      longitude: 0,
    });
    expect(
      freshCoordinates({ latitude: 21.8, longitude: -102.2, coordinatesAt: old }, now),
    ).toBeNull();
    expect(
      freshCoordinates({ latitude: 21.8, longitude: null, coordinatesAt: recent }, now),
    ).toBeNull();
    expect(
      freshCoordinates({ latitude: 21.8, longitude: -102.2, coordinatesAt: null }, now),
    ).toBeNull();
  });

  it('le coordinate valgono 30 giorni', () => {
    const now = new Date('2026-11-23T12:00:00Z');
    expect(areCoordinatesFresh(new Date('2026-11-01T12:00:00Z'), now)).toBe(true);
    expect(areCoordinatesFresh(new Date('2026-10-20T12:00:00Z'), now)).toBe(false);
    expect(areCoordinatesFresh(null, now)).toBe(false);
  });
});

describe('distanze e ordine di visita', () => {
  const centro = { latitude: 21.8818, longitude: -102.2916 };
  const norte = { latitude: 21.9411, longitude: -102.2918 };
  const sur = { latitude: 21.8411, longitude: -102.2916 };

  it('calcola i km in linea d’aria', () => {
    expect(distanceKm(centro, norte)).toBeGreaterThan(6.5);
    expect(distanceKm(centro, norte)).toBeLessThan(6.7);
    expect(distanceKm(centro, centro)).toBe(0);
  });

  it('visita prima la più vicina; quelle senza coordinate in fondo', () => {
    const stops = [
      { id: 'norte', at: norte },
      { id: 'senza', at: null },
      { id: 'sur', at: sur },
    ];
    expect(nearestNeighborOrder(centro, stops, (stop) => stop.at).map((stop) => stop.id)).toEqual([
      'sur',
      'norte',
      'senza',
    ]);
    // Senza partenza si comincia dalla prima fermata con coordinate.
    expect(nearestNeighborOrder(null, stops, (stop) => stop.at).map((stop) => stop.id)).toEqual([
      'norte',
      'sur',
      'senza',
    ]);
  });
});

describe('cosa salvare dopo il form', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const before = new Date('2026-11-10T12:00:00Z');
  const saved = {
    placeId: 'ChIJ_saved_place_1',
    latitude: 21.8,
    longitude: -102.2,
    coordinatesAt: before,
  };

  it('scelta nuova: coordinate datate adesso', () => {
    expect(
      nextStoredPlace(
        { placeId: 'ChIJ_new_place_22', latitude: '21.9', longitude: '-102.3' },
        saved,
        now,
      ),
    ).toEqual({
      placeId: 'ChIJ_new_place_22',
      latitude: 21.9,
      longitude: -102.3,
      coordinatesAt: now,
    });
  });

  it('stesso luogo senza nuove coordinate: resta tutto, anche la data', () => {
    expect(
      nextStoredPlace(
        { placeId: 'ChIJ_saved_place_1' },
        { ...saved, id: 'riga', label: 'Casa' } as never,
        now,
      ),
    ).toEqual(saved);
  });

  it('scritto a mano: niente place ID né coordinate', () => {
    expect(nextStoredPlace({ placeId: '' }, saved, now)).toEqual(EMPTY_PLACE);
    expect(nextStoredPlace({}, null, now)).toEqual(EMPTY_PLACE);
  });

  it('stesso luogo: le date si confrontano per valore', () => {
    expect(isSamePlace(saved, { ...saved, coordinatesAt: new Date(before) })).toBe(true);
    expect(isSamePlace(saved, { ...saved, coordinatesAt: now })).toBe(false);
    expect(isSamePlace(saved, { ...saved, placeId: 'ChIJ_other_place' })).toBe(false);
    expect(isSamePlace(EMPTY_PLACE, { ...EMPTY_PLACE })).toBe(true);
  });
});
