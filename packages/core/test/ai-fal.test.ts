import { describe, expect, it } from 'vitest';
import {
  AiProviderError,
  FalImageProvider,
  createAiProviderFromEnv,
  type AiProviderErrorCode,
} from '../src/index';
import { sniffImageType } from '../src/ai/providers';

// Test unitari: nessuna chiamata di rete, `fetch` sostituito. Il contratto di fal (forma delle
// risposte e degli errori) è quello osservato nelle chiamate reali del 21/11/2026.

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const SECRET = 'fal-test-key-123';

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function dataUri(bytes: Uint8Array, type = 'image/jpeg'): string {
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fakeFal(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error('nessuna risposta preparata');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function provider(fetchImpl: typeof fetch, model?: 'nano-banana-2' | 'gpt-image-2') {
  return new FalImageProvider({ apiKey: SECRET, fetch: fetchImpl, ...(model ? { model } : {}) });
}

async function generate(p: FalImageProvider) {
  return p.generate({ prompt: 'bouquet prompt', signal: AbortSignal.timeout(5_000) });
}

async function expectCode(
  p: FalImageProvider,
  code: AiProviderErrorCode,
): Promise<AiProviderError> {
  const error = await generate(p).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AiProviderError);
  expect((error as AiProviderError).code).toBe(code);
  expect((error as AiProviderError).message).not.toContain(SECRET);
  return error as AiProviderError;
}

describe('FalImageProvider', () => {
  it('chiama il modello predefinito con la chiave e restituisce i byte dell’immagine', async () => {
    const fal = fakeFal(
      json({ images: [{ url: dataUri(JPEG), content_type: 'image/jpeg', width: 1024 }] }, 200, {
        'x-fal-request-id': 'req-1',
      }),
    );
    const p = provider(fal.fetchImpl);
    expect(p).toMatchObject({ id: 'fal', model: 'fal-ai/nano-banana-2', simulated: false });

    const image = await generate(p);
    expect(image.contentType).toBe('image/jpeg');
    expect([...image.bytes]).toEqual([...JPEG]);
    expect(image.costMicros).toBe(p.estimatedCostMicros);

    expect(fal.calls).toHaveLength(1);
    const call = fal.calls[0]!;
    expect(call.url).toBe('https://fal.run/fal-ai/nano-banana-2');
    expect(call.init?.method).toBe('POST');
    expect(new Headers(call.init?.headers).get('authorization')).toBe(`Key ${SECRET}`);
    expect(JSON.parse(String(call.init?.body))).toEqual({
      prompt: 'bouquet prompt',
      num_images: 1,
      aspect_ratio: '1:1',
      resolution: '1K',
      output_format: 'jpeg',
      sync_mode: true,
    });
  });

  it('GPT Image 2 usa i suoi parametri (quadrata, qualità media)', async () => {
    const fal = fakeFal(json({ images: [{ url: dataUri(JPEG) }] }));
    const p = provider(fal.fetchImpl, 'gpt-image-2');
    expect(p.model).toBe('fal-ai/gpt-image-2');
    await generate(p);
    expect(fal.calls[0]!.url).toBe('https://fal.run/fal-ai/gpt-image-2');
    expect(JSON.parse(String(fal.calls[0]!.init?.body))).toMatchObject({
      image_size: 'square_hd',
      quality: 'medium',
      sync_mode: true,
    });
  });

  it('il tipo si decide dai byte, non da quanto dichiara la risposta', async () => {
    const declaredJpeg = fakeFal(json({ images: [{ url: dataUri(PNG, 'image/jpeg') }] }));
    expect((await generate(provider(declaredJpeg.fetchImpl))).contentType).toBe('image/png');

    const notAnImage = fakeFal(
      json({ images: [{ url: dataUri(new TextEncoder().encode('<html>')) }] }),
    );
    await expectCode(provider(notAnImage.fetchImpl), 'provider_error');

    const svg = fakeFal(json({ images: [{ url: 'data:image/svg+xml;base64,PHN2Zz4=' }] }));
    await expectCode(provider(svg.fetchImpl), 'provider_error');
  });

  it('se arriva un URL, scarica solo in https dal CDN di fal', async () => {
    const cdn = fakeFal(
      json({ images: [{ url: 'https://v3.fal.media/files/abc/image.jpg' }] }),
      new Response(JPEG),
    );
    const image = await generate(provider(cdn.fetchImpl));
    expect(image.contentType).toBe('image/jpeg');
    expect(cdn.calls[1]!.url).toBe('https://v3.fal.media/files/abc/image.jpg');
    expect(cdn.calls[1]!.init?.redirect).toBe('error');

    for (const url of [
      'https://attacker.example/image.jpg',
      'https://fal.media.attacker.example/image.jpg',
      'http://v3.fal.media/files/abc/image.jpg',
      'file:///etc/passwd',
    ]) {
      const other = fakeFal(json({ images: [{ url }] }));
      await expectCode(provider(other.fetchImpl), 'provider_error');
      // Nessuna richiesta verso l'host non ammesso.
      expect(other.calls).toHaveLength(1);
    }
  });

  it('moderazione del modello → contenuto rifiutato, senza nuovi tentativi', async () => {
    const policy = fakeFal(
      json(
        {
          detail: [
            {
              loc: ['body', 'prompt'],
              msg: 'The content could not be processed because it contained material flagged by a content checker.',
              type: 'content_policy_violation',
            },
          ],
        },
        422,
      ),
    );
    await expectCode(provider(policy.fetchImpl), 'content_rejected');

    const nsfw = fakeFal(json({ images: [{ url: dataUri(JPEG) }], has_nsfw_concepts: [true] }));
    await expectCode(provider(nsfw.fetchImpl), 'content_rejected');

    const empty = fakeFal(json({ images: [], description: 'I cannot generate this image.' }));
    await expectCode(provider(empty.fetchImpl), 'content_rejected');
  });

  it('richiesta, chiave o saldo non validi (4xx) → invalid_request con il motivo di fal', async () => {
    const validation = fakeFal(
      json(
        {
          detail: [
            {
              type: 'literal_error',
              loc: ['body', 'resolution'],
              msg: "Input should be '0.5K', '1K', '2K' or '4K'",
            },
          ],
        },
        422,
        { 'x-fal-request-id': 'req-422' },
      ),
    );
    const error = await expectCode(provider(validation.fetchImpl), 'invalid_request');
    expect(error.message).toContain('fal 422 (richiesta req-422)');
    expect(error.message).toContain("Input should be '0.5K'");

    const locked = fakeFal(json({ detail: 'User is locked. Reason: Exhausted balance.' }, 403));
    expect((await expectCode(provider(locked.fetchImpl), 'invalid_request')).message).toContain(
      'Exhausted balance',
    );

    const unauthorized = fakeFal(new Response('Unauthorized', { status: 401 }));
    await expectCode(provider(unauthorized.fetchImpl), 'invalid_request');
  });

  it('errori temporanei (429, 5xx, rete, risposta illeggibile) → provider_error', async () => {
    for (const response of [
      json({ detail: 'Too many requests' }, 429),
      json({ detail: 'Internal server error' }, 500),
      new Response('bad gateway', { status: 502 }),
      new Response('not json', { status: 200 }),
      new TypeError('fetch failed'),
    ]) {
      await expectCode(provider(fakeFal(response).fetchImpl), 'provider_error');
    }
  });

  it('tempo scaduto o richiesta annullata → timeout', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const fal = fakeFal(new DOMException('aborted', name));
      await expectCode(provider(fal.fetchImpl), 'timeout');
    }
  });

  it('rifiuta immagini e risposte troppo grandi', async () => {
    const huge = 'A'.repeat(14 * 1024 * 1024);
    const bigImage = fakeFal(json({ images: [{ url: `data:image/jpeg;base64,${huge}` }] }));
    await expectCode(provider(bigImage.fetchImpl), 'provider_error');

    const declared = fakeFal(
      new Response('{}', { status: 200, headers: { 'content-length': String(64 * 1024 * 1024) } }),
    );
    await expectCode(provider(declared.fetchImpl), 'provider_error');
  });

  it('la chiave non compare nella serializzazione del provider', () => {
    const p = provider(fakeFal().fetchImpl);
    expect(JSON.stringify(p)).not.toContain(SECRET);
    expect(Object.values(p)).not.toContain(SECRET);
  });
});

describe('createAiProviderFromEnv con fal', () => {
  const base = { APP_URL: 'https://app.floral-os.example' };

  it('in produzione crea il provider reale col modello predefinito', () => {
    const p = createAiProviderFromEnv({ ...base, AI_PROVIDER: 'fal', FAL_KEY: SECRET });
    expect(p).toBeInstanceOf(FalImageProvider);
    expect(p).toMatchObject({ id: 'fal', model: 'fal-ai/nano-banana-2', simulated: false });
  });

  it('AI_MODEL sceglie fra i modelli provati', () => {
    const p = createAiProviderFromEnv({
      ...base,
      AI_PROVIDER: 'fal',
      FAL_KEY: SECRET,
      AI_MODEL: 'gpt-image-2',
    });
    expect(p?.model).toBe('fal-ai/gpt-image-2');
  });

  it('senza chiave o con un modello non provato l’app non parte', () => {
    expect(() => createAiProviderFromEnv({ ...base, AI_PROVIDER: 'fal' })).toThrow(/FAL_KEY/);
    expect(() => createAiProviderFromEnv({ ...base, AI_PROVIDER: 'fal', FAL_KEY: '  ' })).toThrow(
      /FAL_KEY/,
    );
    expect(() =>
      createAiProviderFromEnv({
        ...base,
        AI_PROVIDER: 'fal',
        FAL_KEY: SECRET,
        AI_MODEL: 'flux-2-pro',
      }),
    ).toThrow(/AI_MODEL non supportato/);
  });

  it('il provider simulato resta vietato con un APP_URL pubblico', () => {
    expect(() => createAiProviderFromEnv({ ...base, AI_PROVIDER: 'simulated' })).toThrow(
      /solo in locale/,
    );
    expect(createAiProviderFromEnv({ ...base, AI_PROVIDER: 'none' })).toBeNull();
  });
});

describe('sniffImageType', () => {
  it('riconosce PNG, JPEG e WebP dai primi byte', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});
