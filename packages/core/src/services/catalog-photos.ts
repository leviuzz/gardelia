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
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  PHOTO_LIMITS,
  allowsPhotos,
  catalogPhotoInputSchema,
  isUuid,
  newId,
  toFieldErrors,
  type CatalogItemType,
  type CatalogPhotoView,
} from '@floral/domain';
import { getObjectStorage } from '../ai/storage';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { NotFoundError, ValidationError } from '../errors';
import { normalizeUploadedPhoto } from '../media/images';

export interface CatalogPhotoDto {
  readonly id: string;
  readonly catalogItemId: string;
  readonly view: CatalogPhotoView;
  readonly color: string | null;
  readonly width: number;
  readonly height: number;
  readonly createdAt: Date;
}

export type PhotoVariant = 'full' | 'thumb';

function toDto(photo: {
  id: string;
  catalogItemId: string;
  view: CatalogPhotoView;
  color: string | null;
  width: number;
  height: number;
  createdAt: Date;
}): CatalogPhotoDto {
  return {
    id: photo.id,
    catalogItemId: photo.catalogItemId,
    view: photo.view,
    color: photo.color,
    width: photo.width,
    height: photo.height,
    createdAt: photo.createdAt,
  };
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
    return created;
  });
  if (!photo) return notFound(ctx, 'CatalogItem', itemId);
  return toDto(photo);
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
      select: { storageKey: true, thumbKey: true, contentType: true },
    }),
  );
  if (!photo) return notFound(ctx, 'CatalogItemPhoto', photoId);
  const bytes = await getObjectStorage().get(
    variant === 'thumb' ? photo.thumbKey : photo.storageKey,
  );
  if (!bytes) throw new NotFoundError('CatalogItemPhoto');
  return { bytes, contentType: photo.contentType };
}
