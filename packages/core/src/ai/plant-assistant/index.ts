/**
 * Asistente de plantas (ADR-085): gli adattatori del processo, dalla configurazione. Null = spento
 * (`ASSISTANT_PROVIDER=none`): l'interfaccia non mostra l'assistente.
 *
 * Mix dei modelli (founder, 25/11, dopo la prova): `main` riconosce la foto e risponde ai problemi,
 * `care` risponde alle domande di cura.
 */
import { ASSISTANT_LIMITS } from '@floral/domain';
import { assistantConfig, type EnvSource } from '../../config';
import { ClaudePlantAssistant } from './claude';
import { SimulatedPlantAssistant } from './simulated';
import type { PlantAssistant } from './types';

export type { AssistantCallResult, AssistantImage, PlantAssistant } from './types';
export { ClaudePlantAssistant } from './claude';
export { SimulatedPlantAssistant } from './simulated';

export interface PlantAssistants {
  /** Riconoscimento della foto e domande su un problema. */
  readonly main: PlantAssistant;
  /** Domande di cura (modello leggero). */
  readonly care: PlantAssistant;
}

export function createPlantAssistantsFromEnv(env?: EnvSource): PlantAssistants | null {
  const config = assistantConfig(env);
  if (config.ASSISTANT_PROVIDER === 'anthropic') {
    const options = {
      apiKey: config.ANTHROPIC_API_KEY ?? '',
      timeoutMs: ASSISTANT_LIMITS.timeoutMs,
    };
    return {
      main: new ClaudePlantAssistant(config.ASSISTANT_MODEL, options),
      care: new ClaudePlantAssistant(config.ASSISTANT_CARE_MODEL, options),
    };
  }
  if (config.ASSISTANT_PROVIDER === 'simulated') {
    const simulated = new SimulatedPlantAssistant();
    return { main: simulated, care: simulated };
  }
  return null;
}

let assistants: PlantAssistants | null | undefined;

export function getPlantAssistants(): PlantAssistants | null {
  if (assistants === undefined) assistants = createPlantAssistantsFromEnv();
  return assistants;
}

/** Solo per i test: un assistente per tutto, oppure la coppia; `undefined` rilegge la configurazione. */
export function setPlantAssistant(next: PlantAssistant | PlantAssistants | null | undefined): void {
  assistants = next && 'recognize' in next ? { main: next, care: next } : next;
}

/** Budget mensile di piattaforma dell'assistente, in micro-USD. */
export function assistantMonthlyBudgetMicros(env?: EnvSource): number {
  return Math.round(assistantConfig(env).ASSISTANT_MONTHLY_BUDGET_USD * 1_000_000);
}
