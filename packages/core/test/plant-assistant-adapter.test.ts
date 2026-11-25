import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { assistantConfig, ConfigurationError } from '../src/config';
import {
  ClaudePlantAssistant,
  SimulatedPlantAssistant,
  createPlantAssistantFromEnv,
} from '../src/index';

/**
 * Asistente de plantas (ADR-085): l'adattatore di Claude con un client finto. Forma della
 * richiesta (modello, effort basso, output strutturato, cache del sistema, fallback lato server),
 * costo dai token veri anche con il fallback, rifiuti ed errori senza il testo del fornitore.
 */

const species = [
  { slug: 'telefono', name: 'Teléfono', scientificName: 'Epipremnum aureum' },
  { slug: 'calathea', name: 'Calathea', scientificName: 'Goeppertia spp.' },
];
const image = { bytes: new Uint8Array([255, 216, 255, 224]), contentType: 'image/jpeg' as const };

function fakeClient(respond: () => unknown) {
  const parse = vi.fn(async (_params: unknown, _options?: unknown) => respond());
  const client = { beta: { messages: { parse } } } as unknown as Anthropic;
  return { client, parse };
}

const signal = () => new AbortController().signal;

describe('Asistente de plantas: adattatore di Claude', () => {
  it('riconoscimento: modello, effort basso, output strutturato, cache, fallback e foto', async () => {
    const { client, parse } = fakeClient(() => ({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      parsed_output: {
        photoUsable: true,
        candidates: [{ slug: 'telefono', likelihood: 'high' }],
        notInList: false,
        condition: 'Hojas amarillas.',
      },
      usage: {
        input_tokens: 1_000,
        output_tokens: 200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 500,
      },
    }));
    const assistant = new ClaudePlantAssistant('claude-opus-5-5', {
      apiKey: 'sk-test',
      timeoutMs: 1_000,
      client,
    });
    const result = await assistant.recognize(
      { image, species, locale: 'es-MX', recordSlug: 'telefono' },
      signal(),
    );
    expect(result.outcome).toBe('ok');
    expect(result.value?.candidates[0]?.slug).toBe('telefono');
    // 1.000 × 4 + 200 × 20 + 500 × 0,20 micro-USD.
    expect(result.costMicros).toBe(8_100);
    expect(result.servedModel).toBe('claude-opus-5-5');

    const params = parse.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.fallbacks).toBe('default');
    expect(params.output_config).toMatchObject({ effort: 'low' });
    expect((params.output_config as { format?: unknown }).format).toBeTruthy();
    expect(params).not.toHaveProperty('thinking');
    expect(params).not.toHaveProperty('temperature');
    const system = params.system as { text: string; cache_control?: unknown }[];
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0]?.text).toContain('calathea | Calathea | Goeppertia spp.');
    const content = (params.messages as { content: { type: string; source?: unknown }[] }[])[0]
      ?.content;
    expect(content?.[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg' },
    });
    expect(content?.[1]).toMatchObject({ type: 'text' });
  });

  it('con il fallback ogni passaggio si paga con il suo modello', async () => {
    const { client } = fakeClient(() => ({
      model: 'claude-opus-5',
      stop_reason: 'end_turn',
      parsed_output: { answer: 'Riega menos.', steps: [], unsure: false, askFlorist: false },
      usage: {
        input_tokens: 2_000,
        output_tokens: 210,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        iterations: [
          { type: 'message', model: 'claude-opus-5-5', input_tokens: 1_000, output_tokens: 10 },
          {
            type: 'fallback_message',
            model: 'claude-opus-5',
            input_tokens: 1_000,
            output_tokens: 200,
          },
        ],
      },
    }));
    const assistant = new ClaudePlantAssistant('claude-opus-5-5', {
      apiKey: 'sk-test',
      timeoutMs: 1_000,
      client,
    });
    const result = await assistant.answer(
      { locale: 'es-MX', species: null, plant: null, condition: '', previous: [], question: '¿?' },
      signal(),
    );
    expect(result.outcome).toBe('ok');
    expect(result.servedModel).toBe('claude-opus-5');
    expect(result.costMicros).toBe(1_000 * 4 + 10 * 20 + 1_000 * 5 + 200 * 25);
    expect(result.usage.inputTokens).toBe(2_000);
  });

  it('rifiuto, risposta tagliata o non valida: non riuscita, ma il costo resta', async () => {
    const usage = {
      input_tokens: 100,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    for (const [response, outcome, code] of [
      [{ stop_reason: 'refusal', parsed_output: null }, 'refused', 'refusal'],
      [{ stop_reason: 'max_tokens', parsed_output: null }, 'error', 'max_tokens'],
      [{ stop_reason: 'end_turn', parsed_output: null }, 'error', 'invalid_output'],
    ] as const) {
      const { client } = fakeClient(() => ({ model: 'claude-haiku-5-5', usage, ...response }));
      const assistant = new ClaudePlantAssistant('claude-haiku-5-5', {
        apiKey: 'sk-test',
        timeoutMs: 1_000,
        client,
      });
      const result = await assistant.recognize(
        { image, species, locale: 'es-MX', recordSlug: null },
        signal(),
      );
      expect(result.outcome).toBe(outcome);
      expect(result.errorCode).toBe(code);
      expect(result.value).toBeNull();
      expect(result.costMicros).toBe(Math.ceil((100 * 100_000 + 10 * 500_000) / 1_000_000));
    }
  });

  it('un errore dell’SDK diventa un codice breve, senza costo né testo del fornitore', async () => {
    for (const [error, code] of [
      [new Anthropic.APIConnectionTimeoutError(), 'timeout'],
      [new Error('detalles privados'), 'unexpected'],
    ] as const) {
      const assistant = new ClaudePlantAssistant('claude-sonnet-5-5', {
        apiKey: 'sk-test',
        timeoutMs: 1_000,
        client: fakeClient(() => {
          throw error;
        }).client,
      });
      const result = await assistant.recognize(
        { image, species, locale: 'es-MX', recordSlug: null },
        signal(),
      );
      expect(result).toMatchObject({ outcome: 'error', errorCode: code, costMicros: 0 });
    }
  });
});

describe('Asistente de plantas: configurazione', () => {
  const publicUrl = 'https://gardelia.example.test';

  it('anthropic con la chiave e il modello scelto; spento senza provider', () => {
    const assistant = createPlantAssistantFromEnv({
      APP_URL: publicUrl,
      ASSISTANT_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-test',
      ASSISTANT_MODEL: 'claude-sonnet-5-5',
    });
    expect(assistant).toBeInstanceOf(ClaudePlantAssistant);
    expect(assistant?.model).toBe('claude-sonnet-5-5');
    expect(createPlantAssistantFromEnv({ APP_URL: publicUrl })).toBeNull();
    expect(
      createPlantAssistantFromEnv({
        APP_URL: 'http://localhost:3000',
        ASSISTANT_PROVIDER: 'simulated',
      }),
    ).toBeInstanceOf(SimulatedPlantAssistant);
    // Opus 5.5 e 20 USD finché il founder non sceglie.
    const defaults = assistantConfig({ APP_URL: publicUrl });
    expect(defaults.ASSISTANT_MODEL).toBe('claude-opus-5-5');
    expect(defaults.ASSISTANT_MONTHLY_BUDGET_USD).toBe(20);
  });

  it('rifiuta il simulato in pubblico, anthropic senza chiave, un modello sconosciuto', () => {
    const invalid = [
      { APP_URL: publicUrl, ASSISTANT_PROVIDER: 'simulated' },
      { APP_URL: publicUrl, ASSISTANT_PROVIDER: 'anthropic' },
      { APP_URL: publicUrl, ASSISTANT_MODEL: 'gpt-5' },
      { APP_URL: publicUrl, ASSISTANT_MONTHLY_BUDGET_USD: '-1' },
    ];
    for (const env of invalid) {
      expect(() => assistantConfig(env), JSON.stringify(env)).toThrow(ConfigurationError);
    }
  });
});
