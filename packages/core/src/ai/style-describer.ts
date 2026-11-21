/**
 * Stile della fioreria descritto a parole (ADR-032).
 *
 * Un modello di visione guarda UNA volta una foto di "Mis ramos" e ne descrive solo ambiente,
 * luce, inquadratura e tecnica di incarto (inglese per il prompt, spagnolo per il fiorista).
 * Il modello delle immagini riceve solo quel testo, mai la foto: passando la foto copiava
 * oggetti (un vaso di vetro) e sbagliava di più i conteggi (prova del 21/11/2026, ADR-031).
 */
import { FalStyleDescriber } from './fal';
import type { StyleDescriber, StyleDescription } from './style-types';
import { isLocalAppUrl } from './storage';

export { STYLE_DESCRIBER_PROMPT, type StyleDescriber, type StyleDescription } from './style-types';

/** Solo sviluppo/test: descrizione fissa, dichiarata come simulazione. */
export class SimulatedStyleDescriber implements StyleDescriber {
  readonly id = 'simulated';
  readonly model = 'simulated-style-v1';
  readonly estimatedCostMicros = 0;

  async describe(): Promise<StyleDescription> {
    return {
      en: 'Rustic wooden counter in a bright shop, soft window light from the left, loose hand-tied shape.',
      es: 'Simulación: mostrador de madera, luz suave de ventana, ramo suelto atado a mano.',
    };
  }
}

/** Stesso provider delle anteprime: fal.ai in produzione, simulato solo in locale. */
export function createStyleDescriberFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StyleDescriber | null {
  const provider = env.AI_PROVIDER ?? 'none';
  if (provider === 'fal') {
    const apiKey = env.FAL_KEY?.trim() ?? '';
    return apiKey ? new FalStyleDescriber({ apiKey }) : null;
  }
  if (provider === 'simulated' && isLocalAppUrl(env.APP_URL)) return new SimulatedStyleDescriber();
  return null;
}

let describer: StyleDescriber | null | undefined;

export function getStyleDescriber(): StyleDescriber | null {
  if (describer === undefined) describer = createStyleDescriberFromEnv();
  return describer;
}

/** Solo per i test: sostituisce il descrittore del processo. */
export function setStyleDescriber(next: StyleDescriber | null | undefined): void {
  describer = next;
}
