/** Contratto del contatore di fiori dell'anteprima esatta (modulo senza dipendenze, ADR-034). */
import type { CountCheckResult, CountTarget } from '@floral/domain';

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
  ): Promise<CountCheckResult>;
}
