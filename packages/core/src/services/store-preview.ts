/**
 * Anteprima della vetrina per la fioreria (marketplace, blocco M1-2, ADR-087): la stessa lettura
 * della pagina pubblica (`public-store.ts`), ma nel contesto della fioreria con la sua RLS, anche con
 * il negozio non ancora pubblicato. Solo chi gestisce il negozio (proprietario e gerente), senza
 * carrello: gli ordini dall'anteprima non partono.
 */
import { getDb, withTenantContext } from '@floral/db';
import { isUuid, parseStorefrontQuery } from '@floral/domain';
import { notFound } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { NotFoundError } from '../errors';
import {
  readStoreHeaderTx,
  readStoreItemTx,
  readStorefrontTx,
  type PublicStoreItemDetailDto,
  type PublicStorefrontDto,
} from '../public-store';

export interface StorePreviewDto extends PublicStorefrontDto {
  /** Il negozio è pubblicato: se no, i clienti non lo vedono ancora (la pagina lo dice). */
  readonly isPublished: boolean;
}

/** La vetrina come la vedranno i clienti, con scheda, ricerca, ordine e pagina scelti. */
export async function getStorePreview(
  ctx: TenantContext,
  rawQuery: unknown,
): Promise<StorePreviewDto> {
  requirePermission(ctx, 'tenant:settings:update');
  const query = parseStorefrontQuery(rawQuery);
  return withTenantContext(getDb(), ctx, async (tx) => {
    const [store, catalog, row] = await Promise.all([
      readStoreHeaderTx(tx, ctx.tenantId),
      readStorefrontTx(tx, ctx.tenantId, query),
      tx.onlineStore.findUnique({
        where: { tenantId: ctx.tenantId },
        select: { isPublished: true },
      }),
    ]);
    return { store, query, ...catalog, cart: null, isPublished: row?.isPublished ?? false };
  });
}

export interface StorePreviewItemDto {
  /** Null se il prodotto è della fioreria ma non è nel negozio (spento, archiviato, un materiale). */
  readonly detail: PublicStoreItemDetailDto | null;
  readonly isPublished: boolean;
}

/**
 * Un prodotto nell'anteprima. Se non è nel negozio la pagina lo dice; un ID che non è della
 * fioreria è un 404 con l'evento di sicurezza.
 */
export async function getStorePreviewItem(
  ctx: TenantContext,
  itemId: string,
): Promise<StorePreviewItemDto> {
  requirePermission(ctx, 'tenant:settings:update');
  if (!isUuid(itemId)) throw new NotFoundError('CatalogItem');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const row = await tx.onlineStore.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { isPublished: true },
    });
    const isPublished = row?.isPublished ?? false;
    const detail = await readStoreItemTx(tx, ctx.tenantId, itemId, []);
    if (detail) return { detail, isPublished };
    const exists = await tx.catalogItem.findFirst({
      where: { id: itemId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    return exists ? { detail: null, isPublished } : null;
  });
  if (!result) return notFound(ctx, 'CatalogItem', itemId);
  return result;
}
