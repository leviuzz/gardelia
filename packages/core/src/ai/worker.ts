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
 */
import { setTimeout as delay } from 'node:timers/promises';
import { getDb, withTenantContext, type Prisma } from '@floral/db';
import {
  buildPreviewPrompt,
  cleanStyleDescription,
  isUuid,
  type BouquetPreviewSpec,
} from '@floral/domain';
import { logger } from '../logger';
import {
  AiProviderError,
  NON_RETRYABLE_AI_ERRORS,
  getAiProvider,
  type AiImageProvider,
} from './providers';
import { finishCutout, getBackgroundRemover, type BackgroundRemover } from './background-remover';
import { onAiJobQueued } from './signal';
import { getObjectStorage } from './storage';
import { getStyleDescriber } from './style-describer';

export const AI_JOB_LEASE_SECONDS = 180;
const GENERATION_TIMEOUT_MS = 120_000;

/** Attesa prima del tentativo successivo: 15 s, 30 s, 60 s… */
export function retryDelayMs(attempt: number): number {
  return 15_000 * 2 ** Math.max(0, attempt - 1);
}

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function isPreviewSpec(value: unknown): value is BouquetPreviewSpec {
  if (!value || typeof value !== 'object') return false;
  const spec = value as Partial<BouquetPreviewSpec>;
  return spec.version === 1 && Array.isArray(spec.components) && spec.components.length > 0;
}

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
): Promise<{ outcome: 'retry' | 'failed'; code: string }> {
  const code =
    error instanceof AiProviderError
      ? error.code
      : error instanceof Error && error.name === 'TimeoutError'
        ? 'timeout'
        : 'provider_error';
  const retryable = !NON_RETRYABLE_AI_ERRORS.has(code) && job.attempts < job.maxAttempts;
  const message = error instanceof Error ? error.message.slice(0, 300) : 'errore sconosciuto';
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
          }
        : {
            status: 'FAILED',
            usageUnits: 0,
            finishedAt: new Date(),
            lockedUntil: null,
            errorCode: code,
            errorMessage: message,
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
    const key = `tenants/${job.tenantId}/catalog-photos/${photoId}-cutout.png`;
    const storage = getObjectStorage();
    await storage.put(key, finished.cutout.full, 'image/png');
    await storage.put(
      key.replace(/-cutout\.png$/, '-cutout-thumb.png'),
      finished.cutout.thumb,
      'image/png',
    );
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

/**
 * Lavora al massimo un job (anteprima o scontorno). `onlyTenantId` serve ai test (e a futuri
 * worker dedicati).
 */
export async function processNextAiJob(
  options: {
    readonly onlyTenantId?: string;
    readonly provider?: AiImageProvider;
    readonly remover?: BackgroundRemover | null;
  } = {},
): Promise<AiJobOutcome> {
  const provider = options.provider ?? getAiProvider();
  const remover = options.remover === undefined ? getBackgroundRemover() : options.remover;
  if (!provider && !remover) return 'idle';
  const db = getDb();
  const claimed = await db.$queryRaw<
    { job_id: string; tenant_id: string; requested_by: string }[]
  >`SELECT * FROM app_claim_ai_job(${AI_JOB_LEASE_SECONDS}::int, ${options.onlyTenantId ?? null}::uuid)`;
  const row = claimed[0];
  if (!row) return 'idle';

  const scope = { tenantId: row.tenant_id, userId: row.requested_by };
  const job = await loadJob(scope, row.job_id);
  if (!job) return 'idle';
  if (job.feature === 'PHOTO_CUTOUT') return processCutoutJob(job, scope, remover);

  try {
    if (!provider) throw new AiProviderError('invalid_request', 'provider non configurato');
    if (!isPreviewSpec(job.input)) throw new AiProviderError('provider_error', 'input non valido');
    if (job.provider !== provider.id || job.model !== provider.model) {
      // Provider cambiato dopo l'accodamento: si rigenera con quello attuale solo su nuova
      // richiesta (la chiave di cache include il modello).
      throw new AiProviderError('invalid_request', 'provider cambiato');
    }
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
    const key = `tenants/${job.tenantId}/ai-previews/${job.id}.${EXTENSION[image.contentType] ?? 'png'}`;
    await getObjectStorage().put(key, image.bytes, image.contentType);
    await withTenantContext(db, scope, (tx) =>
      tx.aiJob.updateMany({
        where: { id: job.id, tenantId: job.tenantId, status: 'RUNNING' },
        data: {
          status: 'SUCCEEDED',
          usageUnits: job.quotaSource ? 1 : 0,
          outputKey: key,
          outputContentType: image.contentType,
          output: { styleApplied: style.text !== null } satisfies Prisma.InputJsonValue,
          providerCostMicros: costMicros,
          providerCurrency: costMicros !== null ? 'USD' : null,
          finishedAt: new Date(),
          lockedUntil: null,
          errorCode: null,
          errorMessage: null,
        },
      }),
    );
    logger.info({ jobId: job.id, tenantId: job.tenantId }, 'anteprima AI generata');
    return 'succeeded';
  } catch (error) {
    return (await failOrRetry(job, scope, error, 'anteprima AI non riuscita')).outcome;
  }
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
