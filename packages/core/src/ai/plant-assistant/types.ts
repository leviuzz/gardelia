/**
 * Asistente de plantas (ADR-085): l'interfaccia dell'adattatore. Due chiamate: il riconoscimento
 * (foto → specie della lista e ciò che si vede) e la risposta (solo testo). Ogni esito porta i
 * token veri e il costo, anche quando non riesce: si paga lo stesso e va nel budget.
 */
import type {
  AssistantAnswerOutput,
  AssistantAnswerPromptInput,
  AssistantModel,
  AssistantRecognitionOutput,
  AssistantSpecies,
  AssistantUsage,
  SupportedLocale,
} from '@floral/domain';

export interface AssistantImage {
  readonly bytes: Uint8Array;
  readonly contentType: 'image/jpeg';
}

/** Esito di una chiamata: `refused` = il modello (e i fallback) ha rifiutato; `error` = altro. */
export interface AssistantCallResult<T> {
  readonly outcome: 'ok' | 'refused' | 'error';
  readonly value: T | null;
  readonly usage: AssistantUsage;
  readonly costMicros: number;
  /** Il modello che ha risposto davvero (diverso con il fallback); null se non si sa. */
  readonly servedModel: string | null;
  readonly stopReason: string | null;
  /** Codice breve, mai il testo dell'errore del fornitore (può contenere dati). */
  readonly errorCode: string | null;
  readonly durationMs: number;
}

export interface RecognitionRequest {
  readonly image: AssistantImage;
  readonly species: readonly AssistantSpecies[];
  readonly locale: SupportedLocale;
  readonly recordSlug: string | null;
}

export interface PlantAssistant {
  readonly id: 'anthropic' | 'simulated';
  readonly model: AssistantModel;
  /** true solo per l'assistente finto di sviluppo e test (etichettato nell'interfaccia). */
  readonly simulated: boolean;
  recognize(
    request: RecognitionRequest,
    signal: AbortSignal,
  ): Promise<AssistantCallResult<AssistantRecognitionOutput>>;
  answer(
    request: AssistantAnswerPromptInput,
    signal: AbortSignal,
  ): Promise<AssistantCallResult<AssistantAnswerOutput>>;
}
