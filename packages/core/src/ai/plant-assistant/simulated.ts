/**
 * Asistente simulato (ADR-085): solo in locale e nei test (`ASSISTANT_PROVIDER=simulated`, rifiutato
 * con un APP_URL pubblico), etichettato «Simulación» nell'interfaccia. Risposte fisse, costo zero.
 */
import type {
  AssistantAnswerOutput,
  AssistantAnswerPromptInput,
  AssistantModel,
  AssistantRecognitionOutput,
} from '@floral/domain';
import type { AssistantCallResult, PlantAssistant, RecognitionRequest } from './types';

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

function done<T>(value: T): AssistantCallResult<T> {
  return {
    outcome: 'ok',
    value,
    usage: NO_USAGE,
    costMicros: 0,
    servedModel: 'simulated',
    stopReason: 'end_turn',
    errorCode: null,
    durationMs: 0,
  };
}

export class SimulatedPlantAssistant implements PlantAssistant {
  readonly id = 'simulated' as const;
  readonly simulated = true;
  readonly model: AssistantModel = 'claude-haiku-5-5';

  async recognize(
    request: RecognitionRequest,
  ): Promise<AssistantCallResult<AssistantRecognitionOutput>> {
    // La specie della scheda per prima, poi le prime della lista: sempre le stesse (test).
    const slugs = request.species.map((species) => species.slug).sort();
    const ordered = [
      ...(request.recordSlug && slugs.includes(request.recordSlug) ? [request.recordSlug] : []),
      ...slugs.filter((slug) => slug !== request.recordSlug),
    ].slice(0, 3);
    return done({
      photoUsable: true,
      candidates: ordered.map((slug, index) => ({
        slug,
        likelihood: index === 0 ? ('high' as const) : ('low' as const),
      })),
      notInList: false,
      condition: 'Simulación: hojas con puntas secas y algunas manchas amarillas.',
    });
  }

  async answer(
    request: AssistantAnswerPromptInput,
  ): Promise<AssistantCallResult<AssistantAnswerOutput>> {
    return done({
      answer: `Simulación (entorno de desarrollo): respuesta de prueba a «${request.question.slice(0, 80)}».`,
      steps: ['Revisa la humedad de la tierra con el dedo.', 'Aleja la maceta del sol directo.'],
      unsure: false,
      askFlorist: false,
    });
  }
}
