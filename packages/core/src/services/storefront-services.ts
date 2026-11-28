/**
 * Marketplace M5 «Servizi in vetrina e richieste» (ADR-089), il lato della fioreria: Impostazioni →
 * Negozio online → «Servizi in vetrina». I quattro predefiniti esistono sempre per chi guarda (la
 * riga si crea al primo salvataggio, alla pubblicazione o alla prima foto); i servizi della fioreria
 * si creano, si cambiano, si ordinano e si archiviano. Proprietario e gerente
 * (`tenant:settings:update`); nel registro tipi e ID, mai i testi.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  STOREFRONT_SERVICE_LIMITS,
  STOREFRONT_SERVICE_PRESETS,
  isPresetServiceKind,
  isUuid,
  newId,
  storefrontServicePublishProblem,
  storefrontServiceSchema,
  toFieldErrors,
  type CurrencyCode,
  type StorefrontServiceKind,
  type StorefrontServicePreset,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { normalizeUploadedPhoto } from '../media/images';
import { readStoredImage, storeFilesThenCommit, type StoredImage } from '../media/stored-files';
import { tenantEntitlementsTx } from './billing';
import { loadCareSettings } from './care-internals';

export interface StorefrontServicePhotoDto {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface StorefrontServiceDto {
  /** Null per un predefinito mai salvato (si mostra spento, con i testi vuoti). */
  readonly id: string | null;
  readonly kind: StorefrontServiceKind;
  /** Solo per i servizi della fioreria; i predefiniti hanno il nome dalla lingua. */
  readonly name: string | null;
  readonly description: string | null;
  readonly includes: string | null;
  readonly priceFromMinor: number | null;
  readonly askDate: boolean;
  readonly askAddress: boolean;
  readonly isPublished: boolean;
  readonly photos: readonly StorefrontServicePhotoDto[];
}

export interface StorefrontServicesSettingsDto {
  readonly currency: string;
  /** I quattro predefiniti, sempre, nell'ordine della vetrina. */
  readonly presets: readonly StorefrontServiceDto[];
  /** I servizi della fioreria attivi, nell'ordine della vetrina. */
  readonly custom: readonly StorefrontServiceDto[];
  /** L'offerta di Floral Care è pronta (tariffe e almeno una fascia): si può pubblicare. */
  readonly careReady: boolean;
  readonly canEdit: boolean;
}

/**
 * L'offerta di Floral Care pronta: compresa nel piano, tariffe salvate con almeno una frequenza e
 * almeno una fascia attiva (come `getCareSetupStatus`).
 */
export async function careOfferReadyTx(tx: TransactionClient, tenantId: string): Promise<boolean> {
  const [entitlements, settings, slots] = await Promise.all([
    tenantEntitlementsTx(tx, tenantId),
    loadCareSettings(tx, tenantId),
    tx.careSlot.count({ where: { tenantId, status: 'ACTIVE' } }),
  ]);
  return (
    entitlements.floralCare && settings !== null && settings.frequencies.length > 0 && slots > 0
  );
}

const SERVICE_SELECT = {
  id: true,
  kind: true,
  name: true,
  description: true,
  includes: true,
  priceFromMinor: true,
  askDate: true,
  askAddress: true,
  isPublished: true,
  sortOrder: true,
  photos: {
    where: { status: 'ACTIVE' },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, width: true, height: true },
  },
} satisfies Prisma.StorefrontServiceSelect;

type ServiceRow = {
  readonly id: string;
  readonly kind: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly includes: string | null;
  readonly priceFromMinor: number | null;
  readonly askDate: boolean;
  readonly askAddress: boolean;
  readonly isPublished: boolean;
  readonly photos: readonly StorefrontServicePhotoDto[];
};

function toDto(row: ServiceRow): StorefrontServiceDto {
  return {
    id: row.id,
    kind: row.kind as StorefrontServiceKind,
    name: row.name,
    description: row.description,
    includes: row.includes,
    priceFromMinor: row.priceFromMinor,
    askDate: row.askDate,
    askAddress: row.askAddress,
    isPublished: row.isPublished,
    photos: row.photos,
  };
}

function emptyPreset(kind: StorefrontServicePreset): StorefrontServiceDto {
  return {
    id: null,
    kind,
    name: null,
    description: null,
    includes: null,
    priceFromMinor: null,
    askDate: false,
    askAddress: false,
    isPublished: false,
    photos: [],
  };
}

/** I servizi della vetrina per la scheda delle Impostazioni. */
export async function getStorefrontServicesSettings(
  ctx: TenantContext,
): Promise<StorefrontServicesSettingsDto> {
  requirePermission(ctx, 'tenant:read');
  return withTenantContext(getDb(), ctx, async (tx) => {
    const [rows, careReady] = await Promise.all([
      tx.storefrontService.findMany({
        where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: SERVICE_SELECT,
      }),
      careOfferReadyTx(tx, ctx.tenantId),
    ]);
    const byKind = new Map(
      rows.filter((row) => row.kind !== 'CUSTOM').map((row) => [row.kind, row]),
    );
    return {
      currency: ctx.currency,
      presets: STOREFRONT_SERVICE_PRESETS.map((kind) => {
        const row = byKind.get(kind);
        return row ? toDto(row) : emptyPreset(kind);
      }),
      custom: rows.filter((row) => row.kind === 'CUSTOM').map(toDto),
      careReady,
      canEdit: hasPermission(ctx, 'tenant:settings:update'),
    };
  });
}

/** Un servizio da cambiare: un predefinito (per tipo) o uno della fioreria (per ID). */
export type StorefrontServiceTarget =
  { readonly kind: StorefrontServicePreset } | { readonly serviceId: string };

/** Il prossimo posto di un servizio della fioreria: dopo l'ultimo, sempre dopo i predefiniti. */
async function nextCustomSortOrderTx(tx: TransactionClient, tenantId: string): Promise<number> {
  const last = await tx.storefrontService.aggregate({
    where: { tenantId, kind: 'CUSTOM', status: 'ACTIVE' },
    _max: { sortOrder: true },
  });
  return Math.max((last._max.sortOrder ?? -1) + 1, STOREFRONT_SERVICE_PRESETS.length);
}

/**
 * La riga del servizio bloccata (`FOR UPDATE`): per un predefinito la crea se manca (spenta), con
 * l'indice unico che regge a due creazioni insieme. Null se l'ID non è della fioreria.
 */
async function lockServiceTx(
  tx: TransactionClient,
  ctx: TenantContext,
  target: StorefrontServiceTarget,
): Promise<{
  readonly id: string;
  readonly kind: StorefrontServiceKind;
  readonly isPublished: boolean;
} | null> {
  if ('kind' in target) {
    await tx.storefrontService.createMany({
      data: [
        {
          tenantId: ctx.tenantId,
          kind: target.kind,
          sortOrder: STOREFRONT_SERVICE_PRESETS.indexOf(target.kind),
        },
      ],
      skipDuplicates: true,
    });
    const rows = await tx.$queryRaw<{ id: string; kind: string; isPublished: boolean }[]>`
      SELECT "id", "kind", "isPublished" FROM "StorefrontService"
      WHERE "tenantId" = ${ctx.tenantId}::uuid AND "kind" = ${target.kind} FOR UPDATE`;
    const row = rows[0];
    return row ? { ...row, kind: row.kind as StorefrontServiceKind } : null;
  }
  if (!isUuid(target.serviceId)) return null;
  const rows = await tx.$queryRaw<{ id: string; kind: string; isPublished: boolean }[]>`
    SELECT "id", "kind", "isPublished" FROM "StorefrontService"
    WHERE "tenantId" = ${ctx.tenantId}::uuid AND "id" = ${target.serviceId}::uuid
      AND "status" = 'ACTIVE' FOR UPDATE`;
  const row = rows[0];
  return row ? { ...row, kind: row.kind as StorefrontServiceKind } : null;
}

function missingTarget(ctx: TenantContext, target: StorefrontServiceTarget): Promise<never> {
  return 'serviceId' in target
    ? notFound(ctx, 'StorefrontService', target.serviceId)
    : Promise.reject(new NotFoundError('StorefrontService'));
}

/** I testi di un servizio (descrizione, cosa include, «da $X»; nome e domande se è della fioreria). */
export async function saveStorefrontService(
  ctx: TenantContext,
  target: StorefrontServiceTarget,
  rawInput: unknown,
): Promise<{ readonly id: string }> {
  requirePermission(ctx, 'tenant:settings:update');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const service = await lockServiceTx(tx, ctx, target);
    if (!service) return null;
    const parsed = storefrontServiceSchema(ctx.currency as CurrencyCode, service.kind).safeParse(
      rawInput ?? {},
    );
    if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
    const input = parsed.data;
    await tx.storefrontService.update({
      where: { id: service.id, tenantId: ctx.tenantId },
      data: {
        name: input.name,
        description: input.description,
        includes: input.includes,
        priceFromMinor: input.priceFrom,
        askDate: input.askDate,
        askAddress: input.askAddress,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.storefrontServiceSaved,
      entityType: 'StorefrontService',
      entityId: service.id,
      metadata: { kind: service.kind, withPrice: input.priceFrom !== null },
    });
    return { id: service.id };
  });
  if (!result) return missingTarget(ctx, target);
  return result;
}

/** «Nuovo servizio»: un servizio della fioreria, spento finché non lo pubblica. */
export async function createStorefrontService(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ readonly id: string }> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = storefrontServiceSchema(ctx.currency as CurrencyCode, 'CUSTOM').safeParse(
    rawInput ?? {},
  );
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  return withTenantContext(getDb(), ctx, async (tx) => {
    // Un servizio nuovo alla volta per fioreria: il limite regge a due invii insieme.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`storefront-services:${ctx.tenantId}`}))`;
    const count = await tx.storefrontService.count({
      where: { tenantId: ctx.tenantId, kind: 'CUSTOM', status: 'ACTIVE' },
    });
    if (count >= STOREFRONT_SERVICE_LIMITS.customPerShop) {
      throw new ConflictError('storefront_services_limit');
    }
    const created = await tx.storefrontService.create({
      data: {
        tenantId: ctx.tenantId,
        kind: 'CUSTOM',
        name: input.name,
        description: input.description,
        includes: input.includes,
        priceFromMinor: input.priceFrom,
        askDate: input.askDate,
        askAddress: input.askAddress,
        sortOrder: await nextCustomSortOrderTx(tx, ctx.tenantId),
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.storefrontServiceSaved,
      entityType: 'StorefrontService',
      entityId: created.id,
      metadata: { kind: 'CUSTOM', created: true },
    });
    return created;
  });
}

/** Accende o spegne un servizio in vetrina; Floral Care solo con l'offerta pronta. */
export async function setStorefrontServicePublished(
  ctx: TenantContext,
  target: StorefrontServiceTarget,
  published: boolean,
): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const service = await lockServiceTx(tx, ctx, target);
    if (!service) return null;
    if (service.isPublished === published) return { done: true };
    if (published) {
      const problem = storefrontServicePublishProblem({
        kind: service.kind,
        careReady: service.kind === 'CARE' ? await careOfferReadyTx(tx, ctx.tenantId) : true,
      });
      if (problem) throw new ConflictError(problem);
    }
    await tx.storefrontService.update({
      where: { id: service.id, tenantId: ctx.tenantId },
      data: { isPublished: published },
    });
    await recordAudit(tx, ctx, {
      action: published
        ? AUDIT_ACTIONS.storefrontServicePublished
        : AUDIT_ACTIONS.storefrontServiceUnpublished,
      entityType: 'StorefrontService',
      entityId: service.id,
      metadata: { kind: service.kind },
    });
    return { done: true };
  });
  if (!result) return missingTarget(ctx, target);
}

/**
 * Sposta un servizio della fioreria di un posto (prima o dopo il vicino). In vetrina i predefiniti
 * vengono sempre prima, nel loro ordine; i servizi della fioreria dopo, nell'ordine scelto qui.
 */
export async function moveStorefrontService(
  ctx: TenantContext,
  serviceId: string,
  direction: 'up' | 'down',
): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  if (!isUuid(serviceId)) throw new NotFoundError('StorefrontService');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`storefront-services:${ctx.tenantId}`}))`;
    const rows = await tx.storefrontService.findMany({
      where: { tenantId: ctx.tenantId, kind: 'CUSTOM', status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const index = rows.findIndex((row) => row.id === serviceId);
    if (index < 0) return null;
    const other = direction === 'up' ? index - 1 : index + 1;
    if (other < 0 || other >= rows.length) return { moved: false };
    const order = rows.map((row) => row.id);
    [order[index], order[other]] = [order[other]!, order[index]!];
    // Posti di nuovo in fila dopo i predefiniti: due servizi non restano mai allo stesso posto.
    for (const [position, id] of order.entries()) {
      await tx.storefrontService.updateMany({
        where: { id, tenantId: ctx.tenantId },
        data: { sortOrder: STOREFRONT_SERVICE_PRESETS.length + position },
      });
    }
    return { moved: true };
  });
  if (!result) return notFound(ctx, 'StorefrontService', serviceId);
}

/** Archivia un servizio della fioreria (i predefiniti si spengono soltanto); le richieste restano. */
export async function archiveStorefrontService(
  ctx: TenantContext,
  serviceId: string,
): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const service = await lockServiceTx(tx, ctx, { serviceId });
    if (!service) return null;
    if (isPresetServiceKind(service.kind)) throw new ConflictError('storefront_service_preset');
    await tx.storefrontService.update({
      where: { id: service.id, tenantId: ctx.tenantId },
      data: { status: 'ARCHIVED', archivedAt: new Date(), isPublished: false },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.storefrontServiceArchived,
      entityType: 'StorefrontService',
      entityId: service.id,
      metadata: { kind: service.kind },
    });
    return { done: true };
  });
  if (!result) return notFound(ctx, 'StorefrontService', serviceId);
}

/** Una foto del servizio (fino a 6): ricodificata senza EXIF, salvata prima della transazione. */
export async function addStorefrontServicePhoto(
  ctx: TenantContext,
  target: StorefrontServiceTarget,
  file: Uint8Array,
): Promise<{ readonly serviceId: string; readonly photoId: string }> {
  requirePermission(ctx, 'tenant:settings:update');
  if ('serviceId' in target && !isUuid(target.serviceId)) {
    throw new NotFoundError('StorefrontService');
  }
  const image = await normalizeUploadedPhoto(file);
  const id = newId();
  const storageKey = `tenants/${ctx.tenantId}/storefront-services/${id}.jpg`;
  const thumbKey = `tenants/${ctx.tenantId}/storefront-services/${id}-thumb.jpg`;
  const files = [
    { key: storageKey, bytes: image.full.bytes, contentType: image.full.contentType },
    { key: thumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
  ];
  const result = await storeFilesThenCommit(files, () =>
    withTenantContext(getDb(), ctx, async (tx) => {
      const service = await lockServiceTx(tx, ctx, target);
      if (!service) return null;
      const where = { tenantId: ctx.tenantId, serviceId: service.id };
      const active = await tx.storefrontServicePhoto.count({
        where: { ...where, status: 'ACTIVE' },
      });
      if (active >= STOREFRONT_SERVICE_LIMITS.photos) {
        throw new ValidationError({ file: 'too_many_photos' });
      }
      const last = await tx.storefrontServicePhoto.aggregate({ where, _max: { sortOrder: true } });
      await tx.storefrontServicePhoto.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          serviceId: service.id,
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
        action: AUDIT_ACTIONS.storefrontServicePhotoAdded,
        entityType: 'StorefrontService',
        entityId: service.id,
        metadata: { kind: service.kind, photoId: id },
      });
      return { serviceId: service.id, photoId: id };
    }),
  );
  if (!result) return missingTarget(ctx, target);
  return result;
}

/** Toglie una foto del servizio (archiviata: i file restano per le pagine già aperte). */
export async function removeStorefrontServicePhoto(
  ctx: TenantContext,
  photoId: string,
): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  if (!isUuid(photoId)) throw new NotFoundError('StorefrontServicePhoto');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const photo = await tx.storefrontServicePhoto.findFirst({
      where: { id: photoId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, serviceId: true, service: { select: { kind: true } } },
    });
    if (!photo) return null;
    await tx.storefrontServicePhoto.updateMany({
      where: { id: photo.id, tenantId: ctx.tenantId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.storefrontServicePhotoRemoved,
      entityType: 'StorefrontService',
      entityId: photo.serviceId,
      metadata: { kind: photo.service.kind, photoId: photo.id },
    });
    return { done: true };
  });
  if (!result) return notFound(ctx, 'StorefrontServicePhoto', photoId);
}

/** Una foto attiva di un servizio, per le Impostazioni (grande o miniatura). */
export async function getStorefrontServicePhotoImage(
  ctx: TenantContext,
  photoId: string,
  variant: 'full' | 'thumb',
): Promise<StoredImage> {
  requirePermission(ctx, 'tenant:read');
  if (!isUuid(photoId)) throw new NotFoundError('StorefrontServicePhoto');
  const photo = await withTenantContext(getDb(), ctx, (tx) =>
    tx.storefrontServicePhoto.findFirst({
      where: { id: photoId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { storageKey: true, thumbKey: true, contentType: true },
    }),
  );
  if (!photo) return notFound(ctx, 'StorefrontServicePhoto', photoId);
  return readStoredImage(
    variant === 'thumb' ? photo.thumbKey : photo.storageKey,
    photo.contentType,
    'StorefrontServicePhoto',
  );
}
