import { describe, expect, it } from 'vitest';
import { GooglePlacesProvider, PlacesUnavailableError } from '../src/index';

/** Adattatore di Google Places (ADR-059) con un fetch finto: richieste giuste, risposte lette bene. */

function fakeFetch(responses: readonly { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(index++, responses.length - 1)]!;
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { calls, fetchImpl };
}

describe('GooglePlacesProvider', () => {
  it('chiede suggerimenti solo nel paese, con la sessione e la chiave nell’intestazione', async () => {
    const { calls, fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          suggestions: [
            {
              placePrediction: {
                placeId: 'ChIJ_madero_120',
                text: { text: 'Av. Madero 120, Zona Centro, Aguascalientes' },
                structuredFormat: {
                  mainText: { text: 'Av. Madero 120' },
                  secondaryText: { text: 'Zona Centro, Aguascalientes, Ags.' },
                },
              },
            },
            { queryPrediction: { text: { text: 'madero' } } },
          ],
        },
      },
    ]);
    const provider = new GooglePlacesProvider('test-key-0123456789012345678901234567', fetchImpl);
    const suggestions = await provider.autocomplete({
      input: 'Madero 120',
      sessionToken: '6f9619ff-8b86-4011-b42d-00cf4fc964ff',
      languageCode: 'es-MX',
      regionCode: 'mx',
      near: { latitude: 21.88, longitude: -102.29 },
    });
    expect(suggestions).toEqual([
      {
        placeId: 'ChIJ_madero_120',
        mainText: 'Av. Madero 120',
        secondaryText: 'Zona Centro, Aguascalientes, Ags.',
      },
    ]);
    const [call] = calls;
    expect(call!.url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    const headers = call!.init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-key-0123456789012345678901234567');
    expect(headers['X-Goog-FieldMask']).toContain('suggestions.placePrediction.placeId');
    const body = JSON.parse(String(call!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      input: 'Madero 120',
      includedRegionCodes: ['mx'],
      sessionToken: '6f9619ff-8b86-4011-b42d-00cf4fc964ff',
    });
    expect(body.locationBias).toBeDefined();
    // La chiave non va mai nell'URL.
    expect(call!.url).not.toContain('key=');
  });

  it('dettagli: indirizzo messicano e coordinate, con la stessa sessione', async () => {
    const { calls, fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          id: 'ChIJ_madero_120',
          location: { latitude: 21.8818, longitude: -102.2916 },
          addressComponents: [
            { longText: '120', types: ['street_number'] },
            { longText: 'Avenida Madero', types: ['route'] },
            { longText: 'Zona Centro', types: ['sublocality_level_1'] },
            { longText: 'Aguascalientes', types: ['administrative_area_level_2'] },
            { longText: 'Aguascalientes', types: ['administrative_area_level_1'] },
            { longText: 'México', shortText: 'MX', types: ['country'] },
            { longText: '20000', types: ['postal_code'] },
          ],
        },
      },
    ]);
    const provider = new GooglePlacesProvider('test-key-0123456789012345678901234567', fetchImpl);
    const details = await provider.details({
      placeId: 'ChIJ_madero_120',
      sessionToken: 'session-1',
      languageCode: 'es-MX',
    });
    expect(details).toEqual({
      placeId: 'ChIJ_madero_120',
      addressLine1: 'Avenida Madero 120',
      addressLine2: null,
      neighborhood: 'Zona Centro',
      postalCode: '20000',
      city: 'Aguascalientes',
      region: 'AGU',
      countryCode: 'MX',
      coordinates: { latitude: 21.8818, longitude: -102.2916 },
    });
    expect(calls[0]!.url).toBe(
      'https://places.googleapis.com/v1/places/ChIJ_madero_120?languageCode=es-MX&sessionToken=session-1',
    );
    expect((calls[0]!.init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(
      'id,addressComponents,location',
    );
  });

  it('un errore di Google diventa "non disponibile", senza esporre il corpo', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 403, body: { error: { message: 'API key not valid' } } },
    ]);
    const provider = new GooglePlacesProvider('test-key-0123456789012345678901234567', fetchImpl);
    await expect(
      provider.autocomplete({
        input: 'Madero',
        sessionToken: 's',
        languageCode: 'es-MX',
        regionCode: 'mx',
      }),
    ).rejects.toBeInstanceOf(PlacesUnavailableError);
    const failing = new GooglePlacesProvider('test-key-0123456789012345678901234567', async () => {
      throw new Error('ECONNRESET');
    });
    await expect(
      failing.details({ placeId: 'x', sessionToken: null, languageCode: 'es-MX' }),
    ).rejects.toBeInstanceOf(PlacesUnavailableError);
  });
});
