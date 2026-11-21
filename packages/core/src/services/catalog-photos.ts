/**
 * Foto degli articoli del catalogo [CAT-01, AI-BQ-08] (ADR-029).
 *
 *  - Fiori e follaje da più angolazioni; carte, vasi e nastri con una foto per colore (il
 *    colore dev'essere uno di quelli dell'articolo).
 *  - L'immagine si normalizza PRIMA della transazione (lavoro di CPU); dentro la transazione
 *    si blocca l'articolo, si verifica il limite, si salvano i file e la riga, con audit.
 *  - I file restano privati sotto `tenants/{tenantId}/catalog-photos/` e si leggono solo
 *    tramite questo servizio (route dell'app con controllo di tenant e permessi).
 *  - Nessuna cancellazione fisica: le foto tolte si archiviano.
 *  - Scontorno automatico (ADR-033): a ogni foto si accoda un job `PHOTO_CUTOUT` nella stessa
 *    transazione (costo della piattaforma, nessun credito del fiorista); il worker salva la
 *    versione senza fondo accanto all'originale.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  PHOTO_LIMITS,
  allowsPhotos,
  canRequestCutout,
  catalogPhotoInputSchema,
  isUuid,
  newId,
  toFieldErrors,
  type CatalogItemType,
  type CatalogPhotoView,
  type CutoutError,
} from '@floral/domain';
import { getBackgroundRemover } from '../ai/background-remover';
import { fitsMonthlyAiBudget } from '../ai/budget';
import { notifyAiWorker } from '../ai/signal';
import { getObjectStorage } from '../ai/storage';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { normalizeUploadedPhoto } from '../media/images';

export interface CatalogPhotoDto {
  readonly id: string;
  readonly catalogItemId: string;
  readonly view: CatalogPhotoView;
  readonly color: string | null;
  readonly width: number;
  readonly height: number;
  /** Scontorno: null = non chiesto (nessun servizio configurato). */
  readonly cutoutStatus: 'PENDING' | 'READY' | 'FAILED' | null;
  readonly cutoutError: CutoutError | null;
  readonly createdAt: Date;
}

export type PhotoVariant = 'full' | 'thumb' | 'cutout' | 'cutout-thumb';

function toDto(photo: {
  id: string;
  catalogItemId: string;
  view: CatalogPhotoView;
  color: string | null;
  width: number;
  height: number;
  cutoutStatus: 'PENDING' | 'READY' | 'FAILED' | null;
  cutoutError: string | null;
  createdAt: Date;
}): CatalogPhotoDto {
  return {
    id: photo.id,
    catalogItemId: photo.catalogItemId,
    view: photo.view,
    color: photo.color,
    width: photo.width,
    height: photo.height,
    cutoutStatus: photo.cutoutStatus,
    cutoutError: photo.cutoutError as CutoutError | null,
    createdAt: photo.createdAt,
  };
}

/** Chiave della miniatura del ritaglio, derivata da quella del ritaglio. */
export function cutoutThumbKey(cutoutKey: string): string {
  return cutoutKey.replace(/-cutout\.png$/, '-cutout-thumb.png');
}

/** C'è un servizio di scontorno? Senza, la UI non promette fondi tolti. */
export function photoCutoutsAvailable(): boolean {
  return getBackgroundRemover() !== null;
}

/**
 * Accoda lo scontorno di una foto (nella transazione del chiamante). false se nessun servizio
 * di scontorno è configurato o se il tetto di spesa del mese è raggiunto: la foto resta
 * valida, solo senza versione ritagliata.
 */
async function enqueueCutout(
  tx: TransactionClient,
  ctx: TenantContext,
  photoId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const remover = getBackgroundRemover();
  if (!remover) return false;
  if (!(await fitsMonthlyAiBudget(tx, remover.estimatedCostMicros, now))) {
    logger.warn({ tenantId: ctx.tenantId, photoId }, 'scontorno saltato: tetto di spesa AI');
    return false;
  }
  await tx.aiJob.create({
    data: {
      tenantId: ctx.tenantId,
      feature: 'PHOTO_CUTOUT',
      status: 'QUEUED',
      requestedById: ctx.userId,
      quotaSource: null,
      inputHash: photoId,
      input: { version: 1, photoId },
      provider: remover.id,
      model: remover.model,
      estimatedCostMicros: remover.estimatedCostMicros,
      runAfter: new Date(),
    },
  });
  await tx.catalogItemPhoto.updateMany({
    where: { id: photoId, tenantId: ctx.tenantId },
    data: { cutoutStatus: 'PENDING', cutoutError: null },
  });
  return true;
}

/** Foto attive di un articolo, nell'ordine in cui sono state aggiunte (la prima è la copertina). */
export async function listCatalogItemPhotos(
  ctx: TenantContext,
  itemId: string,
): Promise<CatalogPhotoDto[]> {
  requirePermission(ctx, 'catalog:read');
  if (!isUuid(itemId)) throw new NotFoundError('CatalogItem');
  const photos = await withTenantContext(getDb(), ctx, async (tx) => {
    const item = await tx.catalogItem.findFirst({
      where: { id: itemId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!item) return null;
    return tx.catalogItemPhoto.findMany({
      where: { tenantId: ctx.tenantId, catalogItemId: itemId, status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });
  if (!photos) return notFound(ctx, 'CatalogItem', itemId);
  return photos.map(toDto);
}

/** Aggiunge una foto (già ricevuta come byte) a un articolo. */
export async function addCatalogItemPhoto(
  ctx: TenantContext,
  itemId: string,
  file: Uint8Array,
  rawInput: unknown,
): Promise<CatalogPhotoDto> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(itemId)) throw new NotFoundError('CatalogItem');
  const parsed = catalogPhotoInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const image = await normalizeUploadedPhoto(file);

  const id = newId();
  const storageKey = `tenants/${ctx.tenantId}/catalog-photos/${id}.jpg`;
  const thumbKey = `tenants/${ctx.tenantId}/catalog-photos/${id}-thumb.jpg`;
  const storage = getObjectStorage();

  const photo = await withTenantContext(getDb(), ctx, async (tx) => {
    // Blocca l'articolo: due caricamenti simultanei non superano il limite di foto.
    const rows = await tx.$queryRaw<{ name: string; type: CatalogItemType; colors: string[] }[]>`
      SELECT "name", "type", "colors" FROM "CatalogItem"
      WHERE "id" = ${itemId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid
      FOR UPDATE`;
    const item = rows[0];
    if (!item) return null;
    if (!allowsPhotos(item.type))
      throw new ValidationError({ file: 'photos_not_allowed_for_type' });
    if (input.color !== null && !item.colors.includes(input.color)) {
      throw new ValidationError({ color: 'invalid_option' });
    }
    const where = { tenantId: ctx.tenantId, catalogItemId: itemId };
    const active = await tx.catalogItemPhoto.count({ where: { ...where, status: 'ACTIVE' } });
    if (active >= PHOTO_LIMITS.perItem) throw new ValidationError({ file: 'too_many_photos' });
    const last = await tx.catalogItemPhoto.aggregate({ where, _max: { sortOrder: true } });

    // Se il salvataggio dei file fallisce la transazione si annulla: nessuna riga orfana.
    await storage.put(storageKey, image.full.bytes, image.full.contentType);
    await storage.put(thumbKey, image.thumb.bytes, image.thumb.contentType);
    const created = await tx.catalogItemPhoto.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        catalogItemId: itemId,
        view: input.view,
        color: input.color,
        storageKey,
        thumbKey,
        contentType: image.full.contentType,
        width: image.full.width,
        height: image.full.height,
        sizeBytes: image.full.bytes.byteLength,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.catalogPhotoAdded,
      entityType: 'CatalogItem',
      entityId: itemId,
      metadata: { photoId: id, name: item.name, view: input.view, color: input.color },
    });
    const queued = await enqueueCutout(tx, ctx, id);
    return queued ? { ...created, cutoutStatus: 'PENDING' as const } : created;
  });
  if (!photo) return notFound(ctx, 'CatalogItem', itemId);
  if (photo.cutoutStatus === 'PENDING') notifyAiWorker();
  return toDto(photo);
}

/**
 * Chiede (di nuovo) lo scontorno: per una foto mai ritagliata o se il servizio ha avuto un
 * problema, al massimo `PHOTO_LIMITS.cutoutRequests` volte per foto. Un ritaglio scartato dal
 * controllo di qualità non si rifà (stessa foto, stesso risultato): serve un'altra foto.
 * Restituisce l'articolo della foto.
 */
export async function requestPhotoCutout(
  ctx: TenantContext,
  photoId: string,
): Promise<{ itemId: string; queued: boolean }> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(photoId)) throw new NotFoundError('CatalogItemPhoto');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const photo = await tx.catalogItemPhoto.findFirst({
      where: { id: photoId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, catalogItemId: true, cutoutStatus: true, cutoutError: true },
    });
    if (!photo) return null;
    if (!canRequestCutout(photo.cutoutStatus, photo.cutoutError)) {
      return { itemId: photo.catalogItemId, queued: false };
    }
    const requests = await tx.aiJob.count({
      where: { tenantId: ctx.tenantId, feature: 'PHOTO_CUTOUT', inputHash: photo.id },
    });
    if (requests >= PHOTO_LIMITS.cutoutRequests) throw new ConflictError('cutout_retry_limit');
    if (!(await enqueueCutout(tx, ctx, photo.id))) throw new ConflictError('cutout_unavailable');
    return { itemId: photo.catalogItemId, queued: true };
  });
  if (!result) return notFound(ctx, 'CatalogItemPhoto', photoId);
  if (result.queued) notifyAiWorker();
  return result;
}

/** Toglie una foto (archiviazione). Restituisce l'articolo a cui apparteneva. */
export async function archiveCatalogItemPhoto(
  ctx: TenantContext,
  photoId: string,
): Promise<{ catalogItemId: string }> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(photoId)) throw new NotFoundError('CatalogItemPhoto');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const photo = await tx.catalogItemPhoto.findFirst({
      where: { id: photoId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, catalogItemId: true, catalogItem: { select: { name: true } } },
    });
    if (!photo) return null;
    await tx.catalogItemPhoto.updateMany({
      where: { id: photo.id, tenantId: ctx.tenantId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.catalogPhotoArchived,
      entityType: 'CatalogItem',
      entityId: photo.catalogItemId,
      metadata: { photoId: photo.id, name: photo.catalogItem.name },
    });
    return { catalogItemId: photo.catalogItemId };
  });
  if (!result) return notFound(ctx, 'CatalogItemPhoto', photoId);
  return result;
}

/** Byte di una foto attiva (grande o miniatura), solo per il tenant che la possiede. */
export async function getCatalogPhotoImage(
  ctx: TenantContext,
  photoId: string,
  variant: PhotoVariant,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  requirePermission(ctx, 'catalog:read');
  if (!isUuid(photoId)) throw new NotFoundError('CatalogItemPhoto');
  const photo = await withTenantContext(getDb(), ctx, (tx) =>
    tx.catalogItemPhoto.findFirst({
      where: { id: photoId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: {
        storageKey: true,
        thumbKey: true,
        contentType: true,
        cutoutStatus: true,
        cutoutKey: true,
      },
    }),
  );
  if (!photo) return notFound(ctx, 'CatalogItemPhoto', photoId);
  if (variant === 'cutout' || variant === 'cutout-thumb') {
    if (photo.cutoutStatus !== 'READY' || !photo.cutoutKey) {
      throw new NotFoundError('CatalogItemPhoto');
    }
    const key = variant === 'cutout' ? photo.cutoutKey : cutoutThumbKey(photo.cutoutKey);
    const bytes = await getObjectStorage().get(key);
    if (!bytes) throw new NotFoundError('CatalogItemPhoto');
    return { bytes, contentType: 'image/png' };
  }
  const bytes = await getObjectStorage().get(
    variant === 'thumb' ? photo.thumbKey : photo.storageKey,
  );
  if (!bytes) throw new NotFoundError('CatalogItemPhoto');
  return { bytes, contentType: photo.contentType };
}
