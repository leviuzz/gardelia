/**
 * "Mis ramos": foto di ramos fatti dalla fioreria, riferimento di stile per le anteprime AI
 * [AI-BQ-07] (ADR-028, ADR-029).
 *
 *  - Funzione del Builder (piano Plus): `builder:use` per vederle, `builder:references:write`
 *    per caricarle o toglierle, poi `requireEntitlement`.
 *  - Ogni foto registra il consenso esplicito (chi e quando). Le foto servono solo come
 *    riferimento al momento della generazione: mai per addestrare modelli (spec §6.4).
 *  - Mai condivise fra fiorerie; file privati sotto `tenants/{tenantId}/style-references/`.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  PHOTO_LIMITS,
  isUuid,
  newId,
  styleReferenceInputSchema,
  toFieldErrors,
  type BuilderStyle,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { NotFoundError, ValidationError } from '../errors';
import { normalizeUploadedPhoto, type ProcessedImage } from '../media/images';
import { requireEntitlement } from './billing';
import type { PhotoVariant } from './catalog-photos';
import { readStoredImage, storeFilesThenCommit } from '../media/stored-files';

export interface StyleReferenceDto {
  readonly id: string;
  readonly style: BuilderStyle | null;
  readonly caption: string | null;
  /** Stile descritto a parole (spagnolo) dopo la prima anteprima che lo usa; null prima. */
  readonly styleDescriptionEs: string | null;
  readonly width: number;
  readonly height: number;
  readonly consentAt: Date;
  readonly createdAt: Date;
}

function toDto(reference: {
  id: string;
  style: BuilderStyle | null;
  caption: string | null;
  styleDescriptionEs: string | null;
  width: number;
  height: number;
  consentAt: Date;
  createdAt: Date;
}): StyleReferenceDto {
  return {
    id: reference.id,
    style: reference.style,
    caption: reference.caption,
    styleDescriptionEs: reference.styleDescriptionEs,
    width: reference.width,
    height: reference.height,
    consentAt: reference.consentAt,
    createdAt: reference.createdAt,
  };
}

export async function listStyleReferences(ctx: TenantContext): Promise<StyleReferenceDto[]> {
  requirePermission(ctx, 'builder:use');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const references = await tx.styleReferencePhoto.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return references.map(toDto);
  });
}

/**
 * Registra una foto in "Mis ramos" in una transazione già aperta, con i file già salvati: limite
 * di foto attive, consenso di chi carica, audit. La usano il caricamento in "Mis ramos" e la foto
 * vera di un disegno aggiunta anche lì (ADR-052). Il consenso lo ha già controllato chi chiama.
 */
export async function insertStyleReference(
  tx: TransactionClient,
  ctx: TenantContext,
  data: {
    readonly id: string;
    readonly style: BuilderStyle | null;
    readonly caption: string | null;
    readonly storageKey: string;
    readonly thumbKey: string;
    readonly image: ProcessedImage;
  },
): Promise<StyleReferenceDto> {
  // Serializza i caricamenti della stessa fioreria: il limite non si supera.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`floral:style-ref:${ctx.tenantId}`}))`;
  const active = await tx.styleReferencePhoto.count({
    where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
  });
  if (active >= PHOTO_LIMITS.references) throw new ValidationError({ file: 'too_many_photos' });

  const now = new Date();
  const created = await tx.styleReferencePhoto.create({
    data: {
      id: data.id,
      tenantId: ctx.tenantId,
      style: data.style,
      caption: data.caption,
      storageKey: data.storageKey,
      thumbKey: data.thumbKey,
      contentType: data.image.contentType,
      width: data.image.width,
      height: data.image.height,
      sizeBytes: data.image.bytes.byteLength,
      consentAt: now,
      consentById: ctx.userId,
      createdById: ctx.userId,
    },
  });
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.styleReferenceAdded,
    entityType: 'StyleReferencePhoto',
    entityId: data.id,
    metadata: { style: data.style, consent: true },
  });
  return toDto(created);
}

/** Aggiunge una foto a "Mis ramos": senza consenso esplicito non si salva nulla. */
export async function addStyleReference(
  ctx: TenantContext,
  file: Uint8Array,
  rawInput: unknown,
): Promise<StyleReferenceDto> {
  requirePermission(ctx, 'builder:references:write');
  const parsed = styleReferenceInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await requireEntitlement(ctx, 'bouquetBuilder');
  const image = await normalizeUploadedPhoto(file);

  const id = newId();
  const storageKey = `tenants/${ctx.tenantId}/style-references/${id}.jpg`;
  const thumbKey = `tenants/${ctx.tenantId}/style-references/${id}-thumb.jpg`;
  // File salvati PRIMA della transazione (che resta breve) e cancellati se non va a buon fine.
  const files = [
    { key: storageKey, bytes: image.full.bytes, contentType: image.full.contentType },
    { key: thumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
  ];
  const reference = await storeFilesThenCommit(files, () =>
    withTenantContext(getDb(), ctx, async (tx) => {
      await requireEntitlement(ctx, 'bouquetBuilder', tx);
      return insertStyleReference(tx, ctx, {
        id,
        style: input.style,
        caption: input.caption,
        storageKey,
        thumbKey,
        image: image.full,
      });
    }),
  );
  // La transazione restituisce il record oppure lancia un errore: null non è possibile.
  if (!reference) throw new Error('foto di "Mis ramos" non registrata');
  return reference;
}

export async function archiveStyleReference(
  ctx: TenantContext,
  referenceId: string,
): Promise<void> {
  requirePermission(ctx, 'builder:references:write');
  if (!isUuid(referenceId)) throw new NotFoundError('StyleReferencePhoto');
  const archived = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    const result = await tx.styleReferencePhoto.updateMany({
      where: { id: referenceId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    if (result.count === 0) return false;
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.styleReferenceArchived,
      entityType: 'StyleReferencePhoto',
      entityId: referenceId,
    });
    return true;
  });
  if (!archived) await notFound(ctx, 'StyleReferencePhoto', referenceId);
}

export async function getStyleReferenceImage(
  ctx: TenantContext,
  referenceId: string,
  variant: PhotoVariant,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  requirePermission(ctx, 'builder:use');
  if (!isUuid(referenceId)) throw new NotFoundError('StyleReferencePhoto');
  const reference = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'bouquetBuilder', tx);
    return tx.styleReferencePhoto.findFirst({
      where: { id: referenceId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { storageKey: true, thumbKey: true, contentType: true },
    });
  });
  if (!reference) return notFound(ctx, 'StyleReferencePhoto', referenceId);
  return readStoredImage(
    variant === 'thumb' ? reference.thumbKey : reference.storageKey,
    reference.contentType,
    'StyleReferencePhoto',
  );
}
