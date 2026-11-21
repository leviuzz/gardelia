/**
 * Contatore dei fiori dell'anteprima esatta (ADR-034): un modello di visione elenca i fiori
 * dell'immagine generata, per tipo; l'immagine si mostra solo se i numeri coincidono con la
 * distinta. Riceve i tipi ma non le quantità attese, per non esserne suggestionato.
 */
import { countsMatch, type CountTarget } from '@floral/domain';
import { FalBoxCounter, FalFlowerCounter } from './fal';
import type { CountOutcome, FlowerCounter } from './flower-counter-types';
import { isLocalAppUrl } from './storage';

export type { CountOutcome, FlowerCounter } from './flower-counter-types';

const SECOND_OPINION_TIMEOUT_MS = 90_000;

/**
 * Controllo in due passi: il primo contatore (veloce) decide quando ritrova i numeri della
 * distinta; se no, decide la seconda opinione (più lenta, più precisa sui ramos fitti). Così una
 * foto giusta non si scarta per un errore di conteggio del primo modello. Nessuno dei due
 * modelli riceve le quantità attese: il confronto lo fa il server.
 */
export class TwoStepFlowerCounter implements FlowerCounter {
  readonly id: string;
  readonly model: string;
  readonly simulated: boolean;
  readonly estimatedCostMicros: number;

  constructor(
    private readonly first: FlowerCounter,
    private readonly second: FlowerCounter,
  ) {
    this.id = first.id;
    this.model = `${first.model}+${second.model}`;
    this.simulated = first.simulated || second.simulated;
    // Stima prudente: quasi sempre basta il primo; il secondo si somma solo se serve.
    this.estimatedCostMicros = first.estimatedCostMicros;
  }

  async count(
    image: { readonly bytes: Uint8Array; readonly contentType: string },
    targets: readonly CountTarget[],
    signal: AbortSignal,
  ): Promise<CountOutcome> {
    const first = await this.first.count(image, targets, signal);
    const firstCost = first.costMicros ?? this.first.estimatedCostMicros;
    if (countsMatch(targets, first)) return { ...first, costMicros: firstCost, decidedBy: 'first' };
    const second = await this.second.count(
      image,
      targets,
      AbortSignal.any([signal, AbortSignal.timeout(SECOND_OPINION_TIMEOUT_MS)]),
    );
    return {
      counts: second.counts,
      other: second.other,
      costMicros: firstCost + (second.costMicros ?? this.second.estimatedCostMicros),
      decidedBy: 'second',
    };
  }
}

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
  ): Promise<CountOutcome> {
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
    return apiKey
      ? new TwoStepFlowerCounter(new FalFlowerCounter({ apiKey }), new FalBoxCounter({ apiKey }))
      : null;
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
