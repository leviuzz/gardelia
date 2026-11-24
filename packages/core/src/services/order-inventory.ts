/**
 * Ordini e inventario (ADR-071, sull'API dell'inventario di ADR-060): i materiali di un ordine si
 * scaricano quando l'ordine diventa "Listo" per la prima volta (il ramo è fatto), con il registro di
 * uso legato all'ordine. Prima di allora la scheda dell'ordine mostra cosa si scaricherà e cosa manca.
 *
 * Cosa conta: i prodotti del catalogo venduti come tali (tallos, vasi, piante…), gli ingredienti della
 * ricetta dei ramos del catalogo (dalla riga: la ricetta concordata; per le righe nate prima, quella
 * attuale) e i componenti dei disegni del Diseñador. Le righe libere no. Senza il piano dell'inventario
 * o per i prodotti non controllati non succede nulla (lo decide l'inventario).
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import { compareDates, isUuid, toIsoDate, todayInTimeZone, type SaleUnit } from '@floral/domain';
import { notFound } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { NotFoundError } from '../errors';
import { getEntitlements } from './billing';
import { checkStockTx, type StockRequestLine } from './inventory';
import { dateToParts } from './quote-internals';

interface LineSnapshotView {
  readonly item?: { readonly type?: string };
  readonly recipe?: readonly { readonly catalogItemId?: string; readonly quantity?: number }[];
  readonly components?: readonly { readonly catalogItemId?: string; readonly quantity?: number }[];
}

function readSnapshot(value: Prisma.JsonValue | null): LineSnapshotView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as LineSnapshotView;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * I materiali di un ordine, per prodotto del catalogo e nella sua unità di vendita (le quantità della
 * stessa riga si sommano dopo, nell'inventario). Dentro la transazione di chi chiama.
 */
export async function orderStockRequest(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<StockRequestLine[]> {
  const lines = await tx.orderLine.findMany({
    where: { tenantId, orderId },
    select: { kind: true, catalogItemId: true, quantity: true, snapshot: true },
  });
  const request: StockRequestLine[] = [];
  /** Ramos il cui snapshot non ha gli ID degli ingredienti: si usa la ricetta attuale. */
  const legacyBouquets: { catalogItemId: string; quantity: number }[] = [];
  for (const line of lines) {
    const snapshot = readSnapshot(line.snapshot);
    if (line.kind === 'BUILDER') {
      for (const component of snapshot?.components ?? []) {
        if (
          component.catalogItemId &&
          isUuid(component.catalogItemId) &&
          isCount(component.quantity)
        ) {
          request.push({
            catalogItemId: component.catalogItemId,
            quantity: component.quantity * line.quantity,
          });
        }
      }
      continue;
    }
    if (line.kind !== 'CATALOG_ITEM' || !line.catalogItemId) continue;
    if (snapshot?.item?.type === 'BOUQUET') {
      const recipe = snapshot.recipe ?? [];
      const known = recipe.filter(
        (ingredient) =>
          ingredient.catalogItemId &&
          isUuid(ingredient.catalogItemId) &&
          isCount(ingredient.quantity),
      );
      if (recipe.length > 0 && known.length === recipe.length) {
        for (const ingredient of known) {
          request.push({
            catalogItemId: ingredient.catalogItemId!,
            quantity: ingredient.quantity! * line.quantity,
          });
        }
      } else if (recipe.length > 0) {
        legacyBouquets.push({ catalogItemId: line.catalogItemId, quantity: line.quantity });
      }
      // Un ramo senza ricetta non consuma nulla di controllato (ADR-060): niente da scaricare.
      continue;
    }
    request.push({ catalogItemId: line.catalogItemId, quantity: line.quantity });
  }
  if (legacyBouquets.length > 0) {
    const recipes = await tx.bouquetRecipe.findMany({
      where: {
        tenantId,
        catalogItemId: { in: [...new Set(legacyBouquets.map((line) => line.catalogItemId))] },
      },
      select: {
        catalogItemId: true,
        lines: { where: { tenantId }, select: { ingredientItemId: true, quantity: true } },
      },
    });
    const byBouquet = new Map(recipes.map((recipe) => [recipe.catalogItemId, recipe.lines]));
    for (const bouquet of legacyBouquets) {
      for (const ingredient of byBouquet.get(bouquet.catalogItemId) ?? []) {
        request.push({
          catalogItemId: ingredient.ingredientItemId,
          quantity: ingredient.quantity * bouquet.quantity,
        });
      }
    }
  }
  return request;
}

export interface OrderInventoryLineDto {
  readonly catalogItemId: string;
  readonly name: string;
  readonly saleUnit: SaleUnit;
  /** Quanto serve all'ordine. */
  readonly requested: number;
  /** Disponibile per questo ordine: giacenza meno gli apartados degli altri (il suo è suo). */
  readonly available: number;
  /**
   * Apartado (ADR-062) per altri: altri ordini o apartados fatti a mano. Uno fatto a mano per questo
   * ordine va liberato, non usato: l'ordine aparta e scarica già i suoi materiali (ADR-072).
   */
  readonly reserved: number;
  readonly missing: number;
}

export interface OrderInventoryDto {
  /**
   * Scaricato: quando e con quale registro; `reversed` se poi è stato annullato dall'inventario
   * (l'ordine non riscarica: l'anulación è una scelta della fioreria).
   */
  readonly consumed: {
    readonly entryId: string;
    readonly at: Date;
    readonly reversed: boolean;
  } | null;
  /** Prodotti controllati che servono all'ordine (prima dello scarico). */
  readonly lines: readonly OrderInventoryLineDto[];
  /** Quelli per cui la merce non basta. */
  readonly shortages: readonly OrderInventoryLineDto[];
  /**
   * L'apartado dell'ordine (ADR-072), date "AAAA-MM-GG": tiene i materiali da `holdsFrom` fino al
   * giorno della consegna; `started` = li tiene già (prima non tolgono nulla dal disponibile).
   */
  readonly hold: {
    readonly holdsFrom: string | null;
    readonly expiresOn: string;
    readonly started: boolean;
  } | null;
}

/**
 * Riquadro "Inventario" della scheda dell'ordine; null senza il piano dell'inventario o se l'ordine
 * non tocca nessun prodotto controllato (niente da mostrare).
 */
export async function getOrderInventory(
  ctx: TenantContext,
  orderId: string,
): Promise<OrderInventoryDto | null> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await tx.order.findFirst({
      where: { tenantId: ctx.tenantId, id: orderId },
      select: {
        status: true,
        inventoryEntry: {
          select: { id: true, createdAt: true, reversedBy: { select: { id: true } } },
        },
        inventoryReservationId: true,
        inventoryReservation: { select: { status: true, holdsFrom: true, expiresOn: true } },
      },
    });
    // Prima l'esistenza (404 anche per chi non ha il piano), poi il piano.
    if (!order) return MISSING;
    if (!(await getEntitlements(ctx, tx)).inventory) return null;
    if (order.inventoryEntry) {
      return {
        consumed: {
          entryId: order.inventoryEntry.id,
          at: order.inventoryEntry.createdAt,
          reversed: order.inventoryEntry.reversedBy !== null,
        },
        lines: [],
        shortages: [],
        hold: null,
      };
    }
    // Solo gli ordini che devono ancora essere fatti: dopo, o annullati, non c'è niente da dire.
    if (!['PENDING_ACCEPTANCE', 'CONFIRMED', 'IN_PREPARATION'].includes(order.status)) return null;
    const request = await orderStockRequest(tx, ctx.tenantId, orderId);
    if (request.length === 0) return null;
    const reservation =
      order.inventoryReservation?.status === 'ACTIVE' ? order.inventoryReservation : null;
    const check = await checkStockTx(tx, ctx, request, {
      excludeReservationId: reservation ? order.inventoryReservationId : null,
    });
    const tracked = check.lines.filter((line) => line.tracked);
    if (tracked.length === 0) return null;
    const items = await tx.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, id: { in: tracked.map((line) => line.catalogItemId) } },
      select: { id: true, name: true, saleUnit: true },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const lines = tracked
      .map((line) => {
        const item = byId.get(line.catalogItemId);
        return item
          ? {
              catalogItemId: line.catalogItemId,
              name: item.name,
              saleUnit: item.saleUnit,
              requested: line.requested,
              available: line.available ?? 0,
              reserved: Math.max((line.onHand ?? 0) - (line.available ?? 0), 0),
              missing: line.missing,
            }
          : null;
      })
      .filter((line): line is OrderInventoryLineDto => line !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const holdsFrom = reservation ? dateToParts(reservation.holdsFrom) : null;
    const hold = reservation
      ? {
          holdsFrom: holdsFrom ? toIsoDate(holdsFrom) : null,
          expiresOn: reservation.expiresOn.toISOString().slice(0, 10),
          started:
            holdsFrom === null || compareDates(holdsFrom, todayInTimeZone(ctx.timezone)) <= 0,
        }
      : null;
    return { consumed: null, lines, shortages: lines.filter((line) => line.missing > 0), hold };
  });
  // Un ordine di un'altra fioreria risponde come uno inesistente (404, con l'evento di sicurezza).
  if (result === MISSING) return notFound(ctx, 'Order', orderId);
  return result;
}

const MISSING = Symbol('missing');
