/**
 * L'Asistente de plantas con Claude (ADR-085), l'unico punto dell'app che usa `@anthropic-ai/sdk`.
 *
 *  - Output strutturato (`zodOutputFormat`): la risposta è sempre un oggetto valido o un errore.
 *  - Effort `low`: risposte brevi e poco "pensiero" (che si paga come uscita e non si spegne).
 *  - Il sistema (regole e lista delle specie) va in cache: è uguale a ogni chiamata.
 *  - Fallback lato server (`fallbacks: "default"`): se il modello rifiuta per una regola di
 *    sicurezza, la richiesta passa a un altro modello nella stessa chiamata; sui modelli che non lo
 *    prevedono resta com'è.
 *  - Il costo si calcola dai token veri di `usage` (anche dei passaggi del fallback).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  assistantAnswerOutputSchema,
  assistantAnswerPrompt,
  assistantAnswerSystem,
  assistantCallCostMicros,
  assistantRecognitionOutputSchema,
  assistantRecognitionPrompt,
  assistantRecognitionSystem,
  type AssistantAnswerOutput,
  type AssistantAnswerPromptInput,
  type AssistantModel,
  type AssistantRecognitionOutput,
  type AssistantUsage,
} from '@floral/domain';
import type { z } from 'zod';
import type {
  AssistantCallResult,
  AssistantImage,
  PlantAssistant,
  RecognitionRequest,
} from './types';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Spazio per un po' di pensiero e la risposta breve (il pensiero conta nel massimo). */
const MAX_TOKENS = 4_000;

const ZERO_USAGE: AssistantUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

interface RawUsage {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly iterations?:
    | readonly (RawUsage & {
        readonly type?: string;
        readonly model?: string | null;
      })[]
    | null;
}

function usageOf(raw: RawUsage | null | undefined): AssistantUsage {
  return {
    inputTokens: raw?.input_tokens ?? 0,
    outputTokens: raw?.output_tokens ?? 0,
    cacheCreationTokens: raw?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: raw?.cache_read_input_tokens ?? 0,
  };
}

/**
 * Costo dalla risposta: con il fallback ogni passaggio ha i suoi token e il suo modello; senza, i
 * token totali e il modello che ha risposto.
 */
export function costFromResponse(
  requested: AssistantModel,
  served: string | null,
  raw: RawUsage | null | undefined,
): { readonly usage: AssistantUsage; readonly costMicros: number } {
  const iterations = raw?.iterations ?? [];
  if (iterations.length > 0) {
    let cost = 0;
    const total = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    for (const iteration of iterations) {
      const usage = usageOf(iteration);
      cost += assistantCallCostMicros(iteration.model ?? requested, usage);
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
      total.cacheCreationTokens += usage.cacheCreationTokens;
      total.cacheReadTokens += usage.cacheReadTokens;
    }
    return { usage: total, costMicros: cost };
  }
  const usage = usageOf(raw);
  return { usage, costMicros: assistantCallCostMicros(served ?? requested, usage) };
}

/** Codice breve di un errore dell'SDK (mai il messaggio, che può riportare dati). */
export function errorCodeOf(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIUserAbortError) return 'timeout';
  if (error instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (error instanceof Anthropic.AuthenticationError) return 'auth';
  if (error instanceof Anthropic.PermissionDeniedError) return 'permission';
  if (error instanceof Anthropic.BadRequestError) return 'bad_request';
  if (error instanceof Anthropic.InternalServerError) return 'provider_error';
  if (error instanceof Anthropic.APIConnectionError) return 'connection';
  if (error instanceof Anthropic.APIError) return `http_${error.status ?? 'unknown'}`;
  return 'unexpected';
}

export class ClaudePlantAssistant implements PlantAssistant {
  readonly id = 'anthropic' as const;
  readonly simulated = false;
  readonly #client: Anthropic;

  constructor(
    readonly model: AssistantModel,
    options: { readonly apiKey: string; readonly timeoutMs: number; readonly client?: Anthropic },
  ) {
    this.#client =
      options.client ??
      new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: 1 });
  }

  recognize(
    request: RecognitionRequest,
    signal: AbortSignal,
  ): Promise<AssistantCallResult<AssistantRecognitionOutput>> {
    return this.#call(
      assistantRecognitionSystem(request.species),
      [
        imageBlock(request.image),
        {
          type: 'text',
          text: assistantRecognitionPrompt({
            locale: request.locale,
            recordSlug: request.recordSlug,
          }),
        },
      ],
      assistantRecognitionOutputSchema,
      signal,
    );
  }

  answer(
    request: AssistantAnswerPromptInput,
    signal: AbortSignal,
  ): Promise<AssistantCallResult<AssistantAnswerOutput>> {
    return this.#call(
      assistantAnswerSystem(),
      [{ type: 'text', text: assistantAnswerPrompt(request) }],
      assistantAnswerOutputSchema,
      signal,
    );
  }

  async #call<Schema extends z.ZodType>(
    system: string,
    content: Anthropic.Beta.Messages.BetaContentBlockParam[],
    schema: Schema,
    signal: AbortSignal,
  ): Promise<AssistantCallResult<z.infer<Schema>>> {
    const started = Date.now();
    try {
      const response = await this.#client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content }],
          output_config: { effort: 'low', format: zodOutputFormat(schema) },
        },
        { signal },
      );
      const servedModel = typeof response.model === 'string' ? response.model : null;
      const { usage, costMicros } = costFromResponse(
        this.model,
        servedModel,
        response.usage as RawUsage,
      );
      const base = {
        usage,
        costMicros,
        servedModel,
        stopReason: response.stop_reason ?? null,
        durationMs: Date.now() - started,
      };
      if (response.stop_reason === 'refusal') {
        return { ...base, outcome: 'refused', value: null, errorCode: 'refusal' };
      }
      if (response.stop_reason === 'max_tokens') {
        return { ...base, outcome: 'error', value: null, errorCode: 'max_tokens' };
      }
      const parsed = response.parsed_output as z.infer<Schema> | null;
      if (parsed === null || parsed === undefined) {
        return { ...base, outcome: 'error', value: null, errorCode: 'invalid_output' };
      }
      return { ...base, outcome: 'ok', value: parsed, errorCode: null };
    } catch (error) {
      return {
        outcome: 'error',
        value: null,
        usage: ZERO_USAGE,
        costMicros: 0,
        servedModel: null,
        stopReason: null,
        errorCode: errorCodeOf(error),
        durationMs: Date.now() - started,
      };
    }
  }
}

function imageBlock(image: AssistantImage): Anthropic.Beta.Messages.BetaImageBlockParam {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.contentType,
      data: Buffer.from(image.bytes).toString('base64'),
    },
  };
}
