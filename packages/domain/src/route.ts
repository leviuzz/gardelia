/**
 * Ruta del día (ADR-058, D-27 "gratis"): link di Google Maps costruiti da noi, senza chiave né
 * costi (URL pubblici "Maps URLs"). Un link porta al massimo 3 tappe intermedie più l'arrivo,
 * perché l'app di Google Maps sul telefono non ne accetta di più: un giro lungo si divide in tratti,
 * e ogni tratto parte dove finisce il precedente.
 *
 * Senza coordinate (Google Places, O-14) le fermate restano nell'ordine delle fasce e i link usano
 * l'indirizzo scritto.
 */

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
