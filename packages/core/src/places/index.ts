/**
 * Google Places (ADR-059): suggerimenti mentre si scrive l'indirizzo e dettagli dell'indirizzo
 * scelto. Si chiama SOLO dal server con la chiave della piattaforma (`GOOGLE_MAPS_API_KEY`): il
 * browser chiede i suggerimenti alla nostra app, che li chiede a Google. Senza chiave l'adattatore
 * non c'è e gli indirizzi si scrivono a mano (nessuna funzione finta).
 *
 * Places API (New), con le "sessioni": i suggerimenti di una sessione sono gratuiti se finiscono con
 * i dettagli di un indirizzo, che si pagano una volta (tariffa Essentials).
 */
import {
  PLACES_LIMITS,
  parsePlaceAddress,
  type Coordinates,
  type ParsedPlaceAddress,
  type PlaceAddressComponent,
} from '@floral/domain';
import { placesConfig } from '../config';
import { logger } from '../logger';

export interface PlaceSuggestion {
  readonly placeId: string;
  /** "Avenida Madero 120". */
  readonly mainText: string;
  /** "Zona Centro, Aguascalientes, Ags., México". */
  readonly secondaryText: string | null;
}

export interface PlaceDetails extends ParsedPlaceAddress {
  readonly placeId: string;
  readonly coordinates: Coordinates | null;
}

export interface AutocompleteRequest {
  readonly input: string;
  /** Identificativo della sessione di ricerca (UUID scelto dal browser). */
  readonly sessionToken: string;
  readonly languageCode: string;
  /** Paese del mercato (es. "mx"): solo indirizzi di lì. */
  readonly regionCode: string;
  /** Per dare la precedenza agli indirizzi vicini alla fioreria. */
  readonly near?: Coordinates | null;
}

export interface DetailsRequest {
  readonly placeId: string;
  readonly sessionToken: string | null;
  readonly languageCode: string;
}

export interface PlacesProvider {
  readonly id: string;
  autocomplete(request: AutocompleteRequest): Promise<readonly PlaceSuggestion[]>;
  details(request: DetailsRequest): Promise<PlaceDetails | null>;
}

/** Google non risponde o risponde con un errore: il form resta usabile a mano. */
export class PlacesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacesUnavailableError';
  }
}

const BASE = 'https://places.googleapis.com/v1';
const TIMEOUT_MS = 5000;
/** Raggio della preferenza per gli indirizzi vicini alla fioreria. */
const BIAS_RADIUS_M = 30_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface AutocompleteResponse {
  readonly suggestions?: readonly {
    readonly placePrediction?: {
      readonly placeId?: string;
      readonly text?: { readonly text?: string };
      readonly structuredFormat?: {
        readonly mainText?: { readonly text?: string };
        readonly secondaryText?: { readonly text?: string };
      };
    };
  }[];
}

interface DetailsResponse {
  readonly id?: string;
  readonly addressComponents?: readonly PlaceAddressComponent[];
  readonly location?: { readonly latitude?: number; readonly longitude?: number };
}

export class GooglePlacesProvider implements PlacesProvider {
  readonly id = 'google';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async call<T>(url: string, init: RequestInit, fieldMask: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'places: rete');
      throw new PlacesUnavailableError('network');
    }
    if (!response.ok) {
      // Mai il corpo nei log: può contenere l'indirizzo cercato.
      logger.warn({ status: response.status }, 'places: risposta di errore');
      throw new PlacesUnavailableError(`status_${response.status}`);
    }
    return (await response.json()) as T;
  }

  async autocomplete(request: AutocompleteRequest): Promise<readonly PlaceSuggestion[]> {
    const body = {
      input: request.input,
      sessionToken: request.sessionToken,
      languageCode: request.languageCode,
      includedRegionCodes: [request.regionCode],
      ...(request.near
        ? {
            locationBias: {
              circle: {
                center: { latitude: request.near.latitude, longitude: request.near.longitude },
                radius: BIAS_RADIUS_M,
              },
            },
          }
        : {}),
    };
    const data = await this.call<AutocompleteResponse>(
      `${BASE}/places:autocomplete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
    );
    const suggestions: PlaceSuggestion[] = [];
    for (const item of data.suggestions ?? []) {
      const prediction = item.placePrediction;
      const placeId = prediction?.placeId;
      const mainText = prediction?.structuredFormat?.mainText?.text ?? prediction?.text?.text;
      if (!placeId || !mainText) continue;
      suggestions.push({
        placeId,
        mainText,
        secondaryText: prediction?.structuredFormat?.secondaryText?.text ?? null,
      });
      if (suggestions.length >= PLACES_LIMITS.suggestions) break;
    }
    return suggestions;
  }

  async details(request: DetailsRequest): Promise<PlaceDetails | null> {
    const params = new URLSearchParams({ languageCode: request.languageCode });
    if (request.sessionToken) params.set('sessionToken', request.sessionToken);
    const data = await this.call<DetailsResponse>(
      `${BASE}/places/${encodeURIComponent(request.placeId)}?${params}`,
      { method: 'GET' },
      'id,addressComponents,location',
    );
    if (!data.id) return null;
    const latitude = data.location?.latitude;
    const longitude = data.location?.longitude;
    return {
      ...parsePlaceAddress(data.addressComponents ?? []),
      placeId: data.id,
      coordinates:
        typeof latitude === 'number' && typeof longitude === 'number'
          ? { latitude, longitude }
          : null,
    };
  }
}

let override: PlacesProvider | null | undefined;

/** Solo per i test: un provider finto (o `null` per simulare l'assenza della chiave). */
export function setPlacesProvider(provider: PlacesProvider | null | undefined): void {
  override = provider;
}

/** Il provider configurato, o null se manca la chiave (indirizzi a mano). */
export function getPlacesProvider(): PlacesProvider | null {
  if (override !== undefined) return override;
  const key = placesConfig().GOOGLE_MAPS_API_KEY;
  return key ? new GooglePlacesProvider(key) : null;
}
