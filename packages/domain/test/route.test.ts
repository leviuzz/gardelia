import { describe, expect, it } from 'vitest';
import { mapsPlaceUrl, mapsRouteLinks } from '../src/index';

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
