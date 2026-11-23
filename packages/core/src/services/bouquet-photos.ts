/**
 * Foto vera del ramo di un disegno del Diseñador (ADR-052, spec FLOW-B passo 6): la fioreria
 * carica la foto del suo ramo invece di generarla con l'AI.
 *
 *  - Chi usa il Builder (`builder:use`, anche lo staff) carica, cambia o toglie la foto; serve il
 *    piano con il Builder. Una sola foto attiva per disegno: cambiandola, la precedente si
 *    archivia e resta ai preventivi che la mostrano.
 *  - Facoltativamente la stessa foto entra anche in "Mis ramos" (riferimento di stile per le
 *    anteprime AI): solo per chi può caricare lì (`builder:references:write`) e con lo stesso
 *    consenso esplicito. Mai per addestrare modelli (spec §6.4).
 *  - I preventivi creati dal disegno mostrano questa foto al posto dell'anteprima AI.
 *  - File privati sotto `tenants/{tenantId}/bouquet-photos/`; mai condivisi fra fiorerie.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  PHOTO_LIMITS,
  bouquetPhotoInputSchema,
  isUuid,
  newId,
  toFieldErrors,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { normalizeUploadedPhoto } from '../media/images';
import { readStoredImage, storeFilesThenCommit } from '../media/stored-files';
import { requireEntitlement } from './billing';
import type { PhotoVariant } from './catalog-photos';
import { insertStyleReference } from './style-references';

export interface BouquetPhotoDto {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly createdAt: Date;
}

export interface AddedBouquetPhoto {
  readonly photo: BouquetPhotoDto;
  /** true se la foto è entrata anche in "Mis ramos". */
  readonly addedToReferences: boolean;
}

/**
 * Carica (o cambia) la foto vera del ramo di un disegno attivo. Con `addToReferences` la stessa
 * foto entra anche in "Mis ramos", come copia indipendente: archiviarla lì non tocca il disegno e
 * viceversa.
 */
export async function addBouquetPhoto(
  ctx: TenantContext,
  configurationId: string,
  file: Uint8Array,
  rawInput: unknown,
): Promise<AddedBouquetPhoto> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');
  const parsed = bouquetPhotoInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  if (input.addToReferences) requirePermission(ctx, 'builder:references:write');
  await requireEntitlement(ctx, 'bouquetBuilder');
  const image = await normalizeUploadedPhoto(file);

  const id = newId();
  const storageKey = `tenants/${ctx.tenantId}/bouquet-photos/${id}.jpg`;
  const thumbKey = `tenants/${ctx.tenantId}/bouquet-photos/${id}-thumb.jpg`;
  const referenceId = input.addToReferences ? newId() : null;
  const referenceKeys = referenceId
    ? {
        storageKey: `tenants/${ctx.tenantId}/style-references/${referenceId}.jpg`,
        thumbKey: `tenants/${ctx.tenantId}/style-references/${referenceId}-thumb.jpg`,
      }
    : null;
  // File salvati PRIMA della transazione (che resta breve) e cancellati se non va a buon fine.
  const files = [
    { key: storageKey, bytes: image.full.bytes, contentType: image.full.contentType },
    { key: thumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
    ...(referenceKeys
      ? [
          {
            key: referenceKeys.storageKey,
            bytes: image.full.bytes,
            contentType: image.full.contentType,
          },
          {
            key: referenceKeys.thumbKey,
            bytes: image.thumb.bytes,
            contentType: image.thumb.contentType,
          },
        ]
      : []),
  ];
  const added = await storeFilesThenCommit(files, () =>
    withTenantContext(getDb(), ctx, async (tx) => {
      await requireEntitlement(ctx, 'bouquetBuilder', tx);
      const config = await tx.bouquetConfiguration.findFirst({
        where: { id: configurationId, tenantId: ctx.tenantId },
        select: { id: true, name: true, style: true, status: true },
      });
      if (!config) return null;
      if (config.status !== 'ACTIVE') throw new ConflictError('builder_configuration_archived');
      // La foto precedente si archivia: i preventivi che la mostrano la tengono.
      const replaced = await tx.bouquetPhoto.updateMany({
        where: { tenantId: ctx.tenantId, configurationId: config.id, status: 'ACTIVE' },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
      const created = await tx.bouquetPhoto.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          configurationId: config.id,
          storageKey,
          thumbKey,
          contentType: image.full.contentType,
          width: image.full.width,
          height: image.full.height,
          sizeBytes: image.full.bytes.byteLength,
          createdById: ctx.userId,
        },
      });
      if (referenceId && referenceKeys) {
        await insertStyleReference(tx, ctx, {
          id: referenceId,
          style: config.style,
          caption: config.name.slice(0, PHOTO_LIMITS.caption),
          ...referenceKeys,
          image: image.full,
        });
      }
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.builderPhotoAdded,
        entityType: 'BouquetConfiguration',
        entityId: config.id,
        metadata: {
          name: config.name,
          photoId: id,
          replaced: replaced.count > 0,
          addedToReferences: referenceId !== null,
          // La casella di "Mis ramos" riporta il consenso: spuntata = consenso esplicito.
          consent: referenceId !== null,
        },
      });
      return {
        photo: {
          id: created.id,
          width: created.width,
          height: created.height,
          createdAt: created.createdAt,
        },
        addedToReferences: referenceId !== null,
      };
    }),
  );
  if (!added) return notFound(ctx, 'BouquetConfiguration', configurationId);
  return added;
}

/** Toglie la foto vera dal disegno (si archivia: i preventivi che la mostrano la tengono). */
export async function removeBouquetPhoto(
  ctx: TenantContext,
  configurationId: string,
): Promise<void> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const config = await tx.bouquetConfiguration.findFirst({
      where: { id: configurationId, tenantId: ctx.tenantId },
      select: { id: true, name: true, status: true },
    });
    if (!config) return false;
    if (config.status !== 'ACTIVE') throw new ConflictError('builder_configuration_archived');
    const removed = await tx.bouquetPhoto.updateMany({
      where: { tenantId: ctx.tenantId, configurationId: config.id, status: 'ACTIVE' },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    if (removed.count > 0) {
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.builderPhotoRemoved,
        entityType: 'BouquetConfiguration',
        entityId: config.id,
        metadata: { name: config.name },
      });
    }
    return true;
  });
  if (!found) await notFound(ctx, 'BouquetConfiguration', configurationId);
}

/** Byte della foto attiva di un disegno (pagina del Diseñador), solo per la sua fioreria. */
export async function getBouquetPhotoImage(
  ctx: TenantContext,
  photoId: string,
  variant: PhotoVariant,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(photoId)) throw new NotFoundError('BouquetPhoto');
  const photo = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    return tx.bouquetPhoto.findFirst({
      where: { id: photoId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { storageKey: true, thumbKey: true, contentType: true },
    });
  });
  if (!photo) return notFound(ctx, 'BouquetPhoto', photoId);
  return readStoredImage(
    variant === 'thumb' ? photo.thumbKey : photo.storageKey,
    photo.contentType,
    'BouquetPhoto',
  );
}
