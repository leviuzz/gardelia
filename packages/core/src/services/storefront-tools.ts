/**
 * Strumenti della vetrina per la fioreria (marketplace, blocco M1, ADR-087): prodotti in evidenza,
 * ordine delle foto, politiche e il limite dei prodotti online. Le regole stanno nel dominio
 * (`storefront.ts`, `online-store.ts`); qui permessi, lock e registro.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  ONLINE_ITEM_TYPES,
  STORE_LIMITS,
  STORE_POLICY_FIELDS,
  canShowOnline,
  isPhotoMove,
  isUuid,
  movePhotoId,
  parseCatalogBulkIds,
  storePoliciesSchema,
  toFieldErrors,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

/** Prodotti che la vetrina mostra (stessa regola della pagina pubblica). */
function onlineWhere(tenantId: string) {
  return {
    tenantId,
    isOnline: true,
    status: 'ACTIVE' as const,
    type: { in: [...ONLINE_ITEM_TYPES] },
  };
}

/**
 * Prima di accendere `adding` prodotti online: al massimo `STORE_LIMITS.onlineItems` per fioreria
 * (M1), così la vetrina non ne taglia mai in silenzio. Le accensioni contemporanee si mettono in
 * fila sul lock della fioreria.
 */
export async function assertOnlineRoomTx(
  tx: TransactionClient,
  tenantId: string,
  adding = 1,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('floral:online-items'), hashtext(${tenantId}))`;
  const online = await tx.catalogItem.count({ where: onlineWhere(tenantId) });
  if (online + adding > STORE_LIMITS.onlineItems) throw new ConflictError('store_online_limit');
}

/**
 * «In evidenza» nella riga «Destacados» della vetrina: al massimo 8 per fioreria, solo prodotti
 * online e attivi. L'ordine è quello di scelta (`featuredAt`).
 */
export async function setCatalogItemFeatured(
  ctx: TenantContext,
  itemId: string,
  featured: unknown,
): Promise<void> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(itemId)) throw new NotFoundError('CatalogItem');
  if (typeof featured !== 'boolean') throw new ValidationError({ featured: 'invalid_option' });
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    // Due stelle insieme non superano il limite: una alla volta per fioreria.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('floral:featured'), hashtext(${ctx.tenantId}))`;
    const existing = await tx.catalogItem.findFirst({
      where: { id: itemId, tenantId: ctx.tenantId },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        isOnline: true,
        featuredAt: true,
      },
    });
    if (!existing) return false;
    if ((existing.featuredAt !== null) === featured) return true;
    if (featured) {
      if (!existing.isOnline || existing.status !== 'ACTIVE' || !canShowOnline(existing.type)) {
        throw new ConflictError('store_featured_not_online');
      }
      const count = await tx.catalogItem.count({
        where: { ...onlineWhere(ctx.tenantId), featuredAt: { not: null } },
      });
      if (count >= STORE_LIMITS.featured) throw new ConflictError('store_featured_limit');
    }
    await tx.catalogItem.update({
      where: { id: existing.id },
      data: { featuredAt: featured ? new Date() : null },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.catalogItemUpdated,
      entityType: 'CatalogItem',
      entityId: existing.id,
      metadata: {
        name: existing.name,
        changes: { featured: { from: !featured, to: featured } },
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CatalogItem', itemId);
}

export interface CatalogBulkOnlineResult {
  /** Prodotti accesi o spenti davvero. */
  readonly changed: number;
  /** Prodotti scelti che la vetrina non può mostrare (archiviati, materiali): restano com'erano. */
  readonly skipped: number;
}

/**
 * «Mostra nel negozio» / «Togli dal negozio» per i prodotti scelti nel Catalogo (M1-2): al
 * massimo una pagina alla volta. Si accendono solo i prodotti attivi di un tipo da vendere (gli
 * altri si saltano e si contano) e mai oltre il limite dei 500; spenti, escono anche da
 * «Destacados». Un ID che non è della fioreria respinge tutta la richiesta (404 con l'evento di
 * sicurezza). Ogni prodotto cambiato ha la sua riga nel registro, come con l'interruttore.
 */
export async function setCatalogItemsOnline(
  ctx: TenantContext,
  rawIds: unknown,
  online: unknown,
): Promise<CatalogBulkOnlineResult> {
  requirePermission(ctx, 'catalog:write');
  if (typeof online !== 'boolean') throw new ValidationError({ online: 'invalid_option' });
  const parsed = parseCatalogBulkIds(rawIds);
  if ('error' in parsed) {
    if (parsed.error === 'invalid') throw new NotFoundError('CatalogItem');
    throw new ValidationError({
      items: parsed.error === 'empty' ? 'catalog_bulk_empty' : 'catalog_bulk_too_many',
    });
  }
  const { ids } = parsed;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    // Prima il lock dei prodotti online (come una sola accensione), poi le righe scelte.
    if (online) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('floral:online-items'), hashtext(${ctx.tenantId}))`;
    }
    const items = await tx.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
      select: { id: true, name: true, type: true, status: true, isOnline: true, featuredAt: true },
    });
    const missing = ids.find((id) => !items.some((item) => item.id === id));
    if (missing !== undefined) return { missing, changed: 0, skipped: 0 };
    const showable = (item: (typeof items)[number]) =>
      item.status === 'ACTIVE' && canShowOnline(item.type);
    const toChange = items.filter(
      (item) => item.isOnline !== online && (!online || showable(item)),
    );
    const skipped = online ? items.filter((item) => !item.isOnline && !showable(item)).length : 0;
    if (online && toChange.length > 0) {
      // Il lock è già preso: qui solo il conto (stessa regola di `assertOnlineRoomTx`).
      const count = await tx.catalogItem.count({ where: onlineWhere(ctx.tenantId) });
      if (count + toChange.length > STORE_LIMITS.onlineItems) {
        throw new ConflictError('store_online_limit');
      }
    }
    for (const item of toChange) {
      await tx.catalogItem.update({
        where: { id: item.id },
        // Spento: fuori anche dalla riga «Destacados» (CHECK nel database).
        data: online ? { isOnline: true } : { isOnline: false, featuredAt: null },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.catalogItemUpdated,
        entityType: 'CatalogItem',
        entityId: item.id,
        metadata: {
          name: item.name,
          changes: {
            isOnline: { from: item.isOnline, to: online },
            ...(item.featuredAt !== null ? { featured: { from: true, to: false } } : {}),
          },
        },
      });
    }
    return { missing: null, changed: toChange.length, skipped };
  });
  if (result.missing !== null) return notFound(ctx, 'CatalogItem', result.missing);
  return { changed: result.changed, skipped: result.skipped };
}

/**
 * «Usa come copertina» o le frecce ←/→ di una foto del prodotto: le foto attive si rinumerano da 0.
 * L'ordine vale ovunque (vetrina, catalogo, Diseñador).
 */
export async function moveCatalogItemPhoto(
  ctx: TenantContext,
  photoId: string,
  move: unknown,
): Promise<void> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(photoId)) throw new NotFoundError('CatalogItemPhoto');
  if (!isPhotoMove(move)) throw new ValidationError({ move: 'invalid_option' });
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const photo = await tx.catalogItemPhoto.findFirst({
      where: { id: photoId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { catalogItemId: true },
    });
    if (!photo) return false;
    // Il prodotto bloccato: due spostamenti insieme non mescolano i numeri.
    const [item] = await tx.$queryRaw<{ name: string }[]>`
      SELECT "name" FROM "CatalogItem"
      WHERE "id" = ${photo.catalogItemId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid
      FOR UPDATE`;
    if (!item) return false;
    const photos = await tx.catalogItemPhoto.findMany({
      where: { tenantId: ctx.tenantId, catalogItemId: photo.catalogItemId, status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, sortOrder: true },
    });
    const order = movePhotoId(
      photos.map((entry) => entry.id),
      photoId,
      move,
    );
    if (!order) return false;
    const changed = order.filter(
      (id, index) => photos.find((entry) => entry.id === id)!.sortOrder !== index,
    );
    if (changed.length === 0) return true;
    for (const [index, id] of order.entries()) {
      if (!changed.includes(id)) continue;
      await tx.catalogItemPhoto.update({ where: { id }, data: { sortOrder: index } });
    }
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.catalogPhotosReordered,
      entityType: 'CatalogItem',
      entityId: photo.catalogItemId,
      metadata: { name: item.name, move },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CatalogItemPhoto', photoId);
}

/** Politiche della fioreria verso chi compra (cambi, cancellazioni, sostituzioni): testi suoi. */
export async function updateStorePolicies(ctx: TenantContext, rawInput: unknown): Promise<void> {
  requirePermission(ctx, 'tenant:settings:update');
  const parsed = storePoliciesSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  await withTenantContext(getDb(), ctx, async (tx) => {
    await tx.$executeRaw`INSERT INTO "OnlineStore" ("tenantId", "updatedAt")
      VALUES (${ctx.tenantId}::uuid, CURRENT_TIMESTAMP) ON CONFLICT ("tenantId") DO NOTHING`;
    const before = await tx.onlineStore.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } });
    const changedFields = STORE_POLICY_FIELDS.filter((field) => before[field] !== input[field]);
    if (changedFields.length === 0) return;
    await tx.onlineStore.update({ where: { tenantId: ctx.tenantId }, data: input });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.storePoliciesUpdated,
      entityType: 'OnlineStore',
      entityId: ctx.tenantId,
      // Solo quali politiche sono cambiate: i testi non vanno nel registro.
      metadata: { changedFields },
    });
  });
}

export interface FeaturedItemDto {
  readonly id: string;
  readonly name: string;
}

/** I prodotti in evidenza, nell'ordine della vetrina (per Impostazioni → Negozio online). */
export async function listFeaturedItems(ctx: TenantContext): Promise<readonly FeaturedItemDto[]> {
  requirePermission(ctx, 'tenant:read');
  return withTenantContext(getDb(), ctx, (tx) =>
    tx.catalogItem.findMany({
      where: { ...onlineWhere(ctx.tenantId), featuredAt: { not: null } },
      orderBy: [{ featuredAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    }),
  );
}
