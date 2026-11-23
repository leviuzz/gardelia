/**
 * Worker delle anteprime AI (ADR-025).
 *
 *  - Preleva il prossimo job con `app_claim_ai_job` (SECURITY DEFINER, `SKIP LOCKED`): nessun
 *    bypass RLS nel codice; ogni job si lavora nel contesto del proprio tenant.
 *  - Successo: immagine nell'archivio, job SUCCEEDED e credito consumato (usageUnits = 1).
 *  - Stile della fioreria (ADR-032): se il ramo ha una foto di "Mis ramos", il suo stile si
 *    descrive a parole una sola volta (poi si riusa) e solo quel testo va nel prompt; se la
 *    descrizione non riesce, l'anteprima si genera comunque, senza stile.
 *  - Errore temporaneo: nuovo tentativo con attesa crescente finché restano tentativi; poi
 *    FAILED senza consumare crediti (BQ-02: nessuna anteprima inventata, il disegno resta
 *    valido). Contenuto rifiutato o richiesta non valida: FAILED subito (ripetere non serve).
 *  - Anteprima esatta (ADR-034): la foto parte dal boceto; un modello di visione ricontrolla i
 *    numeri, con un nuovo tentativo se non coincidono. Se nemmeno il secondo coincide il job
 *    finisce FAILED con `count_mismatch` e nessun credito: un'immagine con numeri sbagliati non
 *    si mostra mai come fedele (il boceto, esatto, resta visibile nel Diseñador).
 */
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { getDb, withTenantContext, type Prisma } from '@floral/db';
import {
  EXACT_PREVIEW_LIMITS,
  buildPreviewPrompt,
  buildSketchRenderPrompt,
  cleanStyleDescription,
  countTargets,
  countsMatch,
  isBouquetPreviewSpec,
  isUuid,
  type BouquetPreviewSpec,
} from '@floral/domain';
import { aiConfig } from '../config';
import { logger } from '../logger';
import { cutoutKeyFor, cutoutThumbKey } from '../media/cutout-keys';
import {
  AiProviderError,
  NON_RETRYABLE_AI_ERRORS,
  getAiProvider,
  type AiImageProvider,
  type GeneratedImage,
} from './providers';
import { getFlowerCounter, type CountOutcome } from './flower-counter';
import { SketchUnavailableError, renderSketchForTenant } from './sketch-source';
import { finishCutout, getBackgroundRemover, type BackgroundRemover } from './background-remover';
import { onAiJobQueued } from './signal';
import { getObjectStorage } from './storage';
import { getStyleDescriber } from './style-describer';

// Anteprima esatta: fino a 2 foto e 2 controlli, quindi più tempo di una generazione semplice.
export const AI_JOB_LEASE_SECONDS = 300;
const GENERATION_TIMEOUT_MS = 120_000;
// Primo conteggio (~5 s) e, se serve, la seconda opinione (fino a ~40 s).
const COUNT_TIMEOUT_MS = 150_000;

/** Attesa prima del tentativo successivo: 15 s, 30 s, 60 s… */
export function retryDelayMs(attempt: number): number {
  return 15_000 * 2 ** Math.max(0, attempt - 1);
}

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type AiJobOutcome = 'idle' | 'succeeded' | 'retry' | 'failed';

const STYLE_DESCRIPTION_TIMEOUT_MS = 30_000;

/**
 * Testo dello stile per una foto di "Mis ramos": quello salvato, oppure lo genera ora (una
 * volta sola) dalla miniatura. null se la foto non è più attiva o se la descrizione fallisce:
 * lo stile è un di più, mai un motivo per non dare l'anteprima.
 */
async function styleDescriptionFor(
  scope: { tenantId: string; userId: string },
  referenceId: string,
): Promise<{ text: string | null; costMicros: number }> {
  const db = getDb();
  const reference = await withTenantContext(db, scope, (tx) =>
    tx.styleReferencePhoto.findFirst({
      where: { id: referenceId, tenantId: scope.tenantId, status: 'ACTIVE' },
      select: { styleDescription: true, thumbKey: true },
    }),
  );
  if (!reference) return { text: null, costMicros: 0 };
  if (reference.styleDescription) return { text: reference.styleDescription, costMicros: 0 };
  const describer = getStyleDescriber();
  if (!describer) return { text: null, costMicros: 0 };
  try {
    const bytes = await getObjectStorage().get(reference.thumbKey);
    if (!bytes) return { text: null, costMicros: 0 };
    const described = await describer.describe(
      { bytes, contentType: 'image/jpeg' },
      AbortSignal.timeout(STYLE_DESCRIPTION_TIMEOUT_MS),
    );
    const en = cleanStyleDescription(described.en);
    if (!en) return { text: null, costMicros: describer.estimatedCostMicros };
    const es = described.es.replace(/\s+/g, ' ').trim().slice(0, 320) || null;
    await withTenantContext(db, scope, (tx) =>
      tx.styleReferencePhoto.updateMany({
        where: { id: referenceId, tenantId: scope.tenantId, styleDescription: null },
        data: {
          styleDescription: en,
          styleDescriptionEs: es,
          styleDescribedAt: new Date(),
          styleDescriberModel: describer.model,
        },
      }),
    );
    return { text: en, costMicros: describer.estimatedCostMicros };
  } catch (error) {
    logger.warn(
      {
        tenantId: scope.tenantId,
        referenceId,
        code: error instanceof AiProviderError ? error.code : 'unexpected',
      },
      'descrizione dello stile non riuscita: anteprima senza stile',
    );
    return { text: null, costMicros: 0 };
  }
}

type ClaimedJob = Awaited<ReturnType<typeof loadJob>>;

async function loadJob(scope: { tenantId: string; userId: string }, jobId: string) {
  return withTenantContext(getDb(), scope, (tx) =>
    tx.aiJob.findFirst({ where: { id: jobId, tenantId: scope.tenantId } }),
  );
}

/** Errore di un job: nuovo tentativo se è temporaneo e restano tentativi, altrimenti FAILED. */
async function failOrRetry(
  job: NonNullable<ClaimedJob>,
  scope: { tenantId: string; userId: string },
  error: unknown,
  what: string,
  /** Costo già speso in questo tentativo (es. una foto scartata): entra nel tetto di spesa. */
  spentMicros = 0,
): Promise<{ outcome: 'retry' | 'failed'; code: string }> {
  const code =
    error instanceof AiProviderError
      ? error.code
      : error instanceof Error && error.name === 'TimeoutError'
        ? 'timeout'
        : 'provider_error';
  const retryable = !NON_RETRYABLE_AI_ERRORS.has(code) && job.attempts < job.maxAttempts;
  const message = error instanceof Error ? error.message.slice(0, 300) : 'errore sconosciuto';
  const cost =
    spentMicros > 0
      ? { providerCostMicros: (job.providerCostMicros ?? 0) + spentMicros, providerCurrency: 'USD' }
      : {};
  await withTenantContext(getDb(), scope, (tx) =>
    tx.aiJob.updateMany({
      where: { id: job.id, tenantId: job.tenantId, status: 'RUNNING' },
      data: retryable
        ? {
            status: 'QUEUED',
            runAfter: new Date(Date.now() + retryDelayMs(job.attempts)),
            lockedUntil: null,
            errorCode: code,
            errorMessage: message,
            ...cost,
          }
        : {
            status: 'FAILED',
            usageUnits: 0,
            finishedAt: new Date(),
            lockedUntil: null,
            errorCode: code,
            errorMessage: message,
            ...cost,
          },
    }),
  );
  logger.warn(
    // Il messaggio contiene solo stato HTTP, ID della richiesta del provider e il suo motivo.
    { jobId: job.id, tenantId: job.tenantId, code, attempt: job.attempts, retryable, message },
    what,
  );
  return { outcome: retryable ? 'retry' : 'failed', code };
}

const CUTOUT_TIMEOUT_MS = 60_000;

/**
 * Scontorno di una foto del catalogo (ADR-033): ritaglio, controllo di qualità, PNG rifinito e
 * miniatura accanto all'originale. Un ritaglio inutilizzabile non si ritenta (serve un'altra
 * foto); un errore del servizio sì. Nessun credito del fiorista: costo della piattaforma.
 */
async function processCutoutJob(
  job: NonNullable<ClaimedJob>,
  scope: { tenantId: string; userId: string },
  remover: BackgroundRemover | null,
): Promise<AiJobOutcome> {
  const db = getDb();
  const input = job.input as { photoId?: unknown } | null;
  const photoId = isUuid(input?.photoId) ? input.photoId : null;
  const markPhoto = (data: {
    cutoutStatus: 'READY' | 'FAILED';
    cutoutKey?: string;
    cutoutError: string | null;
  }) =>
    photoId
      ? withTenantContext(db, scope, (tx) =>
          tx.catalogItemPhoto.updateMany({
            where: { id: photoId, tenantId: job.tenantId },
            data,
          }),
        )
      : Promise.resolve();
  try {
    if (!photoId) throw new AiProviderError('invalid_request', 'input non valido');
    if (!remover) throw new AiProviderError('invalid_request', 'scontorno non configurato');
    const photo = await withTenantContext(db, scope, (tx) =>
      tx.catalogItemPhoto.findFirst({
        where: { id: photoId, tenantId: job.tenantId, status: 'ACTIVE' },
        select: { storageKey: true, contentType: true },
      }),
    );
    if (!photo) throw new AiProviderError('invalid_request', 'foto non più attiva');
    const original = await getObjectStorage().get(photo.storageKey);
    if (!original) throw new AiProviderError('invalid_request', 'file della foto mancante');
    const removed = await remover.remove(
      { bytes: original, contentType: photo.contentType },
      AbortSignal.timeout(CUTOUT_TIMEOUT_MS),
    );
    const finished = await finishCutout(removed.png);
    const now = new Date();
    if (!finished.ok) {
      await markPhoto({ cutoutStatus: 'FAILED', cutoutError: finished.error });
      await withTenantContext(db, scope, (tx) =>
        tx.aiJob.updateMany({
          where: { id: job.id, tenantId: job.tenantId, status: 'RUNNING' },
          data: {
            status: 'FAILED',
            usageUnits: 0,
            providerCostMicros: removed.costMicros,
            providerCurrency: removed.costMicros !== null ? 'USD' : null,
            finishedAt: now,
            lockedUntil: null,
            errorCode: finished.error,
            errorMessage: null,
          },
        }),
      );
      logger.info(
        { jobId: job.id, tenantId: job.tenantId, code: finished.error },
        'ritaglio inutilizzabile',
      );
      return 'failed';
    }
    const key = cutoutKeyFor(job.tenantId, photoId);
    const storage = getObjectStorage();
    await storage.put(key, finished.cutout.full, 'image/png');
    await storage.put(cutoutThumbKey(key), finished.cutout.thumb, 'image/png');
    await markPhoto({ cutoutStatus: 'READY', cutoutKey: key, cutoutError: null });
    await withTenantContext(db, scope, (tx) =>
      tx.aiJob.updateMany({
        where: { id: job.id, tenantId: job.tenantId, status: 'RUNNING' },
        data: {
          status: 'SUCCEEDED',
          usageUnits: 0,
          outputKey: key,
          outputContentType: 'image/png',
          output: {
            opaqueRatio: Math.round(finished.cutout.opaqueRatio * 1000) / 1000,
          } satisfies Prisma.InputJsonValue,
          providerCostMicros: removed.costMicros,
          providerCurrency: removed.costMicros !== null ? 'USD' : null,
          finishedAt: now,
          lockedUntil: null,
          errorCode: null,
          errorMessage: null,
        },
      }),
    );
    logger.info({ jobId: job.id, tenantId: job.tenantId }, 'foto scontornata');
    return 'succeeded';
  } catch (error) {
    const result = await failOrRetry(job, scope, error, 'scontorno non riuscito');
    if (result.outcome === 'failed')
      await markPhoto({ cutoutStatus: 'FAILED', cutoutError: 'cutout_failed' });
    return result.outcome;
  }
}

/** Salva l'immagine riuscita e chiude il job consumando il credito prenotato. */
async function completePreview(
  job: NonNullable<ClaimedJob>,
  scope: { tenantId: string; userId: string },
  image: GeneratedImage,
  output: Prisma.InputJsonValue,
  costMicros: number | null,
): Promise<void> {
  const key = `tenants/${job.tenantId}/ai-previews/${job.id}.${EXTENSION[image.contentType] ?? 'png'}`;
  await getObjectStorage().put(key, image.bytes, image.contentType);
  await withTenantContext(getDb(), scope, (tx) =>
    tx.aiJob.updateMany({
      where: { id: job.id, tenantId: job.tenantId, status: 'RUNNING' },
      data: {
        status: 'SUCCEEDED',
        usageUnits: job.quotaSource ? 1 : 0,
        outputKey: key,
        outputContentType: image.contentType,
        output,
        providerCostMicros: costMicros,
        providerCurrency: costMicros !== null ? 'USD' : null,
        finishedAt: new Date(),
        lockedUntil: null,
        errorCode: null,
        errorMessage: null,
      },
    }),
  );
}

/**
 * Anteprima esatta (ADR-034): boceto dai ritagli → foto realistica → conteggio dei fiori con un
 * modello di visione. Si accetta la prima foto con gli stessi numeri della distinta; dopo
 * `attemptsPerJob` foto diverse il job si chiude FAILED (`count_mismatch`) senza credito. Se il
 * controllo stesso non risponde, la foto si mostra come un'anteprima normale (non verificata).
 */
async function processExactPreview(
  job: NonNullable<ClaimedJob>,
  scope: { tenantId: string; userId: string },
  provider: AiImageProvider,
  spec: BouquetPreviewSpec,
): Promise<AiJobOutcome> {
  let spent = 0;
  try {
    const referenceId = spec.styleReferenceId;
    const style = isUuid(referenceId)
      ? await styleDescriptionFor(scope, referenceId)
      : { text: null, costMicros: 0 };
    spent += style.costMicros;
    const sketch = await renderSketchForTenant(scope, spec);
    const source = {
      bytes: new Uint8Array(await sharp(sketch.png).jpeg({ quality: 90 }).toBuffer()),
      contentType: 'image/jpeg',
    };
    const prompt = buildSketchRenderPrompt(spec, { styleDescription: style.text });
    const counter = getFlowerCounter();
    const targets = countTargets(spec);
    const checks: CountOutcome[] = [];
    let accepted: { image: GeneratedImage; verified: boolean | null } | null = null;
    for (let attempt = 1; attempt <= EXACT_PREVIEW_LIMITS.attemptsPerJob && !accepted; attempt++) {
      const image = await provider.generate({
        prompt,
        spec,
        image: source,
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
      spent += image.costMicros ?? provider.estimatedCostMicros;
      if (!counter) {
        accepted = { image, verified: null };
        break;
      }
      try {
        const result = await counter.count(
          { bytes: image.bytes, contentType: image.contentType },
          targets,
          AbortSignal.timeout(COUNT_TIMEOUT_MS),
        );
        spent += result.costMicros ?? counter.estimatedCostMicros;
        checks.push(result);
        if (countsMatch(targets, result)) accepted = { image, verified: true };
      } catch (error) {
        logger.warn(
          {
            jobId: job.id,
            tenantId: job.tenantId,
            code: error instanceof AiProviderError ? error.code : 'unexpected',
          },
          'controllo dei conteggi non disponibile: anteprima non verificata',
        );
        accepted = { image, verified: null };
      }
    }
    const totalCost = (job.providerCostMicros ?? 0) + spent;
    const output = {
      mode: 'EXACT',
      verified: accepted ? accepted.verified : false,
      styleApplied: style.text !== null,
      checks: checks.map((check) => ({
        counts: check.counts,
        other: check.other,
        decidedBy: check.decidedBy ?? 'first',
      })),
    } satisfies Prisma.InputJsonValue;
    if (!accepted) {
      await withTenantContext(getDb(), scope, (tx) =>
        tx.aiJob.updateMany({
          where: { id: job.id, tenantId: job.tenantId, status: 'RUNNING' },
          data: {
            status: 'FAILED',
            usageUnits: 0,
            output,
            providerCostMicros: totalCost,
            providerCurrency: 'USD',
            finishedAt: new Date(),
            lockedUntil: null,
            errorCode: 'count_mismatch',
            errorMessage: null,
          },
        }),
      );
      logger.info(
        {
          jobId: job.id,
          tenantId: job.tenantId,
          attempts: checks.length,
          // Solo numeri (tipo della distinta → steli attesi / fiori trovati), mai nomi.
          expected: Object.fromEntries(targets.map((target) => [target.index, target.expected])),
          found: checks.map((check) => ({ counts: check.counts, other: check.other })),
        },
        'anteprima esatta scartata: i fiori non coincidono con la distinta',
      );
      return 'failed';
    }
    await completePreview(job, scope, accepted.image, output, totalCost);
    logger.info(
      {
        jobId: job.id,
        tenantId: job.tenantId,
        verified: accepted.verified,
        attempts: checks.length,
      },
      'anteprima esatta generata',
    );
    return 'succeeded';
  } catch (error) {
    const reason =
      error instanceof SketchUnavailableError
        ? new AiProviderError('invalid_request', error.message)
        : error;
    return (await failOrRetry(job, scope, reason, 'anteprima esatta non riuscita', spent)).outcome;
  }
}

/**
 * Lavora al massimo un job (anteprima o scontorno). `onlyTenantId` serve ai test (e a futuri
 * worker dedicati).
 */
export async function processNextAiJob(
  options: {
    readonly onlyTenantId?: string;
    readonly provider?: AiImageProvider;
    readonly remover?: BackgroundRemover | null;
    /** Job in corso al massimo su tutta la piattaforma (predefinito: configurazione). */
    readonly maxRunning?: number;
  } = {},
): Promise<AiJobOutcome> {
  const provider = options.provider ?? getAiProvider();
  const remover = options.remover === undefined ? getBackgroundRemover() : options.remover;
  if (!provider && !remover) return 'idle';
  const db = getDb();
  const maxRunning = options.maxRunning ?? aiConfig().AI_MAX_CONCURRENT_JOBS;
  const claimed = await db.$queryRaw<
    { job_id: string; tenant_id: string; requested_by: string }[]
  >`SELECT * FROM app_claim_ai_job(${AI_JOB_LEASE_SECONDS}::int, ${options.onlyTenantId ?? null}::uuid, ${maxRunning}::int)`;
  const row = claimed[0];
  if (!row) return 'idle';

  const scope = { tenantId: row.tenant_id, userId: row.requested_by };
  const job = await loadJob(scope, row.job_id);
  if (!job) return 'idle';
  if (job.feature === 'PHOTO_CUTOUT') return processCutoutJob(job, scope, remover);

  try {
    if (!provider) throw new AiProviderError('invalid_request', 'provider non configurato');
    if (!isBouquetPreviewSpec(job.input))
      throw new AiProviderError('provider_error', 'input non valido');
    if (job.provider !== provider.id || job.model !== provider.model) {
      // Provider cambiato dopo l'accodamento: si rigenera con quello attuale solo su nuova
      // richiesta (la chiave di cache include il modello).
      throw new AiProviderError('invalid_request', 'provider cambiato');
    }
    if (job.input.mode === 'EXACT')
      return await processExactPreview(job, scope, provider, job.input);
    const referenceId = job.input.styleReferenceId;
    const style = isUuid(referenceId)
      ? await styleDescriptionFor(scope, referenceId)
      : { text: null, costMicros: 0 };
    const image = await provider.generate({
      prompt: buildPreviewPrompt(job.input, { styleDescription: style.text }),
      spec: job.input,
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
    const costMicros =
      image.costMicros === null && style.costMicros === 0
        ? null
        : (image.costMicros ?? 0) + style.costMicros;
    await completePreview(
      job,
      scope,
      image,
      { mode: 'PROMPT', styleApplied: style.text !== null } satisfies Prisma.InputJsonValue,
      costMicros,
    );
    logger.info({ jobId: job.id, tenantId: job.tenantId }, 'anteprima AI generata');
    return 'succeeded';
  } catch (error) {
    return (await failOrRetry(job, scope, error, 'anteprima AI non riuscita')).outcome;
  }
}

/** Tempo lasciato a un job già iniziato prima che la funzione venga fermata (Vercel). */
export const DRAIN_RESERVE_MS = 200_000;

export interface DrainResult {
  readonly processed: number;
  /** `idle`: coda vuota (o limite di job in corso raggiunto); `deadline`: tempo finito. */
  readonly stoppedBecause: 'idle' | 'deadline';
}

/**
 * Svuota la coda per al massimo `budgetMs` (job su funzioni, ADR-037): lavora un job dopo l'altro
 * e smette di prenderne di nuovi quando il tempo rimasto non basta più a finirne uno
 * (`reserveMs`). I job non presi restano in coda per la prossima chiamata; un job interrotto
 * torna disponibile alla scadenza del lease.
 */
export async function drainAiQueue(options: {
  readonly budgetMs: number;
  readonly reserveMs?: number;
  readonly onlyTenantId?: string;
  readonly provider?: AiImageProvider;
  readonly remover?: BackgroundRemover | null;
  readonly maxRunning?: number;
}): Promise<DrainResult> {
  const { budgetMs, reserveMs = DRAIN_RESERVE_MS, ...jobOptions } = options;
  const startedAt = Date.now();
  let processed = 0;
  while (Date.now() - startedAt < budgetMs - reserveMs) {
    const outcome = await processNextAiJob(jobOptions);
    if (outcome === 'idle') return { processed, stoppedBecause: 'idle' };
    processed += 1;
  }
  return { processed, stoppedBecause: 'deadline' };
}

export interface AiWorkerHandle {
  stop(): Promise<void>;
}

/**
 * Ciclo del worker: lavora i job finché ce ne sono, poi attende un segnale in-process o il
 * prossimo giro di polling. Non lancia mai: gli errori inattesi si registrano nei log.
 */
export function startAiWorker(
  options: { readonly pollIntervalMs?: number; readonly onlyTenantId?: string } = {},
): AiWorkerHandle {
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const claimOptions = options.onlyTenantId ? { onlyTenantId: options.onlyTenantId } : {};
  const controller = new AbortController();
  let wake: (() => void) | null = null;
  const unsubscribe = onAiJobQueued(() => wake?.());

  const loop = (async () => {
    while (!controller.signal.aborted) {
      let outcome: AiJobOutcome = 'idle';
      try {
        outcome = await processNextAiJob(claimOptions);
      } catch (error) {
        logger.error({ err: error }, 'errore nel worker delle anteprime AI');
      }
      if (outcome !== 'idle') continue;
      await new Promise<void>((resolve) => {
        wake = resolve;
        delay(pollIntervalMs, undefined, { signal: controller.signal })
          .catch(() => undefined)
          .finally(resolve);
      });
      wake = null;
    }
  })();

  return {
    async stop() {
      controller.abort();
      unsubscribe();
      wake?.();
      await loop;
    },
  };
}
