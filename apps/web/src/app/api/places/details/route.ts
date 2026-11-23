/**
 * Dettagli dell'indirizzo scelto fra i suggerimenti (Google Places, ADR-059): campi dell'indirizzo
 * messicano e coordinate, che il form salva insieme all'indirizzo (le coordinate per 30 giorni).
 */
import { PlacesUnavailableError, getPlacesProvider, logger } from '@floral/core';
import { placesGate, sessionTokenOf } from '@/lib/places-request';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const provider = getPlacesProvider();
  if (!provider) return new Response(null, { status: 404 });
  const gate = await placesGate(request);
  if (!gate.ok) return gate.response;
  const placeId =
    typeof gate.body.placeId === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(gate.body.placeId)
      ? gate.body.placeId
      : null;
  if (!placeId) return new Response(null, { status: 400 });
  try {
    const details = await provider.details({
      placeId,
      sessionToken: sessionTokenOf(gate.body.sessionToken),
      languageCode: 'es-MX',
    });
    if (!details) return new Response(null, { status: 404 });
    return Response.json({ details });
  } catch (error) {
    if (error instanceof PlacesUnavailableError) return new Response(null, { status: 503 });
    logger.error({ err: error }, 'places: errore inatteso nei dettagli');
    return new Response(null, { status: 500 });
  }
}
