/** Contratto del contatore di fiori dell'anteprima esatta (modulo senza dipendenze, ADR-034). */
import type { CountCheckResult, CountTarget } from '@floral/domain';

export interface CountOutcome extends CountCheckResult {
  /** Costo reale del controllo (uno o due modelli), se diverso dalla stima. */
  readonly costMicros?: number;
  /** Chi ha deciso: il primo conteggio o la seconda opinione. */
  readonly decidedBy?: 'first' | 'second';
}

export interface FlowerCounter {
  readonly id: string;
  readonly model: string;
  /** true = conteggio simulato (sviluppo/test): mai presentato come verifica reale. */
  readonly simulated: boolean;
  /** Costo stimato di un controllo (micro-USD), per il tetto di spesa. */
  readonly estimatedCostMicros: number;
  count(
    image: { readonly bytes: Uint8Array; readonly contentType: string },
    targets: readonly CountTarget[],
    signal: AbortSignal,
  ): Promise<CountOutcome>;
}
