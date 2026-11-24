/**
 * Indirizzi da Google Places (ADR-059): regole pure per trasformare la risposta di Places in un
 * indirizzo messicano (calle y número, interior, colonia, CP, municipio, estado), per le
 * coordinate e per le distanze. Nessun I/O: le chiamate a Google stanno in `@floral/core`.
 *
 * Regole d'uso di Google (da rispettare nel codice che usa queste funzioni):
 *  - il **place ID** si conserva senza limiti;
 *  - **latitudine e longitudine** si conservano al massimo **30 giorni** (`COORDINATES_TTL_DAYS`),
 *    poi si cancellano (lavoro giornaliero) e, se servono, si richiedono di nuovo dal place ID;
 *  - i suggerimenti mostrati senza una mappa di Google portano l'attribuzione "Google Maps".
 */
import { z } from 'zod';
import { MX_REGIONS } from './markets';

/** Per quanto si tengono le coordinate avute da Google prima di cancellarle. */
export const COORDINATES_TTL_DAYS = 30;

export const PLACES_LIMITS = {
  /** Testo minimo e massimo per chiedere suggerimenti. */
  inputMin: 3,
  inputMax: 200,
  /** Suggerimenti mostrati. */
  suggestions: 5,
} as const;

/** Componente dell'indirizzo come lo restituisce Places API (New). */
export interface PlaceAddressComponent {
  readonly longText?: string;
  readonly shortText?: string;
  readonly types?: readonly string[];
}

export interface ParsedPlaceAddress {
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly neighborhood: string | null;
  readonly postalCode: string | null;
  readonly city: string | null;
  /** Codice dello stato (es. "AGU"), null se non riconosciuto. */
  readonly region: string | null;
  readonly countryCode: string | null;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nomi ufficiali o comuni degli stati che Google usa e che non coincidono con i nostri. */
const REGION_ALIASES: Readonly<Record<string, string>> = {
  cdmx: 'CMX',
  'ciudad de mexico': 'CMX',
  'distrito federal': 'CMX',
  mexico: 'MEX',
  'estado de mexico': 'MEX',
  'coahuila de zaragoza': 'COA',
  'michoacan de ocampo': 'MIC',
  'veracruz de ignacio de la llave': 'VER',
  'queretaro de arteaga': 'QUE',
};

/** Codice dello stato messicano da un nome ("Aguascalientes", "Michoacán de Ocampo", "CDMX"). */
export function mxRegionCode(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = normalize(name);
  if (REGION_ALIASES[key]) return REGION_ALIASES[key];
  const match = MX_REGIONS.find((region) => normalize(region.name) === key);
  return match?.code ?? null;
}

function pick(
  components: readonly PlaceAddressComponent[],
  types: readonly string[],
  form: 'long' | 'short' = 'long',
): string | null {
  for (const type of types) {
    const found = components.find((component) => component.types?.includes(type));
    const value = form === 'short' ? found?.shortText : found?.longText;
    if (value && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Indirizzo messicano dai componenti di Places. In Messico il "municipio" è il livello 2
 * amministrativo (o la città, se manca) e la "colonia" il sottolocalità o il quartiere.
 */
export function parsePlaceAddress(
  components: readonly PlaceAddressComponent[],
): ParsedPlaceAddress {
  const route = pick(components, ['route']);
  const number = pick(components, ['street_number']);
  const premise = pick(components, ['premise']);
  const addressLine1 =
    [route, number].filter(Boolean).join(' ') ||
    premise ||
    pick(components, ['point_of_interest']) ||
    '';
  const postal = pick(components, ['postal_code']);
  return {
    addressLine1,
    addressLine2: pick(components, ['subpremise']),
    neighborhood: pick(components, [
      'sublocality_level_1',
      'sublocality',
      'neighborhood',
      'sublocality_level_2',
    ]),
    postalCode: postal && /^\d{5}$/.test(postal) ? postal : null,
    city: pick(components, ['administrative_area_level_2', 'locality']),
    region: mxRegionCode(pick(components, ['administrative_area_level_1'])),
    countryCode: pick(components, ['country'], 'short')?.toUpperCase() ?? null,
  };
}

/**
 * Via e numero da mettere nel form quando Google non li dà (succede con un indirizzo appena
 * costruito o con un negozio): il testo del suggerimento che la persona ha scelto, se ha un numero
 * civico ("Magnolias 59"). Una colonia ("Rancho Santa Monica") no: la via la scrive la persona.
 */
export function streetFromSuggestion(
  label: string | null | undefined,
  found: { readonly neighborhood: string | null; readonly city: string | null },
): string {
  const text = (label ?? '').trim();
  if (text === '' || !/\d/.test(text)) return '';
  const same = (other: string | null) => other !== null && normalize(other) === normalize(text);
  if (same(found.neighborhood) || same(found.city) || /^\d{5}$/.test(text)) return '';
  return text;
}

// -----------------------------------------------------------------------------
// Coordinate e distanze
// -----------------------------------------------------------------------------

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

const coordinate = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z.number().finite().min(min).max(max),
  );

/** Coordinate da valori grezzi (form o JSON): entrambe valide o nessuna. */
export function readCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  const lat = coordinate(-90, 90).safeParse(latitude);
  const lng = coordinate(-180, 180).safeParse(longitude);
  return lat.success && lng.success ? { latitude: lat.data, longitude: lng.data } : null;
}

/**
 * Coordinate e place ID arrivati dal form (dal suggerimento scelto): facoltativi, entrambe le
 * coordinate o nessuna. Valori sbagliati si scartano invece di bloccare il salvataggio: l'indirizzo
 * scritto resta valido anche senza coordinate.
 */
export function readPlaceFields(raw: {
  readonly placeId?: unknown;
  readonly latitude?: unknown;
  readonly longitude?: unknown;
}): { readonly placeId: string | null; readonly coordinates: Coordinates | null } {
  const placeId =
    typeof raw.placeId === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(raw.placeId.trim())
      ? raw.placeId.trim()
      : null;
  return {
    placeId,
    coordinates: placeId ? readCoordinates(raw.latitude, raw.longitude) : null,
  };
}

/** Le coordinate prese a `fetchedAt` sono ancora utilizzabili a `now` (entro 30 giorni). */
export function areCoordinatesFresh(fetchedAt: Date | null, now: Date): boolean {
  if (!fetchedAt) return false;
  return now.getTime() - fetchedAt.getTime() < COORDINATES_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** Coordinate salvate ancora utilizzabili (entrambe presenti ed entro i 30 giorni), o null. */
export function freshCoordinates(
  stored: {
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly coordinatesAt: Date | null;
  },
  now: Date,
): Coordinates | null {
  const { latitude, longitude, coordinatesAt } = stored;
  if (latitude === null || longitude === null || !areCoordinatesFresh(coordinatesAt, now)) {
    return null;
  }
  return { latitude, longitude };
}

/** Distanza in linea d'aria (km) fra due punti, formula dell'emisenoverso. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ordine di visita "il più vicino dopo": dal punto di partenza alla fermata più vicina, poi alla
 * più vicina a quella, e così via. Le fermate senza coordinate restano in fondo, nell'ordine dato.
 * Non è il percorso ottimo, ma è semplice, gratis e buono per i giri di una fioreria.
 */
export function nearestNeighborOrder<T>(
  start: Coordinates | null,
  stops: readonly T[],
  coordinatesOf: (stop: T) => Coordinates | null,
): T[] {
  const located = stops.filter((stop) => coordinatesOf(stop) !== null);
  const unlocated = stops.filter((stop) => coordinatesOf(stop) === null);
  const ordered: T[] = [];
  const remaining = [...located];
  let current = start ?? (remaining[0] ? coordinatesOf(remaining[0]) : null);
  while (remaining.length > 0 && current) {
    let bestIndex = 0;
    let best = Infinity;
    remaining.forEach((stop, index) => {
      const distance = distanceKm(current as Coordinates, coordinatesOf(stop) as Coordinates);
      if (distance < best) {
        best = distance;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    if (!next) break;
    ordered.push(next);
    current = coordinatesOf(next);
  }
  return [...ordered, ...remaining, ...unlocated];
}

/** Place ID e coordinate come si salvano su un indirizzo. */
export interface StoredPlace {
  readonly placeId: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly coordinatesAt: Date | null;
}

export const EMPTY_PLACE: StoredPlace = {
  placeId: null,
  latitude: null,
  longitude: null,
  coordinatesAt: null,
};

/**
 * Cosa salvare dopo un form d'indirizzo:
 *  - indirizzo appena scelto fra i suggerimenti (place ID + coordinate) → coordinate datate adesso;
 *  - stesso place ID di prima senza coordinate nuove (il form non l'ha toccato) → tutto com'era,
 *    anche la data: la cache di 30 giorni non si allunga salvando;
 *  - nessun place ID (scritto o corretto a mano) → niente place ID né coordinate.
 */
export function nextStoredPlace(
  raw: { readonly placeId?: unknown; readonly latitude?: unknown; readonly longitude?: unknown },
  existing: StoredPlace | null,
  now: Date,
): StoredPlace {
  const { placeId, coordinates } = readPlaceFields(raw);
  if (placeId && coordinates) {
    return {
      placeId,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      coordinatesAt: now,
    };
  }
  if (placeId && existing?.placeId === placeId) {
    // Solo i quattro campi: `existing` può essere l'intera riga dell'indirizzo.
    return {
      placeId: existing.placeId,
      latitude: existing.latitude,
      longitude: existing.longitude,
      coordinatesAt: existing.coordinatesAt,
    };
  }
  if (placeId) return { ...EMPTY_PLACE, placeId };
  return EMPTY_PLACE;
}

/** Stesso luogo salvato (le date si confrontano per valore, non per riferimento). */
export function isSamePlace(a: StoredPlace, b: StoredPlace): boolean {
  return (
    a.placeId === b.placeId &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    (a.coordinatesAt?.getTime() ?? null) === (b.coordinatesAt?.getTime() ?? null)
  );
}
