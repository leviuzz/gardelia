/**
 * Worker delle anteprime AI (ADR-025).
 *
 *  - Preleva il prossimo job con `app_claim_ai_job` (SECURITY DEFINER, `SKIP LOCKED`): nessun
 *    bypass RLS nel codice; ogni job si lavora nel contesto del proprio tenant.
 *  - Successo: immagine nell'archivio, job SUCCEEDED e credito consumato (usageUnits = 1).
 *  - Errore: nuovo tentativo con attesa crescente finché restano tentativi; poi FAILED senza
 *    consumare crediti (BQ-02: nessuna anteprima inventata, il disegno resta valido).
 */
import { setTimeout as delay } from 'node:timers/promises';
import { getDb, withTenantContext } from '@floral/db';
import { buildPreviewPrompt, type BouquetPreviewSpec } from '@floral/domain';
import { logger } from '../logger';
import { AiProviderError, getAiProvider, type AiImageProvider } from './providers';
import { onAiJobQueued } from './signal';
import { getObjectStorage } from './storage';

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

/** Lavora al massimo un job. `onlyTenantId` serve ai test (e a futuri worker dedicati). */
export async function processNextAiJob(
  options: { readonly onlyTenantId?: string; readonly provider?: AiImageProvider } = {},
): Promise<AiJobOutcome> {
  const provider = options.provider ?? getAiProvider();
  if (!provider) return 'idle';
  const db = getDb();
  const claimed = await db.$queryRaw<
    { job_id: string; tenant_id: string; requested_by: string }[]
  >`SELECT * FROM app_claim_ai_job(${AI_JOB_LEASE_SECONDS}::int, ${options.onlyTenantId ?? null}::uuid)`;
  const row = claimed[0];
  if (!row) return 'idle';

  const scope = { tenantId: row.tenant_id, userId: row.requested_by };
  const job = await withTenantContext(db, scope, (tx) =>
    tx.aiJob.findFirst({ where: { id: row.job_id, tenantId: row.tenant_id } }),
  );
  if (!job) return 'idle';

  try {
    if (!isPreviewSpec(job.input)) throw new AiProviderError('provider_error', 'input non valido');
    if (job.provider !== provider.id || job.model !== provider.model) {
      // Provider cambiato dopo l'accodamento: si rigenera con quello attuale solo su nuova
      // richiesta (la chiave di cache include il modello).
      throw new AiProviderError('content_rejected', 'provider cambiato');
    }
    const image = await provider.generate({
      prompt: buildPreviewPrompt(job.input),
      spec: job.input,
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
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
          providerCostMicros: image.costMicros,
          providerCurrency: image.costMicros !== null ? 'USD' : null,
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
    const code =
      error instanceof AiProviderError
        ? error.code
        : error instanceof Error && error.name === 'TimeoutError'
          ? 'timeout'
          : 'provider_error';
    const retryable = code !== 'content_rejected' && job.attempts < job.maxAttempts;
    const message = error instanceof Error ? error.message.slice(0, 300) : 'errore sconosciuto';
    await withTenantContext(db, scope, (tx) =>
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
      { jobId: job.id, tenantId: job.tenantId, code, attempt: job.attempts, retryable },
      'anteprima AI non riuscita',
    );
    return retryable ? 'retry' : 'failed';
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
