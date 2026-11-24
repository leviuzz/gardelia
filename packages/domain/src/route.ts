/**
 * Ruta del día (ADR-058, D-27 "gratis"): link di Google Maps costruiti da noi, senza chiave né
 * costi (URL pubblici "Maps URLs"). Un link porta al massimo 3 tappe intermedie più l'arrivo,
 * perché l'app di Google Maps sul telefono non ne accetta di più: un giro lungo si divide in tratti,
 * e ogni tratto parte dove finisce il precedente.
 *
 * Senza coordinate (Google Places, O-14) le fermate restano nell'ordine delle fasce e i link usano
 * l'indirizzo scritto.
 */
import { nearestNeighborOrder, type Coordinates } from './places';

/** 3 tappe intermedie (limite sul telefono) + arrivo. */
export const MAPS_STOPS_PER_LINK = 4;

const MAPS_BASE = 'https://www.google.com/maps';

/** "Ir": apre l'indirizzo in Google Maps. */
export function mapsPlaceUrl(address: string): string {
  return `${MAPS_BASE}/search/?api=1&query=${encodeURIComponent(address)}`;
}

export interface MapsRouteLink {
  /** Prima e ultima fermata del tratto (da 1). */
  readonly from: number;
  readonly to: number;
  readonly url: string;
}

/**
 * Tratti del giro: il primo parte dalla fioreria (se ha un indirizzo), i successivi dall'ultima
 * fermata del tratto prima. Nessun link senza fermate.
 */
export function mapsRouteLinks(
  origin: string | null,
  stops: readonly string[],
  perLink: number = MAPS_STOPS_PER_LINK,
): MapsRouteLink[] {
  const size = Math.max(1, Math.floor(perLink));
  const links: MapsRouteLink[] = [];
  for (let start = 0; start < stops.length; start += size) {
    const chunk = stops.slice(start, start + size);
    const from = start === 0 ? origin : (stops[start - 1] ?? null);
    const destination = chunk[chunk.length - 1] ?? '';
    const waypoints = chunk.slice(0, -1);
    const params = new URLSearchParams({ api: '1', destination, travelmode: 'driving' });
    if (from) params.set('origin', from);
    if (waypoints.length > 0) params.set('waypoints', waypoints.join('|'));
    links.push({ from: start + 1, to: start + chunk.length, url: `${MAPS_BASE}/dir/?${params}` });
  }
  return links;
}

/** La fascia di una fermata in minuti dalla mezzanotte; `null` = "in giornata". */
export interface RouteStopWindow {
  readonly start: number | null;
  readonly end: number | null;
}

export interface OrderedRouteStops<T> {
  readonly stops: T[];
  /** Almeno una fascia aveva due fermate con le coordinate: l'ordine dentro è per vicinanza. */
  readonly orderedByDistance: boolean;
}

function compareNullableMinutes(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * L'ordine del giro del giorno (consegne e visite di Floral Care, ADR-076): per fascia (inizio, poi
 * fine; quelle "in giornata" in fondo) e, dentro la stessa fascia, la fermata più vicina a dove si
 * è: la fioreria, poi l'ultima fermata con le coordinate. A parità resta l'ordine ricevuto.
 */
export function orderRouteStops<T>(
  stops: readonly T[],
  options: {
    readonly origin: Coordinates | null;
    readonly windowOf: (stop: T) => RouteStopWindow;
    readonly coordinatesOf: (stop: T) => Coordinates | null;
  },
): OrderedRouteStops<T> {
  const sorted = stops
    .map((stop, index) => ({ stop, index, window: options.windowOf(stop) }))
    .sort(
      (a, b) =>
        compareNullableMinutes(a.window.start, b.window.start) ||
        compareNullableMinutes(a.window.end, b.window.end) ||
        a.index - b.index,
    );
  const ordered: T[] = [];
  let position = options.origin;
  let orderedByDistance = false;
  for (let start = 0; start < sorted.length;) {
    const first = sorted[start]!.window;
    let end = start;
    while (
      end < sorted.length &&
      sorted[end]!.window.start === first.start &&
      sorted[end]!.window.end === first.end
    ) {
      end += 1;
    }
    const group = sorted.slice(start, end).map((entry) => entry.stop);
    if (group.filter((stop) => options.coordinatesOf(stop) !== null).length > 1) {
      orderedByDistance = true;
    }
    const inGroup = nearestNeighborOrder(position, group, options.coordinatesOf);
    ordered.push(...inGroup);
    const last = [...inGroup].reverse().find((stop) => options.coordinatesOf(stop) !== null);
    if (last) position = options.coordinatesOf(last) ?? position;
    start = end;
  }
  return { stops: ordered, orderedByDistance };
}
