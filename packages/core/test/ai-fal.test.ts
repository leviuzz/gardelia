import { describe, expect, it } from 'vitest';
import {
  AiProviderError,
  FalBackgroundRemover,
  FalBoxCounter,
  FalFlowerCounter,
  FalImageProvider,
  FalStyleDescriber,
  SimulatedFlowerCounter,
  TwoStepFlowerCounter,
  createAiProviderFromEnv,
  createFlowerCounterFromEnv,
  createStyleDescriberFromEnv,
  type AiProviderErrorCode,
} from '../src/index';
import { parseStyleDescription } from '../src/ai/fal';
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

describe('FalStyleDescriber (stile a parole, ADR-032)', () => {
  const image = { bytes: JPEG, contentType: 'image/jpeg' };

  it('manda la miniatura al modello di visione e legge {en, es}', async () => {
    const fal = fakeFal(
      json({
        output:
          '```json\n{"en": "Rustic wooden counter, warm window light.", "es": "Mostrador rústico, luz cálida."}\n```',
      }),
    );
    const describer = new FalStyleDescriber({ apiKey: SECRET, fetch: fal.fetchImpl });
    const result = await describer.describe(image, AbortSignal.timeout(5_000));
    expect(result).toEqual({
      en: 'Rustic wooden counter, warm window light.',
      es: 'Mostrador rústico, luz cálida.',
    });
    const call = fal.calls[0]!;
    expect(call.url).toBe('https://fal.run/fal-ai/any-llm/vision');
    expect(new Headers(call.init?.headers).get('authorization')).toBe(`Key ${SECRET}`);
    const body = JSON.parse(String(call.init?.body));
    expect(body.model).toBe('anthropic/claude-sonnet-4.5');
    expect(body.prompt).toContain('Do NOT mention');
    expect(body.image_urls[0]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('risposte incomplete o errori del provider diventano errori tipizzati', async () => {
    expect(() => parseStyleDescription('non è JSON')).toThrow(AiProviderError);
    expect(() => parseStyleDescription('{"en": "solo inglese"}')).toThrow(/incompleta/);
    const unauthorized = new FalStyleDescriber({
      apiKey: SECRET,
      fetch: fakeFal(new Response('no', { status: 401 })).fetchImpl,
    });
    const error = await unauthorized.describe(image, AbortSignal.timeout(5_000)).catch((e) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).code).toBe('invalid_request');
    expect((error as AiProviderError).message).not.toContain(SECRET);
  });

  it('si configura con lo stesso provider delle anteprime', () => {
    expect(
      createStyleDescriberFromEnv({
        APP_URL: 'https://x.example',
        AI_PROVIDER: 'fal',
        FAL_KEY: SECRET,
      }),
    ).toBeInstanceOf(FalStyleDescriber);
    // Configurazione non valida (simulato con un URL pubblico): l'app non parte.
    expect(() =>
      createStyleDescriberFromEnv({ APP_URL: 'https://x.example', AI_PROVIDER: 'simulated' }),
    ).toThrow(/solo in locale/);
    expect(createStyleDescriberFromEnv({ AI_PROVIDER: 'none' })).toBeNull();
  });
});

describe('FalBackgroundRemover (scontorno, ADR-033)', () => {
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const image = { bytes: JPEG, contentType: 'image/jpeg' };

  it('manda la foto a BiRefNet e restituisce il PNG trasparente', async () => {
    const fal = fakeFal(json({ image: { url: dataUri(PNG_BYTES, 'image/png') }, mask_image: {} }));
    const remover = new FalBackgroundRemover({ apiKey: SECRET, fetch: fal.fetchImpl });
    const result = await remover.remove(image, AbortSignal.timeout(5_000));
    expect([...result.png]).toEqual([...PNG_BYTES]);
    expect(result.costMicros).toBe(remover.estimatedCostMicros);
    const call = fal.calls[0]!;
    expect(call.url).toBe('https://fal.run/fal-ai/birefnet/v2');
    const body = JSON.parse(String(call.init?.body));
    expect(body).toMatchObject({ output_format: 'png', sync_mode: true });
    expect(body.image_url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('rifiuta risposte senza PNG e mappa gli errori del servizio', async () => {
    const notPng = new FalBackgroundRemover({
      apiKey: SECRET,
      fetch: fakeFal(json({ image: { url: dataUri(JPEG) } })).fetchImpl,
    });
    const error = await notPng.remove(image, AbortSignal.timeout(5_000)).catch((e) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).code).toBe('provider_error');

    const invalid = new FalBackgroundRemover({
      apiKey: SECRET,
      fetch: fakeFal(json({ detail: [{ type: 'value_error', msg: 'bad image' }] }, 422)).fetchImpl,
    });
    const rejected = await invalid.remove(image, AbortSignal.timeout(5_000)).catch((e) => e);
    expect((rejected as AiProviderError).code).toBe('invalid_request');
    expect((rejected as AiProviderError).message).not.toContain(SECRET);
  });
});

describe('anteprima esatta con fal (ADR-034)', () => {
  it('con le foto dei fiori chiama la variante "edit", tutte nell’ordine; GPT Image 2 no', async () => {
    const { calls, fetchImpl } = fakeFal(json({ images: [{ url: dataUri(JPEG) }] }));
    const nano = provider(fetchImpl);
    expect(nano.acceptsImages).toBe(true);
    const image = await nano.generate({
      prompt: 'The reference images show the flowers to use',
      signal: AbortSignal.timeout(5_000),
      images: [
        { bytes: PNG, contentType: 'image/png' },
        { bytes: JPEG, contentType: 'image/jpeg' },
      ],
    });
    expect(image.contentType).toBe('image/jpeg');
    expect(calls[0]?.url).toBe('https://fal.run/fal-ai/nano-banana-2/edit');
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      prompt: 'The reference images show the flowers to use',
      image_urls: [dataUri(PNG, 'image/png'), dataUri(JPEG, 'image/jpeg')],
      num_images: 1,
      aspect_ratio: '1:1',
      sync_mode: true,
    });

    const gpt = provider(fakeFal().fetchImpl, 'gpt-image-2');
    expect(gpt.acceptsImages).toBe(false);
    const error = await gpt
      .generate({
        prompt: 'x',
        signal: AbortSignal.timeout(5_000),
        images: [{ bytes: PNG, contentType: 'image/png' }],
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid_request' });
  });

  const targets = [
    { index: 1, catalogItemId: 'a', description: 'red roses ("Rosa roja")', expected: 3 },
    { index: 2, catalogItemId: 'b', description: 'white daisies ("Margarita")', expected: 2 },
  ];

  it('il contatore manda i tipi (mai le quantità) e conta l’elenco restituito', async () => {
    const output =
      '```json\n{"blooms":[{"type":1},{"type":1},{"type":1},{"type":2},{"type":2},{"type":0}]}\n```';
    const { calls, fetchImpl } = fakeFal(json({ output }));
    const counter = new FalFlowerCounter({ apiKey: SECRET, fetch: fetchImpl });
    const result = await counter.count(
      { bytes: JPEG, contentType: 'image/jpeg' },
      targets,
      AbortSignal.timeout(5_000),
    );
    expect(result).toEqual({ counts: { 1: 3, 2: 2 }, other: 1 });
    expect(calls[0]?.url).toBe('https://fal.run/fal-ai/any-llm/vision');
    const body = JSON.parse(String(calls[0]?.init?.body)) as { prompt: string; model: string };
    expect(body.model).toBe('anthropic/claude-sonnet-4.5');
    expect(body.prompt).toContain('1 = red roses ("Rosa roja")');
    expect(body.prompt).not.toMatch(/\bexactly\b|3 red/);
    expect(JSON.stringify(calls[0]?.init?.headers)).toContain(SECRET);
  });

  it('risposta illeggibile o errore del servizio: errore del provider, mai un conteggio inventato', async () => {
    const unreadable = new FalFlowerCounter({
      apiKey: SECRET,
      fetch: fakeFal(json({ output: 'Ci sono tre rose.' })).fetchImpl,
    });
    await expect(
      unreadable.count(
        { bytes: JPEG, contentType: 'image/jpeg' },
        targets,
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toMatchObject({ code: 'provider_error' });
    const down = new FalFlowerCounter({
      apiKey: SECRET,
      fetch: fakeFal(json({ detail: 'overloaded' }, 503)).fetchImpl,
    });
    const error = await down
      .count({ bytes: JPEG, contentType: 'image/jpeg' }, targets, AbortSignal.timeout(5_000))
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'provider_error' });
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it('contatore dall’ambiente: fal con chiave, simulato solo in locale', () => {
    const fromEnv = createFlowerCounterFromEnv({ AI_PROVIDER: 'fal', FAL_KEY: 'k' });
    expect(fromEnv).toBeInstanceOf(TwoStepFlowerCounter);
    expect(fromEnv?.model).toBe('anthropic/claude-sonnet-4.5+google/gemini-2.5-pro');
    expect(() => createFlowerCounterFromEnv({ AI_PROVIDER: 'fal', FAL_KEY: '' })).toThrow(
      /FAL_KEY/,
    );
    expect(
      createFlowerCounterFromEnv({ AI_PROVIDER: 'simulated', APP_URL: 'http://localhost:3000' }),
    ).toBeInstanceOf(SimulatedFlowerCounter);
    expect(() =>
      createFlowerCounterFromEnv({ AI_PROVIDER: 'simulated', APP_URL: 'https://floral.example' }),
    ).toThrow(/solo in locale/);
    expect(createFlowerCounterFromEnv({ AI_PROVIDER: 'none' })).toBeNull();
  });
});

describe('seconda opinione sui conteggi (ADR-034)', () => {
  const targets = [
    { index: 1, catalogItemId: 'a', description: 'red roses ("Rosa roja")', expected: 12 },
  ];
  const image = { bytes: JPEG, contentType: 'image/jpeg' };

  it('Gemini Pro con i riquadri: ragionamento attivo, doppioni scartati', async () => {
    const boxes = Array.from(
      { length: 12 },
      (_, i) => `{"type": 1, "box": [${i * 50}, 10, ${i * 50 + 40}, 60]}`,
    );
    // Un doppione (stesso fiore due volte) che non va contato.
    boxes.push('{"type": 1, "box": [1, 11, 41, 61]}');
    const { calls, fetchImpl } = fakeFal(json({ output: `{"blooms": [${boxes.join(',')}]}` }));
    const counter = new FalBoxCounter({ apiKey: SECRET, fetch: fetchImpl });
    expect(await counter.count(image, targets, AbortSignal.timeout(5_000))).toEqual({
      counts: { 1: 12 },
      other: 0,
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'google/gemini-2.5-pro', reasoning: true });
    expect(String(body.prompt)).toContain('bounding box');
  });

  class Scripted {
    readonly id = 'stub';
    readonly simulated = false;
    calls = 0;
    constructor(
      readonly model: string,
      readonly estimatedCostMicros: number,
      private readonly answer: number,
    ) {}
    async count() {
      this.calls += 1;
      return { counts: { 1: this.answer }, other: 0 };
    }
  }

  it('il secondo modello decide solo se il primo non ritrova i numeri', async () => {
    const fast = new Scripted('fast', 10_000, 12);
    const slow = new Scripted('slow', 40_000, 12);
    const agreed = await new TwoStepFlowerCounter(fast, slow).count(
      image,
      targets,
      AbortSignal.timeout(5_000),
    );
    expect(agreed).toMatchObject({ counts: { 1: 12 }, decidedBy: 'first', costMicros: 10_000 });
    expect(slow.calls).toBe(0);

    const wrongFirst = new Scripted('fast', 10_000, 13);
    const rescued = await new TwoStepFlowerCounter(wrongFirst, slow).count(
      image,
      targets,
      AbortSignal.timeout(5_000),
    );
    expect(rescued).toMatchObject({ counts: { 1: 12 }, decidedBy: 'second', costMicros: 50_000 });

    const bothWrong = await new TwoStepFlowerCounter(
      new Scripted('fast', 10_000, 13),
      new Scripted('slow', 40_000, 11),
    ).count(image, targets, AbortSignal.timeout(5_000));
    expect(bothWrong).toMatchObject({ counts: { 1: 11 }, decidedBy: 'second' });
  });
});
