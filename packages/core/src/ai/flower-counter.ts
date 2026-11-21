/**
 * Contatore dei fiori dell'anteprima esatta (ADR-034): un modello di visione elenca i fiori
 * dell'immagine generata, per tipo; l'immagine si mostra solo se i numeri coincidono con la
 * distinta. Riceve i tipi ma non le quantità attese, per non esserne suggestionato.
 */
import { FalFlowerCounter } from './fal';
import type { FlowerCounter } from './flower-counter-types';
import { isLocalAppUrl } from './storage';

export type { FlowerCounter } from './flower-counter-types';

/**
 * Solo sviluppo/test: non guarda l'immagine e restituisce i numeri della distinta. Con il
 * provider simulato l'"immagine" è il boceto stesso, quindi esatta per costruzione; la UI
 * dichiara comunque tutto come simulazione.
 */
export class SimulatedFlowerCounter implements FlowerCounter {
  readonly id = 'simulated';
  readonly model = 'simulated-count-v1';
  readonly simulated = true;
  readonly estimatedCostMicros = 0;

  async count(
    _image: unknown,
    targets: readonly { readonly index: number; readonly expected: number | null }[],
  ) {
    const counts: Record<number, number> = {};
    for (const target of targets) counts[target.index] = target.expected ?? 0;
    return { counts, other: 0 };
  }
}

/** Stesso provider delle anteprime: fal.ai in produzione, simulato solo in locale. */
export function createFlowerCounterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FlowerCounter | null {
  const provider = env.AI_PROVIDER ?? 'none';
  if (provider === 'fal') {
    const apiKey = env.FAL_KEY?.trim() ?? '';
    return apiKey ? new FalFlowerCounter({ apiKey }) : null;
  }
  if (provider === 'simulated' && isLocalAppUrl(env.APP_URL)) return new SimulatedFlowerCounter();
  return null;
}

let counter: FlowerCounter | null | undefined;

export function getFlowerCounter(): FlowerCounter | null {
  if (counter === undefined) counter = createFlowerCounterFromEnv();
  return counter;
}

/** Solo per i test: sostituisce il contatore del processo. */
export function setFlowerCounter(next: FlowerCounter | null | undefined): void {
  counter = next;
}
