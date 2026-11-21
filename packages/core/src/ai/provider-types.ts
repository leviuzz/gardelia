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

export interface AiImageProvider {
  readonly id: string;
  readonly model: string;
  /** true = immagine simulata (sviluppo/test): mai mostrata come AI reale. */
  readonly simulated: boolean;
  /** Costo stimato per immagine (micro-USD) usato per il tetto di spesa. */
  readonly estimatedCostMicros: number;
  generate(request: {
    readonly prompt: string;
    readonly spec: BouquetPreviewSpec;
    readonly signal: AbortSignal;
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

/** Tipo dell'immagine dai primi byte: le risposte dei provider sono dati non fidati. */
export function sniffImageType(bytes: Uint8Array): GeneratedImage['contentType'] | null {
  const startsWith = (offset: number, signature: readonly number[]) =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (startsWith(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // "RIFF" … "WEBP"
  if (startsWith(0, [0x52, 0x49, 0x46, 0x46]) && startsWith(8, [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }
  return null;
}
