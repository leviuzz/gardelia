/**
 * Asistente de plantas (ADR-085): l'adattatore del processo, dalla configurazione. Null = spento
 * (`ASSISTANT_PROVIDER=none`): l'interfaccia non mostra i link.
 */
import { ASSISTANT_LIMITS } from '@floral/domain';
import { assistantConfig, type EnvSource } from '../../config';
import { ClaudePlantAssistant } from './claude';
import { SimulatedPlantAssistant } from './simulated';
import type { PlantAssistant } from './types';

export type { AssistantCallResult, AssistantImage, PlantAssistant } from './types';
export { ClaudePlantAssistant } from './claude';
export { SimulatedPlantAssistant } from './simulated';

export function createPlantAssistantFromEnv(env?: EnvSource): PlantAssistant | null {
  const config = assistantConfig(env);
  if (config.ASSISTANT_PROVIDER === 'anthropic') {
    return new ClaudePlantAssistant(config.ASSISTANT_MODEL, {
      apiKey: config.ANTHROPIC_API_KEY ?? '',
      timeoutMs: ASSISTANT_LIMITS.timeoutMs,
    });
  }
  if (config.ASSISTANT_PROVIDER === 'simulated') return new SimulatedPlantAssistant();
  return null;
}

let assistant: PlantAssistant | null | undefined;

export function getPlantAssistant(): PlantAssistant | null {
  if (assistant === undefined) assistant = createPlantAssistantFromEnv();
  return assistant;
}

/** Solo per i test: sostituisce l'assistente del processo. */
export function setPlantAssistant(next: PlantAssistant | null | undefined): void {
  assistant = next;
}

/** Budget mensile delle consultas pagate da Gardelia, in micro-USD. */
export function assistantMonthlyBudgetMicros(env?: EnvSource): number {
  return Math.round(assistantConfig(env).ASSISTANT_MONTHLY_BUDGET_USD * 1_000_000);
}
