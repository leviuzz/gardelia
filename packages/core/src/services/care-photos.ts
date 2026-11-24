/**
 * Foto delle visite di Floral Care (ADR-078). Chi fa la visita (`care:visit`, anche lo staff) le
 * carica una alla volta mentre è in corso: ridotte e senza dati EXIF (posizione GPS), file privati
 * sotto `tenants/{tenantId}/care-photos/<contratto>-<foto>.jpg`. `uploadKey`: un nuovo tentativo
 * dello stesso file (segnale che va e viene) non crea una seconda foto.
 *
 * Togliere una foto (decisione del founder, eccezione alla regola "niente cancellazioni" accanto ad
 * ADR-051): la riga resta, segnata come tolta, e i file si cancellano subito dopo il commit; se lo
 * storage non risponde ci riprova il lavoro giornaliero. A fine contratto + 30 giorni li cancella
 * il lavoro di `jobs/care.ts`.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_VISIT_LIMITS,
  canWorkOnCareVisit,
  carePhotoUploadSchema,
  formatSubscriptionNumber,
  isUuid,
  newId,
  toFieldErrors,
} from '@floral/domain';
import { getObjectStorage } from '../ai/storage';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { normalizeUploadedPhoto } from '../media/images';
import {
  deleteUnusedFiles,
  readStoredImage,
  storeFilesThenCommit,
  type StoredImage,
} from '../media/stored-files';
import { requireEntitlement } from './billing';
import type { PhotoVariant } from './catalog-photos';
import { isoOf } from './care-internals';
import { lockCareVisit } from './care-visit-internals';

export interface CarePhotoUploadResult {
  readonly id: string;
  /** Lo stesso file era già arrivato (nuovo tentativo): nessuna foto in più. */
  readonly duplicate: boolean;
}

/** Una foto della visita in corso, eventualmente legata a una pianta del contratto. */
export async function addCareVisitPhoto(
  ctx: TenantContext,
  visitId: string,
  file: Uint8Array,
  rawInput: unknown,
): Promise<CarePhotoUploadResult> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const parsed = carePhotoUploadSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;

  // Prima un controllo veloce, così una foto rifiutata non si elabora né si carica.
  const precheck = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await tx.careVisit.findFirst({
      where: { tenantId: ctx.tenantId, id: visitId },
      select: { id: true, status: true, subscriptionId: true },
    });
    if (!visit) return null;
    const existing = await tx.carePhoto.findFirst({
      where: { tenantId: ctx.tenantId, visitId: visit.id, uploadKey: input.uploadKey },
      select: { id: true },
    });
    if (existing) return { duplicate: existing.id, subscriptionId: visit.subscriptionId };
    if (!canWorkOnCareVisit(visit.status)) throw new ConflictError('care_visit_not_in_progress');
    const count = await tx.carePhoto.count({
      where: { tenantId: ctx.tenantId, visitId: visit.id, removedAt: null },
    });
    if (count >= CARE_VISIT_LIMITS.photos) throw new ConflictError('care_photo_limit');
    if (input.plantId !== null) {
      const plant = await tx.carePlant.findFirst({
        where: { tenantId: ctx.tenantId, subscriptionId: visit.subscriptionId, id: input.plantId },
        select: { id: true },
      });
      if (!plant) throw new ValidationError({ plantId: 'invalid_option' });
    }
    return { duplicate: null, subscriptionId: visit.subscriptionId };
  });
  if (!precheck) return notFound(ctx, 'CareVisit', visitId);
  if (precheck.duplicate) return { id: precheck.duplicate, duplicate: true };

  const image = await normalizeUploadedPhoto(file);
  const id = newId();
  const storageKey = `tenants/${ctx.tenantId}/care-photos/${precheck.subscriptionId}-${id}.jpg`;
  const thumbKey = `tenants/${ctx.tenantId}/care-photos/${precheck.subscriptionId}-${id}-thumb.jpg`;
  // File salvati PRIMA della transazione (che resta breve) e cancellati se non va a buon fine.
  const saved = await storeFilesThenCommit(
    [
      { key: storageKey, bytes: image.full.bytes, contentType: image.full.contentType },
      { key: thumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
    ],
    () =>
      withTenantContext(getDb(), ctx, async (tx) => {
        const visit = await lockCareVisit(tx, ctx, visitId);
        if (!visit) return null;
        // Sotto il blocco della visita: due tentativi insieme dello stesso file si mettono in fila.
        const existing = await tx.carePhoto.findFirst({
          where: { tenantId: ctx.tenantId, visitId: visit.id, uploadKey: input.uploadKey },
          select: { id: true },
        });
        if (existing) return { id: existing.id, duplicate: true };
        if (!canWorkOnCareVisit(visit.status)) {
          throw new ConflictError('care_visit_not_in_progress');
        }
        const count = await tx.carePhoto.count({
          where: { tenantId: ctx.tenantId, visitId: visit.id, removedAt: null },
        });
        if (count >= CARE_VISIT_LIMITS.photos) throw new ConflictError('care_photo_limit');
        await tx.carePhoto.create({
          data: {
            id,
            tenantId: ctx.tenantId,
            subscriptionId: visit.subscriptionId,
            visitId: visit.id,
            plantId: input.plantId,
            storageKey,
            thumbKey,
            contentType: image.full.contentType,
            width: image.full.width,
            height: image.full.height,
            sizeBytes: image.full.bytes.byteLength,
            uploadKey: input.uploadKey,
            createdById: ctx.userId,
          },
        });
        return { id, duplicate: false };
      }),
  );
  if (!saved) return notFound(ctx, 'CareVisit', visitId);
  // Doppione arrivato insieme: la foto c'era già, i file appena caricati non servono.
  if (saved.duplicate) await deleteUnusedFiles([storageKey, thumbKey]);
  return saved;
}

/**
 * Cancella i file di una foto dallo storage. Vero solo se entrambi sono andati: altrimenti ci
 * riprova il lavoro giornaliero (la riga resta senza `deletedAt`).
 */
export async function deleteCarePhotoFiles(photo: {
  readonly id: string;
  readonly storageKey: string;
  readonly thumbKey: string;
}): Promise<boolean> {
  const storage = getObjectStorage();
  try {
    await storage.delete(photo.storageKey);
    await storage.delete(photo.thumbKey);
    return true;
  } catch (error) {
    logger.warn(
      { err: error, photoId: photo.id },
      'file di una foto di Floral Care non cancellati',
    );
    return false;
  }
}

/**
 * Togli una foto: durante la visita chi la fa; dopo la chiusura solo chi gestisce i contratti (per
 * esempio una foto con una persona). I file si cancellano subito.
 */
export async function removeCareVisitPhoto(
  ctx: TenantContext,
  visitId: string,
  photoId: string,
): Promise<void> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  if (!isUuid(photoId)) throw new NotFoundError('CarePhoto');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const visit = await lockCareVisit(tx, ctx, visitId);
    if (!visit) return { kind: 'missing', entity: 'CareVisit' } as const;
    const photo = await tx.carePhoto.findFirst({
      where: { tenantId: ctx.tenantId, id: photoId, visitId: visit.id },
      select: { id: true, storageKey: true, thumbKey: true, removedAt: true },
    });
    if (!photo) return { kind: 'missing', entity: 'CarePhoto' } as const;
    if (photo.removedAt) return { kind: 'already' } as const;
    if (!canWorkOnCareVisit(visit.status) && !hasPermission(ctx, 'subscriptions:write')) {
      throw new ConflictError('care_photo_locked');
    }
    await tx.carePhoto.update({
      where: { id: photo.id, tenantId: ctx.tenantId },
      data: { removedAt: new Date(), removedById: ctx.userId },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careVisitPhotoRemoved,
      entityType: 'CareVisit',
      entityId: visit.id,
      metadata: {
        number: formatSubscriptionNumber(visit.subscription.number),
        date: isoOf(visit.scheduledDate),
        photoId: photo.id,
      },
    });
    return { kind: 'removed', photo } as const;
  });
  if (result.kind === 'missing') {
    return notFound(ctx, result.entity, result.entity === 'CareVisit' ? visitId : photoId);
  }
  if (result.kind === 'already') return;
  if (await deleteCarePhotoFiles(result.photo)) {
    await withTenantContext(getDb(), ctx, (tx) =>
      tx.carePhoto.updateMany({
        where: { tenantId: ctx.tenantId, id: photoId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );
  }
}

/** Una foto visibile della visita (`thumb` = miniatura). */
export async function getCareVisitPhotoImage(
  ctx: TenantContext,
  visitId: string,
  photoId: string,
  variant: PhotoVariant,
): Promise<StoredImage> {
  requirePermission(ctx, 'subscriptions:read');
  if (!isUuid(visitId) || !isUuid(photoId)) throw new NotFoundError('CarePhoto');
  const photo = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    return tx.carePhoto.findFirst({
      where: { tenantId: ctx.tenantId, id: photoId, visitId, removedAt: null, deletedAt: null },
      select: { storageKey: true, thumbKey: true, contentType: true },
    });
  });
  if (!photo) return notFound(ctx, 'CarePhoto', photoId);
  return readStoredImage(
    variant === 'thumb' ? photo.thumbKey : photo.storageKey,
    photo.contentType,
    'CarePhoto',
  );
}
