/**
 * Provider reale delle anteprime: fal.ai [O-01, ADR-026].
 *
 *  - Modelli provati sui ramos demo il 21/11/2026 (docs/AI_BENCHMARK.md): Nano Banana 2 è il
 *    predefinito (conteggi più fedeli, ~10 s), GPT Image 2 l'alternativa (`AI_MODEL`).
 *    Un modello nuovo si aggiunge qui (corpo della richiesta + costo stimato) solo dopo una
 *    prova sugli stessi ramos.
 *  - Chiamata sincrona `POST https://fal.run/<endpoint>` con `sync_mode`: l'immagine torna
 *    nella risposta (data URI) invece di restare sul CDN di fal.
 *  - Il prompt contiene solo la composizione (fiori, colori, stile): mai dati del cliente.
 *  - La risposta è un dato non fidato: tipo dell'immagine verificato dai byte, dimensioni
 *    massime, eventuale download solo in https da host `fal.media`.
 *  - Errori → codici di `provider-types.ts`: moderazione = content_rejected; 4xx (richiesta,
 *    chiave, saldo esaurito) = invalid_request; 408/429/5xx/rete = provider_error;
 *    scadenza = timeout. La chiave non compare mai in messaggi, log o serializzazioni.
 */
import {
  buildBoxCountPrompt,
  buildCountCheckPrompt,
  parseBoxCount,
  parseCountCheck,
  type CountCheckResult,
  type CountTarget,
} from '@floral/domain';
import {
  AiProviderError,
  sniffImageType,
  type AiImageProvider,
  type GeneratedImage,
} from './provider-types';
import type { BackgroundRemover } from './background-remover';
import type { FlowerCounter } from './flower-counter-types';
import { STYLE_DESCRIBER_PROMPT, type StyleDescriber, type StyleDescription } from './style-types';

export interface FalModelProfile {
  /** Endpoint fal, es. `fal-ai/nano-banana-2` (è anche il `model` salvato nei job). */
  readonly endpoint: string;
  /** Costo stimato per immagine in micro-USD (listino fal, arrotondato per eccesso). */
  readonly estimatedCostMicros: number;
  /** Corpo della richiesta: sempre una sola immagine quadrata JPEG, restituita inline. */
  body(prompt: string): Record<string, unknown>;
  /** Variante "modifica" che parte da un'immagine (il boceto esatto, ADR-034), se esiste. */
  readonly edit?: {
    readonly endpoint: string;
    body(prompt: string, imageUrl: string): Record<string, unknown>;
  };
}

export const FAL_MODELS = {
  'nano-banana-2': {
    endpoint: 'fal-ai/nano-banana-2',
    // Listino: 0,08 USD a risoluzione 1K (1024 × 1024).
    estimatedCostMicros: 80_000,
    body: (prompt: string) => ({
      prompt,
      num_images: 1,
      aspect_ratio: '1:1',
      resolution: '1K',
      output_format: 'jpeg',
      sync_mode: true,
    }),
    // Stesso listino stimato; provata il 21/11/2026 (boceto → foto, conteggi esatti).
    edit: {
      endpoint: 'fal-ai/nano-banana-2/edit',
      body: (prompt: string, imageUrl: string) => ({
        prompt,
        image_urls: [imageUrl],
        num_images: 1,
        aspect_ratio: '1:1',
        resolution: '1K',
        output_format: 'jpeg',
        sync_mode: true,
      }),
    },
  },
  'gpt-image-2': {
    endpoint: 'fal-ai/gpt-image-2',
    // Listino: ~0,053 USD con quality "medium" a 1024 × 1024.
    estimatedCostMicros: 60_000,
    body: (prompt: string) => ({
      prompt,
      num_images: 1,
      image_size: 'square_hd',
      quality: 'medium',
      output_format: 'jpeg',
      sync_mode: true,
    }),
  },
} as const satisfies Record<string, FalModelProfile>;

export type FalModelId = keyof typeof FAL_MODELS;
export const DEFAULT_FAL_MODEL: FalModelId = 'nano-banana-2';
export const FAL_MODEL_IDS = Object.keys(FAL_MODELS) as FalModelId[];

export function isFalModelId(value: string): value is FalModelId {
  return Object.hasOwn(FAL_MODELS, value);
}

/** JSON con l'immagine in base64 (~0,2–0,4 MB per un JPEG 1K): margine ampio. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;
const DATA_URI_PREFIX = /^data:image\/(?:png|jpe?g|webp);base64,/i;
const FAL_MEDIA_HOST = /^(?:[a-z0-9-]+\.)*fal\.media$/i;

export interface FalProviderOptions {
  readonly apiKey: string;
  readonly model?: FalModelId;
  /** Solo per i test. */
  readonly baseUrl?: string;
  /** Solo per i test. */
  readonly fetch?: typeof fetch;
}

export class FalImageProvider implements AiImageProvider {
  readonly id = 'fal';
  readonly simulated = false;
  readonly model: string;
  readonly estimatedCostMicros: number;
  readonly supportsSketch: boolean;
  // Campi privati veri: la chiave non finisce in JSON.stringify né nei log.
  readonly #apiKey: string;
  readonly #profile: FalModelProfile;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: FalProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error('FAL_KEY mancante');
    this.#apiKey = apiKey;
    this.#profile = FAL_MODELS[options.model ?? DEFAULT_FAL_MODEL];
    this.#baseUrl = (options.baseUrl ?? 'https://fal.run').replace(/\/+$/, '');
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.model = this.#profile.endpoint;
    this.estimatedCostMicros = this.#profile.estimatedCostMicros;
    this.supportsSketch = this.#profile.edit !== undefined;
  }

  async generate(request: {
    readonly prompt: string;
    readonly signal: AbortSignal;
    readonly image?: { readonly bytes: Uint8Array; readonly contentType: string };
  }): Promise<GeneratedImage> {
    try {
      return await this.#run(request.prompt, request.signal, request.image);
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async #run(
    prompt: string,
    signal: AbortSignal,
    image?: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<GeneratedImage> {
    const edit = this.#profile.edit;
    if (image && !edit) {
      throw new AiProviderError('invalid_request', 'il modello non parte da un boceto');
    }
    const endpoint = image && edit ? edit.endpoint : this.#profile.endpoint;
    const body =
      image && edit
        ? edit.body(
            prompt,
            `data:${image.contentType};base64,${Buffer.from(image.bytes).toString('base64')}`,
          )
        : this.#profile.body(prompt);
    const response = await this.#fetch(`${this.#baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.#apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    const requestId = response.headers.get('x-fal-request-id');
    const where = `fal ${response.status}${requestId ? ` (richiesta ${requestId})` : ''}`;
    if (!response.ok) throw await httpError(response, where);

    let payload: unknown;
    try {
      payload = JSON.parse(
        new TextDecoder().decode(await readCapped(response, MAX_RESPONSE_BYTES)),
      );
    } catch (error) {
      if (error instanceof AiProviderError || isAbort(error)) throw error;
      throw new AiProviderError('provider_error', `${where}: risposta non in JSON`);
    }
    const url = imageUrlOf(payload, where);
    const bytes = url.startsWith('data:')
      ? decodeDataUri(url, where)
      : await downloadFalMedia(this.#fetch, url, signal);
    // Il tipo si decide dai byte, non da quanto dichiarato nella risposta.
    const contentType = sniffImageType(bytes);
    if (!contentType)
      throw new AiProviderError('provider_error', `${where}: il file non è un'immagine`);
    return { bytes, contentType, costMicros: this.estimatedCostMicros };
  }
}

// -----------------------------------------------------------------------------
// Stile della fioreria a parole (ADR-032): modello di visione via `any-llm/vision`
// -----------------------------------------------------------------------------

export interface FalStyleDescriberOptions {
  readonly apiKey: string;
  /** Modello di visione (provato il 21/11/2026: segue bene i divieti). */
  readonly model?: string;
  /** Solo per i test. */
  readonly baseUrl?: string;
  /** Solo per i test. */
  readonly fetch?: typeof fetch;
}

const MAX_VISION_RESPONSE_BYTES = 256 * 1024;

export class FalStyleDescriber implements StyleDescriber {
  readonly id = 'fal';
  readonly model: string;
  // Miniatura (~1.500 token) + ~150 token di risposta: ~0,006 USD, arrotondato per eccesso.
  readonly estimatedCostMicros = 10_000;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: FalStyleDescriberOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error('FAL_KEY mancante');
    this.#apiKey = apiKey;
    this.#baseUrl = (options.baseUrl ?? 'https://fal.run').replace(/\/+$/, '');
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.model = options.model ?? 'anthropic/claude-sonnet-4.5';
  }

  async describe(
    image: { readonly bytes: Uint8Array; readonly contentType: string },
    signal: AbortSignal,
  ): Promise<StyleDescription> {
    try {
      const dataUri = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString('base64')}`;
      const response = await this.#fetch(`${this.#baseUrl}/fal-ai/any-llm/vision`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${this.#apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: STYLE_DESCRIBER_PROMPT,
          image_urls: [dataUri],
        }),
        signal,
      });
      const requestId = response.headers.get('x-fal-request-id');
      const where = `fal vision ${response.status}${requestId ? ` (richiesta ${requestId})` : ''}`;
      if (!response.ok) throw await httpError(response, where);
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder().decode(await readCapped(response, MAX_VISION_RESPONSE_BYTES)),
        );
      } catch (error) {
        if (error instanceof AiProviderError || isAbort(error)) throw error;
        throw new AiProviderError('provider_error', `${where}: risposta non in JSON`);
      }
      const output = (payload as { output?: unknown } | null)?.output;
      return parseStyleDescription(typeof output === 'string' ? output : '', where);
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

// -----------------------------------------------------------------------------
// Controllo dei conteggi dell'anteprima esatta (ADR-034)
// -----------------------------------------------------------------------------

export interface FalFlowerCounterOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** Solo per i test. */
  readonly baseUrl?: string;
  /** Solo per i test. */
  readonly fetch?: typeof fetch;
}

export class FalFlowerCounter implements FlowerCounter {
  readonly id = 'fal';
  readonly simulated = false;
  readonly model: string;
  // Immagine 1K (~1.500 token) + elenco dei fiori (~400 token): ~0,01 USD, per eccesso.
  readonly estimatedCostMicros = 12_000;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: FalFlowerCounterOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error('FAL_KEY mancante');
    this.#apiKey = apiKey;
    this.#baseUrl = (options.baseUrl ?? 'https://fal.run').replace(/\/+$/, '');
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.model = options.model ?? 'anthropic/claude-sonnet-4.5';
  }

  async count(
    image: { readonly bytes: Uint8Array; readonly contentType: string },
    targets: readonly CountTarget[],
    signal: AbortSignal,
  ): Promise<CountCheckResult> {
    try {
      const dataUri = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString('base64')}`;
      const response = await this.#fetch(`${this.#baseUrl}/fal-ai/any-llm/vision`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${this.#apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: buildCountCheckPrompt(targets),
          image_urls: [dataUri],
        }),
        signal,
      });
      const requestId = response.headers.get('x-fal-request-id');
      const where = `fal conteggio ${response.status}${requestId ? ` (richiesta ${requestId})` : ''}`;
      if (!response.ok) throw await httpError(response, where);
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder().decode(await readCapped(response, MAX_VISION_RESPONSE_BYTES)),
        );
      } catch (error) {
        if (error instanceof AiProviderError || isAbort(error)) throw error;
        throw new AiProviderError('provider_error', `${where}: risposta non in JSON`);
      }
      const output = (payload as { output?: unknown } | null)?.output;
      const result = parseCountCheck(typeof output === 'string' ? output : '', targets);
      if (!result) throw new AiProviderError('provider_error', `${where}: conteggio illeggibile`);
      return result;
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

export interface FalBoxCounterOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** Solo per i test. */
  readonly baseUrl?: string;
  /** Solo per i test. */
  readonly fetch?: typeof fetch;
}

/**
 * Seconda opinione sui conteggi: Gemini 2.5 Pro individua ogni fiore con un riquadro (serve il
 * ragionamento attivo). Più lento (20–40 s) ma preciso sui ramos fitti; si usa solo quando il
 * primo conteggio non coincide (prova del 21/11/2026, ADR-034).
 */
export class FalBoxCounter implements FlowerCounter {
  readonly id = 'fal';
  readonly simulated = false;
  readonly model: string;
  // Immagine + ragionamento (qualche migliaio di token in uscita): ~0,03 USD, per eccesso.
  readonly estimatedCostMicros = 40_000;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: FalBoxCounterOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error('FAL_KEY mancante');
    this.#apiKey = apiKey;
    this.#baseUrl = (options.baseUrl ?? 'https://fal.run').replace(/\/+$/, '');
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.model = options.model ?? 'google/gemini-2.5-pro';
  }

  async count(
    image: { readonly bytes: Uint8Array; readonly contentType: string },
    targets: readonly CountTarget[],
    signal: AbortSignal,
  ): Promise<CountCheckResult> {
    try {
      const dataUri = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString('base64')}`;
      const response = await this.#fetch(`${this.#baseUrl}/fal-ai/any-llm/vision`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${this.#apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt: buildBoxCountPrompt(targets),
          image_urls: [dataUri],
          reasoning: true,
        }),
        signal,
      });
      const requestId = response.headers.get('x-fal-request-id');
      const where = `fal riquadri ${response.status}${requestId ? ` (richiesta ${requestId})` : ''}`;
      if (!response.ok) throw await httpError(response, where);
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder().decode(await readCapped(response, MAX_VISION_RESPONSE_BYTES)),
        );
      } catch (error) {
        if (error instanceof AiProviderError || isAbort(error)) throw error;
        throw new AiProviderError('provider_error', `${where}: risposta non in JSON`);
      }
      const output = (payload as { output?: unknown } | null)?.output;
      const result = parseBoxCount(typeof output === 'string' ? output : '', targets);
      if (!result) throw new AiProviderError('provider_error', `${where}: conteggio illeggibile`);
      return result;
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

/** `{"en": "...", "es": "..."}`, anche se il modello lo racchiude in un blocco di codice. */
export function parseStyleDescription(output: string, where = 'fal vision'): StyleDescription {
  const text = output
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiProviderError('provider_error', `${where}: descrizione non in JSON`);
  }
  const en = (parsed as { en?: unknown } | null)?.en;
  const es = (parsed as { es?: unknown } | null)?.es;
  if (typeof en !== 'string' || typeof es !== 'string' || !en.trim() || !es.trim()) {
    throw new AiProviderError('provider_error', `${where}: descrizione incompleta`);
  }
  return { en: en.trim(), es: es.trim() };
}

/** Solo se il modello ignorasse `sync_mode`: URL del CDN di fal, mai host arbitrari. */
async function downloadFalMedia(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new AiProviderError('provider_error', 'URL dell’immagine non valido');
  }
  if (target.protocol !== 'https:' || !FAL_MEDIA_HOST.test(target.hostname)) {
    throw new AiProviderError(
      'provider_error',
      `host dell’immagine non ammesso: ${target.hostname}`,
    );
  }
  const response = await fetchImpl(target, { signal, redirect: 'error' });
  if (!response.ok) {
    throw new AiProviderError('provider_error', `download dell’immagine: ${response.status}`);
  }
  return readCapped(response, MAX_IMAGE_BYTES);
}

// -----------------------------------------------------------------------------
// Scontorno delle foto del catalogo (ADR-033): BiRefNet via fal
// -----------------------------------------------------------------------------

export interface FalBackgroundRemoverOptions {
  readonly apiKey: string;
  /** Solo per i test. */
  readonly baseUrl?: string;
  /** Solo per i test. */
  readonly fetch?: typeof fetch;
}

export class FalBackgroundRemover implements BackgroundRemover {
  readonly id = 'fal';
  /** Scelto il 21/11/2026: qualità pari a Bria RMBG 2.0 a circa un decimo del costo. */
  readonly model = 'fal-ai/birefnet/v2';
  // Si paga a secondi di calcolo (~1–2 s per foto): stima prudente 0,002 USD.
  readonly estimatedCostMicros = 2_000;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: FalBackgroundRemoverOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error('FAL_KEY mancante');
    this.#apiKey = apiKey;
    this.#baseUrl = (options.baseUrl ?? 'https://fal.run').replace(/\/+$/, '');
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async remove(
    image: { readonly bytes: Uint8Array; readonly contentType: string },
    signal: AbortSignal,
  ): Promise<{ png: Uint8Array; costMicros: number | null }> {
    try {
      const dataUri = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString('base64')}`;
      const response = await this.#fetch(`${this.#baseUrl}/${this.model}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${this.#apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          image_url: dataUri,
          model: 'General Use (Heavy)',
          operating_resolution: '1024x1024',
          output_format: 'png',
          sync_mode: true,
        }),
        signal,
      });
      const requestId = response.headers.get('x-fal-request-id');
      const where = `fal birefnet ${response.status}${requestId ? ` (richiesta ${requestId})` : ''}`;
      if (!response.ok) throw await httpError(response, where);
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder().decode(await readCapped(response, MAX_RESPONSE_BYTES)),
        );
      } catch (error) {
        if (error instanceof AiProviderError || isAbort(error)) throw error;
        throw new AiProviderError('provider_error', `${where}: risposta non in JSON`);
      }
      const url = (payload as { image?: { url?: unknown } } | null)?.image?.url;
      if (typeof url !== 'string' || url.length === 0) {
        throw new AiProviderError('provider_error', `${where}: nessuna immagine nella risposta`);
      }
      const png = url.startsWith('data:')
        ? decodeDataUri(url, where)
        : await downloadFalMedia(this.#fetch, url, signal);
      if (sniffImageType(png) !== 'image/png') {
        throw new AiProviderError('provider_error', `${where}: il ritaglio non è un PNG`);
      }
      return { png, costMicros: this.estimatedCostMicros };
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function toProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (isAbort(error)) return new AiProviderError('timeout', 'fal: tempo scaduto');
  // Errori di rete di fetch ("fetch failed"…): mai header o corpo nella descrizione.
  const reason = error instanceof Error ? error.message.slice(0, 120) : 'errore sconosciuto';
  return new AiProviderError('provider_error', `fal: errore di rete (${reason})`);
}

/** Legge il corpo fermandosi oltre `maxBytes` (anche senza Content-Length). */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AiProviderError('provider_error', 'risposta troppo grande');
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AiProviderError('provider_error', 'risposta troppo grande');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Errore HTTP di fal: `{"detail": [{"type", "msg", …}]}` oppure `{"detail": "…"}`. */
async function httpError(response: Response, where: string): Promise<AiProviderError> {
  let types: string[] = [];
  let message = '';
  try {
    const body = JSON.parse(new TextDecoder().decode(await readCapped(response, MAX_ERROR_BYTES)));
    const detail: unknown = body?.detail;
    if (typeof detail === 'string') {
      message = detail;
    } else if (Array.isArray(detail)) {
      types = detail.map((entry) => String(entry?.type ?? ''));
      message = detail.map((entry) => String(entry?.msg ?? '')).join('; ');
    }
  } catch {
    // corpo assente o non JSON: basta lo stato HTTP
  }
  const text = `${where}${message ? `: ${message.slice(0, 200)}` : ''}`;
  if (types.some((type) => type.includes('content_policy'))) {
    return new AiProviderError('content_rejected', text);
  }
  const status = response.status;
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return new AiProviderError('provider_error', text);
  }
  return new AiProviderError('invalid_request', text);
}

/** Prima immagine della risposta; filtri di sicurezza del modello → contenuto rifiutato. */
function imageUrlOf(payload: unknown, where: string): string {
  const body = (payload ?? {}) as { images?: unknown; has_nsfw_concepts?: unknown };
  if (
    Array.isArray(body.has_nsfw_concepts) &&
    body.has_nsfw_concepts.some((flag) => flag === true)
  ) {
    throw new AiProviderError(
      'content_rejected',
      `${where}: immagine bloccata dal filtro del modello`,
    );
  }
  const first: unknown = Array.isArray(body.images) ? body.images[0] : undefined;
  const url = (first as { url?: unknown } | undefined)?.url;
  if (typeof url !== 'string' || url.length === 0) {
    // Il modello ha risposto senza immagine (tipicamente un rifiuto di sicurezza).
    throw new AiProviderError('content_rejected', `${where}: nessuna immagine nella risposta`);
  }
  return url;
}

function decodeDataUri(uri: string, where: string): Uint8Array {
  const prefix = DATA_URI_PREFIX.exec(uri);
  if (!prefix)
    throw new AiProviderError('provider_error', `${where}: formato dell’immagine non supportato`);
  const base64 = uri.slice(prefix[0].length);
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    throw new AiProviderError('provider_error', `${where}: immagine troppo grande`);
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}
