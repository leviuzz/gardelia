import { describe, expect, it } from 'vitest';
import { mapsPlaceUrl, mapsRouteLinks, orderRouteStops } from '../src/index';

describe('link di Google Maps', () => {
  it('"Ir" cerca l’indirizzo', () => {
    expect(mapsPlaceUrl('Av. Madero 120, Centro, Aguascalientes')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Av.%20Madero%20120%2C%20Centro%2C%20Aguascalientes',
    );
  });

  it('un giro lungo si divide in tratti da 4 fermate che ripartono dall’ultima', () => {
    const stops = ['A', 'B', 'C', 'D', 'E', 'F'];
    const links = mapsRouteLinks('Florería', stops);
    expect(links.map((link) => [link.from, link.to])).toEqual([
      [1, 4],
      [5, 6],
    ]);
    const first = new URL(links[0]!.url);
    expect(first.pathname).toBe('/maps/dir/');
    expect(first.searchParams.get('origin')).toBe('Florería');
    expect(first.searchParams.get('waypoints')).toBe('A|B|C');
    expect(first.searchParams.get('destination')).toBe('D');
    const second = new URL(links[1]!.url);
    expect(second.searchParams.get('origin')).toBe('D');
    expect(second.searchParams.get('waypoints')).toBe('E');
    expect(second.searchParams.get('destination')).toBe('F');
  });

  it('senza indirizzo della fioreria parte da dove si è; senza fermate nessun link', () => {
    const [only] = mapsRouteLinks(null, ['A']);
    expect(new URL(only!.url).searchParams.has('origin')).toBe(false);
    expect(new URL(only!.url).searchParams.has('waypoints')).toBe(false);
    expect(mapsRouteLinks('Florería', [])).toEqual([]);
  });
});

describe('orden de la ruta (consegne e visite)', () => {
  const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
  const stop = (
    id: string,
    start: number | null,
    end: number | null,
    coordinates: { latitude: number; longitude: number } | null = null,
  ) => ({ id, window: { start, end }, coordinates });
  const ids = (stops: readonly { id: string }[]) => stops.map((item) => item.id);
  const order = (stops: ReturnType<typeof stop>[], origin = null as null | ReturnType<typeof at>) =>
    orderRouteStops(stops, {
      origin,
      windowOf: (item) => item.window,
      coordinatesOf: (item) => item.coordinates,
    });

  it('per fascia, poi per fine; le fermate "in giornata" in fondo; a parità l’ordine ricevuto', () => {
    const result = order([
      stop('libre', null, null),
      stop('tarde', 900, 1080),
      stop('manana-larga', 540, 780),
      stop('manana', 540, 720),
      stop('manana-2', 540, 720),
    ]);
    expect(ids(result.stops)).toEqual(['manana', 'manana-2', 'manana-larga', 'tarde', 'libre']);
    expect(result.orderedByDistance).toBe(false);
  });

  it('dentro la fascia la più vicina, partendo dalla fioreria e poi dall’ultima fermata', () => {
    const shop = at(20.67, -103.35);
    const result = order(
      [
        stop('lejos', 540, 720, at(20.75, -103.35)),
        stop('cerca', 540, 720, at(20.68, -103.35)),
        stop('sin-mapa', 540, 720),
        stop('tarde-cerca-del-lejos', 900, 1080, at(20.76, -103.35)),
        stop('tarde-cerca-de-la-tienda', 900, 1080, at(20.67, -103.36)),
      ],
      shop,
    );
    expect(ids(result.stops)).toEqual([
      'cerca',
      'lejos',
      'sin-mapa',
      'tarde-cerca-del-lejos',
      'tarde-cerca-de-la-tienda',
    ]);
    expect(result.orderedByDistance).toBe(true);
  });
});
