/**
 * Contratto comune dei provider di immagini AI (ADR-025): il resto del sistema (servizio,
 * worker, UI) non sa quale modello genera l'immagine.
 */
import type { BouquetPreviewSpec } from '@floral/domain';

export interface GeneratedImage {
  readonly bytes: Uint8Array;
  readonly contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Costo in micro-USD (comunicato dal provider o stimato dal listino); null = ignoto. */
  readonly costMicros: number | null;
}

/** Immagine data al generatore: una foto di un fiore del catalogo o la foto da correggere. */
export interface ImageInput {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface AiImageProvider {
  readonly id: string;
  readonly model: string;
  /** true = immagine simulata (sviluppo/test): mai mostrata come AI reale. */
  readonly simulated: boolean;
  /** Costo stimato per immagine (micro-USD) usato per il tetto di spesa. */
  readonly estimatedCostMicros: number;
  /**
   * Sa partire da immagini: le foto dei fiori del catalogo (anteprima esatta, ADR-034 v9) o la
   * foto da correggere. Senza, l'anteprima resta descritta a parole.
   */
  readonly acceptsImages: boolean;
  generate(request: {
    readonly prompt: string;
    readonly spec: BouquetPreviewSpec;
    readonly signal: AbortSignal;
    /** Immagini di partenza (solo se `acceptsImages`), nell'ordine in cui il prompt le cita. */
    readonly images?: readonly ImageInput[];
  }): Promise<GeneratedImage>;
}

/**
 *  - `provider_error`: errore temporaneo (rete, 429, 5xx, risposta illeggibile) → si ritenta.
 *  - `timeout`: il provider non ha risposto in tempo → si ritenta.
 *  - `content_rejected`: il modello ha rifiutato il contenuto → nessun nuovo tentativo.
 *  - `invalid_request`: richiesta, chiave o saldo del provider non validi (4xx) → nessun
 *    nuovo tentativo: ripetere non cambia l'esito, serve un intervento della piattaforma.
 */
export type AiProviderErrorCode =
  'provider_error' | 'timeout' | 'content_rejected' | 'invalid_request';

export const NON_RETRYABLE_AI_ERRORS: ReadonlySet<string> = new Set<AiProviderErrorCode>([
  'content_rejected',
  'invalid_request',
]);

export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Le risposte dei provider sono dati non fidati: tipo dai primi byte. */
export { sniffImageType } from '../media/image-type';
