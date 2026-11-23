/**
 * Foto realistica verificata dell'anteprima esatta (ADR-034 v7): dal boceto una foto naturale
 * del ramo, poi il conteggio dei fiori. Se la foto ha solo fiori in più dei tipi della distinta, una
 * seconda passata sulla stessa foto li toglie; altrimenti si rifà dal boceto. Ci si ferma alla
 * prima foto con i numeri giusti, al massimo `EXACT_PREVIEW_LIMITS.generationsPerJob` immagini.
 * Usata dal worker; senza stato, così la stessa sequenza si prova anche fuori dalla coda.
 */
import {
  EXACT_PREVIEW_LIMITS,
  buildCountFixPrompt,
  countsMatch,
  type BouquetPreviewSpec,
  type CountTarget,
  type CountTargetOptions,
} from '@floral/domain';
import type { FlowerCounter, CountOutcome } from './flower-counter-types';
import type { AiImageProvider, GeneratedImage } from './provider-types';

export const GENERATION_TIMEOUT_MS = 120_000;
// Primo conteggio (~5 s) e, se serve, la seconda opinione (fino a ~40 s).
export const COUNT_TIMEOUT_MS = 150_000;

export interface VerifiedRenderInput {
  readonly provider: AiImageProvider;
  /** null = nessun controllo configurato: la prima foto si accetta, non verificata. */
  readonly counter: FlowerCounter | null;
  readonly spec: BouquetPreviewSpec;
  readonly sketch: { readonly bytes: Uint8Array; readonly contentType: string };
  readonly prompt: string;
  readonly targets: readonly CountTarget[];
  readonly targetOptions?: CountTargetOptions;
  /** Il controllo non ha risposto: la foto si mostra non verificata (chi chiama lo registra). */
  readonly onCountUnavailable?: (error: unknown) => void;
}

export interface VerifiedRenderCheck extends CountOutcome {
  /** `render` = foto dal boceto; `fix` = correzione dei fiori in più sulla foto precedente. */
  readonly step: 'render' | 'fix';
}

export interface VerifiedRenderResult {
  readonly accepted: { readonly image: GeneratedImage; readonly verified: boolean | null } | null;
  readonly checks: readonly VerifiedRenderCheck[];
  /** Costo di immagini e controlli (micro-USD), anche delle foto scartate. */
  readonly spentMicros: number;
}

export async function renderVerifiedPhoto(
  input: VerifiedRenderInput,
): Promise<VerifiedRenderResult> {
  const checks: VerifiedRenderCheck[] = [];
  let spent = 0;
  let fix: { readonly prompt: string; readonly image: GeneratedImage } | null = null;
  for (let generation = 1; generation <= EXACT_PREVIEW_LIMITS.generationsPerJob; generation++) {
    const step: VerifiedRenderCheck['step'] = fix ? 'fix' : 'render';
    const image = await input.provider.generate({
      prompt: fix ? fix.prompt : input.prompt,
      spec: input.spec,
      image: fix ? { bytes: fix.image.bytes, contentType: fix.image.contentType } : input.sketch,
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
    spent += image.costMicros ?? input.provider.estimatedCostMicros;
    if (!input.counter) return { accepted: { image, verified: null }, checks, spentMicros: spent };
    let result: CountOutcome;
    try {
      result = await input.counter.count(
        { bytes: image.bytes, contentType: image.contentType },
        input.targets,
        AbortSignal.timeout(COUNT_TIMEOUT_MS),
      );
    } catch (error) {
      input.onCountUnavailable?.(error);
      return { accepted: { image, verified: null }, checks, spentMicros: spent };
    }
    spent += result.costMicros ?? input.counter.estimatedCostMicros;
    checks.push({ ...result, step });
    if (countsMatch(input.targets, result)) {
      return { accepted: { image, verified: true }, checks, spentMicros: spent };
    }
    // Una sola correzione per foto: se non basta, si rifà dal boceto.
    const fixPrompt: string | null =
      step === 'render'
        ? buildCountFixPrompt(input.spec, input.targets, result, input.targetOptions)
        : null;
    fix = fixPrompt ? { prompt: fixPrompt, image } : null;
  }
  return { accepted: null, checks, spentMicros: spent };
}
