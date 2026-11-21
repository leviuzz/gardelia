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
 *  - Anteprima esatta (ADR-034): se ogni fiore contato ha una foto senza fondo, il boceto
 *    (esatto per costruzione) è gratis e immediato; la foto realistica parte dal boceto e si
 *    mostra solo se un modello di visione ritrova gli stessi numeri.
 */
import { createHash } from 'node:crypto';
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AI_PREVIEW_PROMPT_VERSION,
  AUDIT_ACTIONS,
  EXACT_PREVIEW_LIMITS,
  SKETCH_LIMITS,
  exactPreviewPlan,
  type ExactPreviewBlocker,
  type PreviewMode,
  aiQuotaPeriod,
  buildPreviewSpec,
  canonicalPreviewInput,
  computeAiQuota,
  isUuid,
  type AiQuota,
  type BouquetPreviewSpec,
} from '@floral/domain';
import { fitsMonthlyAiBudget } from '../ai/budget';
import { getFlowerCounter } from '../ai/flower-counter';
import { getAiProvider, type AiImageProvider } from '../ai/providers';
import { SketchUnavailableError, renderSketchForTenant } from '../ai/sketch-source';
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
  /** true se l'immagine ha usato lo stile di "Mis ramos" (descritto a parole, ADR-032). */
  readonly styled: boolean;
  /** EXACT: foto realistica dal boceto esatto (ADR-034); PROMPT: descritta a parole. */
  readonly mode: PreviewMode;
  /** Numero di fiori ricontrollato da un modello di visione; null = non verificato. */
  readonly verified: boolean | null;
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
  /** Modalità della prossima richiesta per il disegno così com'è (null se superato). */
  readonly mode: PreviewMode | null;
  /** Troppe foto realistiche scartate per conteggi diversi: niente nuovi tentativi. */
  readonly retryLimitReached: boolean;
}

export interface BouquetSketchPlanDto {
  /** true = il boceto esatto si può disegnare (e la foto realistica partirà da lì). */
  readonly eligible: boolean;
  readonly reason: ExactPreviewBlocker | 'outdated' | null;
  readonly stems: number;
  readonly maxStems: number;
  /** Fiori contati senza foto senza fondo, per portare il fiorista alla scheda giusta. */
  readonly missing: readonly { readonly id: string; readonly name: string }[];
  /** Cambia quando cambia il boceto (per l'URL dell'immagine); null se non disegnabile. */
  readonly version: string | null;
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
    input: Prisma.JsonValue | null;
    output: Prisma.JsonValue | null;
    createdAt: Date;
    finishedAt: Date | null;
  },
  reused: boolean,
): AiPreviewDto {
  const output = job.output as { styleApplied?: unknown; verified?: unknown } | null;
  const input = job.input as { mode?: unknown } | null;
  const status: AiPreviewStatus =
    job.status === 'CANCELLED' ? 'FAILED' : (job.status as AiPreviewStatus);
  return {
    jobId: job.id,
    status,
    simulated: job.provider === 'simulated',
    reused,
    styled: output?.styleApplied === true,
    mode: input?.mode === 'EXACT' ? 'EXACT' : 'PROMPT',
    verified: typeof output?.verified === 'boolean' ? output.verified : null,
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

/** Solo il nome inglese: senza traduzione il prompt usa l'etichetta del catalogo. */
function englishName(names: Prisma.JsonValue | undefined): string | null {
  if (!names || typeof names !== 'object' || Array.isArray(names)) return null;
  const value = (names as Record<string, unknown>)['en-US'];
  return typeof value === 'string' && value.trim() ? value : null;
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
      config.lines.map((line) => ({
        catalogItemId: line.catalogItemId,
        quantity: line.quantity,
        color: line.color,
      })),
    );
    // Nome comune dalla tassonomia globale (leggibile da tutti, ADR-014).
    const taxonomy = await tx.catalogItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        id: { in: components.map((component) => component.item.id) },
      },
      select: { id: true, canonicalFlower: { select: { names: true } } },
    });
    const commonNames = new Map(
      taxonomy.map((row) => [row.id, englishName(row.canonicalFlower?.names)]),
    );
    // Foto senza fondo per il boceto (ADR-034): di frente se c'è, poi le altre viste.
    const sketchable = components.filter(
      (component) => component.role === 'FLOWER' || component.role === 'FOLIAGE',
    );
    const cutouts =
      sketchable.length > 0
        ? await tx.catalogItemPhoto.findMany({
            where: {
              tenantId: ctx.tenantId,
              catalogItemId: { in: sketchable.map((component) => component.item.id) },
              status: 'ACTIVE',
              cutoutStatus: 'READY',
            },
            select: { id: true, catalogItemId: true },
            orderBy: [{ view: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          })
        : [];
    // Fino a 3 angolazioni per prodotto: la prima è la principale, le altre si alternano.
    const cutoutsByItem = new Map<string, string[]>();
    for (const photo of cutouts) {
      const list = cutoutsByItem.get(photo.catalogItemId) ?? [];
      if (list.length < 3) list.push(photo.id);
      cutoutsByItem.set(photo.catalogItemId, list);
    }
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
          // Carta o nastro: solo il colore scelto (cambia anche la chiave di cache).
          colors: component.color ? [component.color] : component.item.colors,
          commonName: commonNames.get(component.item.id) ?? null,
          itemType: component.item.type,
          cutoutPhotoId: cutoutsByItem.get(component.item.id)?.[0] ?? null,
          altCutoutPhotoIds: cutoutsByItem.get(component.item.id)?.slice(1) ?? [],
        })),
      }),
    };
  } catch (error) {
    if (error instanceof ValidationError) return { id: config.id, spec: null };
    throw error;
  }
}

/**
 * Foto di "Mis ramos" il cui stile accompagna l'anteprima (ADR-032): la prima caricata con lo
 * stesso stile del disegno, altrimenti la prima caricata in assoluto. Scelta stabile: nuove
 * foto non cambiano lo stile (né la cache) dei ramos già visti, finché questa resta attiva.
 */
async function selectStyleReference(
  tx: TransactionClient,
  ctx: TenantContext,
  style: BouquetPreviewSpec['style'],
): Promise<string | null> {
  const references = await tx.styleReferencePhoto.findMany({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
    select: { id: true, style: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const sameStyle = style ? references.find((reference) => reference.style === style) : undefined;
  return (sameStyle ?? references[0])?.id ?? null;
}

/** Descrizione del ramo con la foto di stile scelta (entra nella chiave di cache). */
async function styledSpec(
  tx: TransactionClient,
  ctx: TenantContext,
  spec: BouquetPreviewSpec,
): Promise<BouquetPreviewSpec> {
  return { ...spec, styleReferenceId: await selectStyleReference(tx, ctx, spec.style) };
}

/**
 * Modalità della richiesta: esatta se il provider sa partire da un boceto e ogni fiore contato
 * ha il suo ritaglio. In modalità PROMPT i ritagli non cambiano l'immagine: fuori dalla chiave.
 */
function withMode(spec: BouquetPreviewSpec, provider: AiImageProvider): BouquetPreviewSpec {
  if (provider.supportsSketch && exactPreviewPlan(spec).eligible) return { ...spec, mode: 'EXACT' };
  return {
    ...spec,
    mode: 'PROMPT',
    components: spec.components.map((component) => ({
      ...component,
      cutoutPhotoId: null,
      altCutoutPhotoIds: [],
    })),
  };
}

/** Costo stimato di una richiesta: una foto e, in modalità esatta, un controllo dei conteggi. */
function estimatedCostFor(spec: BouquetPreviewSpec, provider: AiImageProvider): number {
  const counter = spec.mode === 'EXACT' ? getFlowerCounter() : null;
  return provider.estimatedCostMicros + (counter?.estimatedCostMicros ?? 0);
}

/** Richieste già scartate per conteggi diversi, per lo stesso ramo. */
async function countMismatches(tx: TransactionClient, ctx: TenantContext, inputHash: string) {
  return tx.aiJob.count({
    where: {
      tenantId: ctx.tenantId,
      feature: FEATURE,
      inputHash,
      status: 'FAILED',
      errorCode: 'count_mismatch',
    },
  });
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
      return {
        available: false,
        simulated: false,
        quota: null,
        preview: null,
        outdated: false,
        mode: null,
        retryLimitReached: false,
      };
    }
    const quota = await quotaFor(tx, ctx, new Date());
    if (!config.spec) {
      return {
        available: true,
        simulated: provider.simulated,
        quota,
        preview: null,
        outdated: true,
        mode: null,
        retryLimitReached: false,
      };
    }
    const spec = withMode(await styledSpec(tx, ctx, config.spec), provider);
    const inputHash = previewHash(spec, provider);
    const job = await findPreview(tx, ctx, inputHash);
    return {
      available: true,
      simulated: provider.simulated,
      quota,
      preview: job ? toDto(job, job.bouquetConfigurationId !== configurationId) : null,
      outdated: false,
      mode: spec.mode ?? 'PROMPT',
      retryLimitReached:
        spec.mode === 'EXACT' &&
        (await countMismatches(tx, ctx, inputHash)) >= EXACT_PREVIEW_LIMITS.mismatchJobs,
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
    const spec = withMode(await styledSpec(tx, ctx, config.spec), provider);
    const inputHash = previewHash(spec, provider);
    const estimatedCostMicros = estimatedCostFor(spec, provider);

    // Serializza gli accodamenti: saldo del tenant e tetto della piattaforma coerenti
    // anche con richieste simultanee.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('floral:ai-enqueue'))`;

    const existing = await findPreview(tx, ctx, inputHash);
    if (existing && existing.status !== 'FAILED' && existing.status !== 'CANCELLED') {
      return { job: existing, reused: true };
    }

    if (
      spec.mode === 'EXACT' &&
      (await countMismatches(tx, ctx, inputHash)) >= EXACT_PREVIEW_LIMITS.mismatchJobs
    ) {
      throw new ConflictError('preview_retry_limit');
    }

    const quota = await quotaFor(tx, ctx, now);
    if (!quota.nextSource) throw new ConflictError('ai_quota_exhausted');

    if (!(await fitsMonthlyAiBudget(tx, estimatedCostMicros, now))) {
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
        input: spec as unknown as Prisma.InputJsonValue,
        provider: provider.id,
        model: provider.model,
        promptVersion: AI_PREVIEW_PROMPT_VERSION,
        estimatedCostMicros,
        runAfter: now,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.aiPreviewRequested,
      entityType: 'AiJob',
      entityId: job.id,
      metadata: { configurationId: config.id, quotaSource: quota.nextSource, mode: spec.mode },
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

// -----------------------------------------------------------------------------
// Boceto esatto (ADR-034): gratis, immediato, esatto per costruzione
// -----------------------------------------------------------------------------

function sketchVersion(spec: BouquetPreviewSpec): string {
  return createHash('sha256')
    .update(canonicalPreviewInput({ ...spec, mode: 'EXACT' }, { provider: 'sketch', model: '' }))
    .digest('hex')
    .slice(0, 16);
}

/** Si può disegnare il boceto del disegno salvato? Se no, perché e quali foto mancano. */
export async function getBouquetSketchPlan(
  ctx: TenantContext,
  configurationId: string,
): Promise<BouquetSketchPlanDto> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const config = await specForConfiguration(tx, ctx, configurationId);
    if (!config) return null;
    if (!config.spec) {
      return {
        eligible: false,
        reason: 'outdated' as const,
        stems: 0,
        maxStems: SKETCH_LIMITS.maxStems,
        missing: [],
        version: null,
      };
    }
    const spec = config.spec;
    const plan = exactPreviewPlan(spec);
    const names = new Map(
      spec.components.map((component) => [component.catalogItemId, component.name]),
    );
    return {
      eligible: plan.eligible,
      reason: plan.eligible ? null : plan.reason,
      stems: plan.stems,
      maxStems: SKETCH_LIMITS.maxStems,
      missing: plan.missing.map((id) => ({ id, name: names.get(id) ?? '' })),
      version: plan.eligible ? sketchVersion(spec) : null,
    };
  });
  if (!result) return notFound(ctx, 'BouquetConfiguration', configurationId);
  return result;
}

/** PNG del boceto del disegno salvato (404 se non si può disegnare). */
export async function getBouquetSketch(
  ctx: TenantContext,
  configurationId: string,
): Promise<{ bytes: Uint8Array; contentType: 'image/png' }> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');
  const config = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    return specForConfiguration(tx, ctx, configurationId);
  });
  if (!config) return notFound(ctx, 'BouquetConfiguration', configurationId);
  if (!config.spec || !exactPreviewPlan(config.spec).eligible) {
    throw new NotFoundError('BouquetSketch');
  }
  try {
    const { png } = await renderSketchForTenant(ctx, config.spec);
    return { bytes: png, contentType: 'image/png' };
  } catch (error) {
    if (error instanceof SketchUnavailableError) throw new NotFoundError('BouquetSketch');
    throw error;
  }
}
