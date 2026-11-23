/**
 * Foto realistica verificata dell'anteprima esatta (ADR-034): dalle foto dei fiori del catalogo
 * una foto naturale del ramo (v9; fino alla v8 dal boceto), poi il conteggio dei fiori. Se la foto
 * ha solo fiori in più dei tipi della distinta, una seconda passata sulla stessa foto li toglie;
 * altrimenti si rifà da capo. Ci si ferma alla prima foto con i numeri giusti, al massimo
 * `EXACT_PREVIEW_LIMITS.generationsPerJob` immagini. Usata dal worker; senza stato, così la
 * stessa sequenza si prova anche fuori dalla coda.
 */
import {
  EXACT_PREVIEW_LIMITS,
  buildCountFixPrompt,
  countsMatch,
  extraFlowerCount,
  type BouquetPreviewSpec,
  type CountTarget,
  type CountTargetOptions,
} from '@floral/domain';
import type { FlowerCounter, CountOutcome } from './flower-counter-types';
import type { AiImageProvider, GeneratedImage, ImageInput } from './provider-types';

export const GENERATION_TIMEOUT_MS = 120_000;
// Primo conteggio (~5 s) e, se serve, la seconda opinione (fino a ~40 s).
export const COUNT_TIMEOUT_MS = 150_000;

export interface VerifiedRenderInput {
  readonly provider: AiImageProvider;
  /** null = nessun controllo configurato: la prima foto si accetta, non verificata. */
  readonly counter: FlowerCounter | null;
  readonly spec: BouquetPreviewSpec;
  /** Foto dei fiori da cui nasce ogni nuova foto, nell'ordine citato dal prompt. */
  readonly references: readonly ImageInput[];
  readonly prompt: string;
  readonly targets: readonly CountTarget[];
  readonly targetOptions?: CountTargetOptions;
  /** Il controllo non ha risposto: la foto si mostra non verificata (chi chiama lo registra). */
  readonly onCountUnavailable?: (error: unknown) => void;
}

export interface VerifiedRenderCheck extends CountOutcome {
  /** `render` = foto nuova; `fix` = correzione dei fiori in più sulla foto precedente. */
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
  // La correzione in corso: da quale foto parte e quanti fiori in più aveva quella foto.
  let fix: {
    readonly prompt: string;
    readonly image: GeneratedImage;
    readonly extras: number;
  } | null = null;
  for (let generation = 1; generation <= EXACT_PREVIEW_LIMITS.generationsPerJob; generation++) {
    const step: VerifiedRenderCheck['step'] = fix ? 'fix' : 'render';
    const image = await input.provider.generate({
      prompt: fix ? fix.prompt : input.prompt,
      spec: input.spec,
      images: fix
        ? [{ bytes: fix.image.bytes, contentType: fix.image.contentType }]
        : input.references,
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
    // Solo fiori in più: si corregge questa foto, anche se è già una correzione, purché l'ultima
    // correzione ne abbia tolto qualcuno. Prova del 23/11 sul ramo del founder (4 rose + 3
    // tulipani): la foto nuova ha quasi sempre di nuovo un fiore in più, mentre una seconda
    // correzione chiude il lavoro. Se la correzione non è servita, o mancano fiori, si rifà da capo.
    const extras = extraFlowerCount(input.targets, result);
    const progressed: boolean = fix === null || (extras !== null && extras < fix.extras);
    const fixPrompt: string | null =
      extras !== null && progressed
        ? buildCountFixPrompt(input.spec, input.targets, result, input.targetOptions)
        : null;
    fix = fixPrompt && extras !== null ? { prompt: fixPrompt, image, extras } : null;
  }
  return { accepted: null, checks, spentMicros: spent };
}
