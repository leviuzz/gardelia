/**
 * Suggerimenti di indirizzo mentre si scrive (Google Places, ADR-059). Il browser chiede a noi; noi
 * chiediamo a Google con la chiave del server, che non lascia mai il server. Senza chiave: 404 e il
 * form resta a mano.
 */
import { PlacesUnavailableError, getPlacesProvider, logger } from '@floral/core';
import { PLACES_LIMITS, readCoordinates } from '@floral/domain';
import { placesGate, sessionTokenOf } from '@/lib/places-request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const provider = getPlacesProvider();
  if (!provider) return new Response(null, { status: 404 });
  const gate = await placesGate(request);
  if (!gate.ok) return gate.response;
  const input = typeof gate.body.input === 'string' ? gate.body.input.trim() : '';
  const sessionToken = sessionTokenOf(gate.body.sessionToken);
  if (
    input.length < PLACES_LIMITS.inputMin ||
    input.length > PLACES_LIMITS.inputMax ||
    !sessionToken
  ) {
    return new Response(null, { status: 400 });
  }
  // Vicino alla fioreria (facoltativo): solo un'indicazione di preferenza per Google.
  const near = readCoordinates(gate.body.nearLatitude, gate.body.nearLongitude);
  try {
    const suggestions = await provider.autocomplete({
      input,
      sessionToken,
      languageCode: 'es-MX',
      regionCode: 'mx',
      near,
    });
    return Response.json({ suggestions });
  } catch (error) {
    if (error instanceof PlacesUnavailableError) return new Response(null, { status: 503 });
    logger.error({ err: error }, 'places: errore inatteso nei suggerimenti');
    return new Response(null, { status: 500 });
  }
}
