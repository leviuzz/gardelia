/**
 * Anteprime AI del Bouquet Builder [AI-BQ-05, BQ-02, BILL-01] — ADR-024, ADR-025.
 *
 *  - Su richiesta, per un disegno SALVATO: la composizione è riletta dal catalogo attuale.
 *  - Cache per fioreria: un ramo identico già generato (o in generazione) dalla stessa
 *    fioreria si riusa per qualsiasi cliente senza consumare crediti. Mai fra fiorerie.
 *  - Quota: prima le anteprime incluse nel mese, poi gli extra sbloccati dalla piattaforma;
 *    il credito si prenota all'accodamento e si consuma solo se l'immagine riesce.
 *  - Tetto di spesa mensile della piattaforma controllato prima di accodare.
 *  - L'immagine è illustrativa: non modifica prezzo, distinta o preventivi.
 */
import { createHash } from 'node:crypto';
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AI_PREVIEW_PROMPT_VERSION,
  AUDIT_ACTIONS,
  aiQuotaPeriod,
  buildPreviewSpec,
  canonicalPreviewInput,
  computeAiQuota,
  isUuid,
  type AiQuota,
  type BouquetPreviewSpec,
} from '@floral/domain';
import { getAiProvider, aiMonthlyBudgetMicros, type AiImageProvider } from '../ai/providers';
import { getObjectStorage } from '../ai/storage';
import { notifyAiWorker } from '../ai/signal';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getEntitlements, requireEntitlement } from './billing';
import { loadComponents } from './builder-internals';

export type AiPreviewStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface AiPreviewDto {
  readonly jobId: string;
  readonly status: AiPreviewStatus;
  /** Immagine simulata (solo sviluppo/test): la UI lo dichiara sempre. */
  readonly simulated: boolean;
  /** true se l'immagine esisteva già per lo stesso ramo (nessun credito consumato). */
  readonly reused: boolean;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
}

export interface AiQuotaDto extends AiQuota {
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

export interface BouquetPreviewStateDto {
  /** false = nessun provider configurato: la funzione non si mostra (mai finta). */
  readonly available: boolean;
  readonly simulated: boolean;
  readonly quota: AiQuotaDto | null;
  readonly preview: AiPreviewDto | null;
  /** Il disegno contiene componenti non più disponibili: va rivisto prima dell'anteprima. */
  readonly outdated: boolean;
}

const FEATURE = 'BOUQUET_PREVIEW' as const;
const IN_FLIGHT = ['QUEUED', 'RUNNING'] as const;

function previewHash(spec: BouquetPreviewSpec, provider: AiImageProvider): string {
  return createHash('sha256')
    .update(canonicalPreviewInput(spec, { provider: provider.id, model: provider.model }))
    .digest('hex');
}

function toDto(
  job: {
    id: string;
    status: string;
    provider: string | null;
    errorCode: string | null;
    createdAt: Date;
    finishedAt: Date | null;
  },
  reused: boolean,
): AiPreviewDto {
  const status: AiPreviewStatus =
    job.status === 'CANCELLED' ? 'FAILED' : (job.status as AiPreviewStatus);
  return {
    jobId: job.id,
    status,
    simulated: job.provider === 'simulated',
    reused,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

/** Saldo del tenant nel mese corrente (in transazione: serve anche per prenotare). */
async function quotaFor(tx: TransactionClient, ctx: TenantContext, now: Date): Promise<AiQuotaDto> {
  const entitlements = await getEntitlements(ctx, tx);
  const period = aiQuotaPeriod(ctx.timezone, now);
  const base = { tenantId: ctx.tenantId, feature: FEATURE };
  const inPeriod = { createdAt: { gte: period.start, lt: period.end } };
  const includedDone = await tx.aiJob.aggregate({
    where: { ...base, ...inPeriod, quotaSource: 'INCLUDED', status: 'SUCCEEDED' },
    _sum: { usageUnits: true },
  });
  const includedPending = await tx.aiJob.count({
    where: { ...base, ...inPeriod, quotaSource: 'INCLUDED', status: { in: [...IN_FLIGHT] } },
  });
  const extraDone = await tx.aiJob.aggregate({
    where: { ...base, quotaSource: 'EXTRA', status: 'SUCCEEDED' },
    _sum: { usageUnits: true },
  });
  const extraPending = await tx.aiJob.count({
    where: { ...base, quotaSource: 'EXTRA', status: { in: [...IN_FLIGHT] } },
  });
  const granted = await tx.aiCreditGrant.aggregate({
    where: { tenantId: ctx.tenantId, feature: FEATURE },
    _sum: { units: true },
  });
  return {
    ...computeAiQuota({
      includedPerPeriod: entitlements.aiPreviewsPerMonth,
      includedUsed: (includedDone._sum.usageUnits ?? 0) + includedPending,
      extraGranted: granted._sum.units ?? 0,
      extraUsed: (extraDone._sum.usageUnits ?? 0) + extraPending,
    }),
    periodStart: period.start,
    periodEnd: period.end,
  };
}

/** Composizione attuale del disegno salvato → descrizione per il modello (o null se superata). */
async function specForConfiguration(
  tx: TransactionClient,
  ctx: TenantContext,
  configurationId: string,
): Promise<{ id: string; spec: BouquetPreviewSpec | null } | null> {
  const config = await tx.bouquetConfiguration.findFirst({
    where: { id: configurationId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    include: { lines: { where: { tenantId: ctx.tenantId } } },
  });
  if (!config) return null;
  try {
    const components = await loadComponents(
      tx,
      ctx,
      config.lines.map((line) => ({ catalogItemId: line.catalogItemId, quantity: line.quantity })),
    );
    return {
      id: config.id,
      spec: buildPreviewSpec({
        style: config.style,
        size: config.size,
        components: components.map((component) => ({
          catalogItemId: component.item.id,
          role: component.role,
          quantity: component.quantity,
          name: component.item.name,
          variety: component.item.variety,
          saleUnit: component.item.saleUnit,
          colors: component.item.colors,
        })),
      }),
    };
  } catch (error) {
    if (error instanceof ValidationError) return { id: config.id, spec: null };
    throw error;
  }
}

/** Anteprima migliore per un ramo: riuscita, poi in corso, poi l'ultimo fallimento. */
async function findPreview(tx: TransactionClient, ctx: TenantContext, inputHash: string) {
  const where = { tenantId: ctx.tenantId, feature: FEATURE, inputHash };
  return (
    (await tx.aiJob.findFirst({
      where: { ...where, status: 'SUCCEEDED' },
      orderBy: { createdAt: 'desc' },
    })) ??
    (await tx.aiJob.findFirst({
      where: { ...where, status: { in: [...IN_FLIGHT] } },
      orderBy: { createdAt: 'desc' },
    })) ??
    (await tx.aiJob.findFirst({ where, orderBy: { createdAt: 'desc' } }))
  );
}

export function isAiPreviewAvailable(): boolean {
  return getAiProvider() !== null;
}

export async function getAiQuota(ctx: TenantContext): Promise<AiQuotaDto> {
  requirePermission(ctx, 'builder:use');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    return quotaFor(tx, ctx, new Date());
  });
}

/** Stato dell'anteprima per il disegno (così com'è salvato) e saldo del mese. */
export async function getBouquetPreview(
  ctx: TenantContext,
  configurationId: string,
): Promise<BouquetPreviewStateDto> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');
  const provider = getAiProvider();
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const config = await specForConfiguration(tx, ctx, configurationId);
    if (!config) return null;
    if (!provider) {
      return { available: false, simulated: false, quota: null, preview: null, outdated: false };
    }
    const quota = await quotaFor(tx, ctx, new Date());
    if (!config.spec) {
      return {
        available: true,
        simulated: provider.simulated,
        quota,
        preview: null,
        outdated: true,
      };
    }
    const job = await findPreview(tx, ctx, previewHash(config.spec, provider));
    return {
      available: true,
      simulated: provider.simulated,
      quota,
      preview: job ? toDto(job, job.bouquetConfigurationId !== configurationId) : null,
      outdated: false,
    };
  });
  if (!result) return notFound(ctx, 'BouquetConfiguration', configurationId);
  return result;
}

/**
 * Richiede l'anteprima del disegno salvato. Se esiste già (o è in corso) per lo stesso
 * ramo la restituisce senza consumare; altrimenti prenota un credito e accoda il job.
 */
export async function requestBouquetPreview(
  ctx: TenantContext,
  configurationId: string,
  now: Date = new Date(),
): Promise<AiPreviewDto> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');
  const provider = getAiProvider();
  if (!provider) throw new ConflictError('ai_unavailable');

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const config = await specForConfiguration(tx, ctx, configurationId);
    if (!config) return null;
    if (!config.spec) throw new ConflictError('builder_configuration_outdated');
    const inputHash = previewHash(config.spec, provider);

    // Serializza gli accodamenti: saldo del tenant e tetto della piattaforma coerenti
    // anche con richieste simultanee.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('floral:ai-enqueue'))`;

    const existing = await findPreview(tx, ctx, inputHash);
    if (existing && existing.status !== 'FAILED' && existing.status !== 'CANCELLED') {
      return { job: existing, reused: true };
    }

    const quota = await quotaFor(tx, ctx, now);
    if (!quota.nextSource) throw new ConflictError('ai_quota_exhausted');

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const spent = await tx.$queryRaw<{ total: bigint }[]>`
      SELECT app_ai_spend_since(${monthStart}::timestamptz) AS total`;
    if (Number(spent[0]?.total ?? 0) + provider.estimatedCostMicros > aiMonthlyBudgetMicros()) {
      throw new ConflictError('ai_budget_reached');
    }

    const job = await tx.aiJob.create({
      data: {
        tenantId: ctx.tenantId,
        feature: FEATURE,
        status: 'QUEUED',
        requestedById: ctx.userId,
        bouquetConfigurationId: config.id,
        quotaSource: quota.nextSource,
        inputHash,
        input: config.spec as unknown as Prisma.InputJsonValue,
        provider: provider.id,
        model: provider.model,
        promptVersion: AI_PREVIEW_PROMPT_VERSION,
        estimatedCostMicros: provider.estimatedCostMicros,
        runAfter: now,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.aiPreviewRequested,
      entityType: 'AiJob',
      entityId: job.id,
      metadata: { configurationId: config.id, quotaSource: quota.nextSource },
    });
    return { job, reused: false };
  });
  if (!result) return notFound(ctx, 'BouquetConfiguration', configurationId);
  if (!result.reused) notifyAiWorker();
  return toDto(result.job, result.reused);
}

/** Byte dell'immagine generata, solo per il tenant che la possiede. */
export async function getAiPreviewImage(
  ctx: TenantContext,
  jobId: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(jobId)) throw new NotFoundError('AiJob');
  const job = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    return tx.aiJob.findFirst({
      where: { id: jobId, tenantId: ctx.tenantId, status: 'SUCCEEDED' },
      select: { outputKey: true, outputContentType: true },
    });
  });
  if (!job?.outputKey) return notFound(ctx, 'AiJob', jobId);
  const bytes = await getObjectStorage().get(job.outputKey);
  if (!bytes) throw new NotFoundError('AiJob');
  return { bytes, contentType: job.outputContentType ?? 'image/png' };
}
