/**
 * Sostituto quando manca un fiore (ADR-081, CAT-01, sulle regole di `@floral/domain` substitution).
 *
 *  - Lettura: per un pedido ancora da fare (confermato o in preparazione, non ancora scaricato) gli
 *    ingredienti dei ramos che mancano, perché agotados nel catalogo o perché la merce controllata
 *    non basta (ADR-071), con i sostituti proposti e la regola della riga.
 *  - Cambio: SOLO come dice la regola del ramo (founder, 24/11/2026): "No se sustituye" no; "Preguntar
 *    al cliente" con l'ok del cliente confermato da chi cambia; "Similar permitido" subito. I disegni
 *    del Diseñador valgono come "Preguntar". Lo fa chiunque prepara i ramos (`orders:fulfill`).
 *  - Il prezzo resta quello concordato. Cambia la distinta della riga (snapshot, con il fiore di
 *    prima in `replaces`), quindi cosa esce dall'inventario a "Listo" e l'apartado dell'ordine; il
 *    costo stimato della riga si aggiorna quando entrambi i costi sono noti. Nell'audit chi, cosa e se
 *    il cliente era d'accordo.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  INGREDIENT_TYPES,
  canSubstitute,
  formatOrderNumber,
  isUuid,
  orderSubstitutionSchema,
  rankSubstitutes,
  substitutionMode,
  toFieldErrors,
  type Availability,
  type SaleUnit,
  type SubstituteItem,
  type SubstituteReason,
  type SubstitutionMode,
  type SubstitutionPolicy,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { checkStockTx } from './inventory';
import { orderStockRequest } from './order-inventory';
import { syncOrderReservationTx } from './order-reservation';

/** Stati in cui il ramo non è ancora fatto: si può cambiare un ingrediente. */
const SUBSTITUTABLE_STATUSES = ['CONFIRMED', 'IN_PREPARATION'] as const;

/** Un ingrediente nello snapshot (ramos del catalogo: `recipe`; Diseñador: `components`). */
interface IngredientEntry {
  catalogItemId?: string;
  name: string;
  variety: string | null;
  quantity: number;
  saleUnit: SaleUnit;
  color?: string | null;
  unitPriceMinor?: number;
  availability?: Availability;
  role?: string;
  /** Il fiore concordato all'inizio, se poi è stato sostituito (ADR-081). */
  replaces?: { name: string; variety: string | null };
}

interface SnapshotShape {
  item?: { type?: string };
  recipe?: IngredientEntry[];
  components?: IngredientEntry[];
  [key: string]: unknown;
}

function readSnapshot(value: Prisma.JsonValue | null): SnapshotShape | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as SnapshotShape;
}

/** Gli ingredienti con l'ID del prodotto (le righe di prima non lo hanno: non si sostituiscono). */
function ingredientsOf(
  kind: string,
  snapshot: SnapshotShape | null,
): { list: 'recipe' | 'components'; entries: IngredientEntry[] } | null {
  if (!snapshot) return null;
  if (kind === 'BUILDER') return { list: 'components', entries: snapshot.components ?? [] };
  if (kind === 'CATALOG_ITEM' && snapshot.item?.type === 'BOUQUET') {
    return { list: 'recipe', entries: snapshot.recipe ?? [] };
  }
  return null;
}

const itemSelect = {
  id: true,
  type: true,
  name: true,
  variety: true,
  canonicalFlowerId: true,
  colors: true,
  saleUnit: true,
  priceMinor: true,
  costMinor: true,
  availability: true,
  status: true,
} as const;

type ItemRow = SubstituteItem & { readonly costMinor: number | null };

async function substitutionPolicies(
  tx: TransactionClient,
  tenantId: string,
  bouquetIds: readonly string[],
): Promise<Map<string, SubstitutionPolicy>> {
  if (bouquetIds.length === 0) return new Map();
  const recipes = await tx.bouquetRecipe.findMany({
    where: { tenantId, catalogItemId: { in: [...bouquetIds] } },
    select: { catalogItemId: true, substitutionPolicy: true },
  });
  return new Map(recipes.map((recipe) => [recipe.catalogItemId, recipe.substitutionPolicy]));
}

// -----------------------------------------------------------------------------
// Lettura
// -----------------------------------------------------------------------------

export interface SubstituteOptionDto {
  readonly id: string;
  readonly name: string;
  readonly variety: string | null;
  readonly reason: SubstituteReason;
  readonly availability: Availability;
}

export interface MissingIngredientDto {
  readonly catalogItemId: string;
  readonly name: string;
  readonly variety: string | null;
  readonly saleUnit: SaleUnit;
  /** Quante unità per ramo e in tutta la riga. */
  readonly quantity: number;
  readonly total: number;
  /** `OUT_OF_STOCK` = agotado nel catalogo (o archiviato); `SHORT` = la merce controllata non basta. */
  readonly problem: 'OUT_OF_STOCK' | 'SHORT';
  /** Per `SHORT`: quanto manca, sommato su tutto l'ordine. */
  readonly shortBy: number | null;
  readonly candidates: readonly SubstituteOptionDto[];
}

export interface LineSubstitutionDto {
  readonly lineId: string;
  readonly description: string;
  readonly quantity: number;
  readonly mode: SubstitutionMode;
  readonly missing: readonly MissingIngredientDto[];
}

export interface OrderSubstitutionsDto {
  readonly lines: readonly LineSubstitutionDto[];
  /** Chi può cambiare (chi prepara i ramos). */
  readonly canApply: boolean;
}

/**
 * Cosa manca nei ramos del pedido e con cosa si può sostituire; null se il pedido non è più da fare
 * o se non manca niente (il riquadro non compare).
 */
export async function getOrderSubstitutions(
  ctx: TenantContext,
  orderId: string,
): Promise<OrderSubstitutionsDto | null> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await tx.order.findFirst({
      where: { tenantId: ctx.tenantId, id: orderId },
      select: {
        status: true,
        inventoryEntryId: true,
        inventoryReservationId: true,
        inventoryReservation: { select: { status: true } },
      },
    });
    if (!order) return MISSING;
    const open =
      (SUBSTITUTABLE_STATUSES as readonly string[]).includes(order.status) &&
      order.inventoryEntryId === null;
    if (!open) return null;

    const lines = await tx.orderLine.findMany({
      where: { tenantId: ctx.tenantId, orderId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        kind: true,
        catalogItemId: true,
        description: true,
        quantity: true,
        snapshot: true,
      },
    });
    const parsed = lines.flatMap((line) => {
      const found = ingredientsOf(line.kind, readSnapshot(line.snapshot));
      const entries = (found?.entries ?? []).filter(
        (entry): entry is IngredientEntry & { catalogItemId: string } =>
          typeof entry.catalogItemId === 'string' && isUuid(entry.catalogItemId),
      );
      return entries.length > 0 ? [{ line, entries }] : [];
    });
    if (parsed.length === 0) return null;

    const ingredientIds = [
      ...new Set(parsed.flatMap(({ entries }) => entries.map((entry) => entry.catalogItemId))),
    ];
    // In fila: una transazione usa una sola connessione (ADR-053).
    const current = await tx.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, id: { in: ingredientIds } },
      select: itemSelect,
    });
    const request = await orderStockRequest(tx, ctx.tenantId, orderId);
    const byId = new Map<string, ItemRow>(current.map((item) => [item.id, item]));
    const reservation =
      order.inventoryReservation?.status === 'ACTIVE' ? order.inventoryReservationId : null;
    const stock = await checkStockTx(tx, ctx, request, { excludeReservationId: reservation });
    const shortBy = new Map(stock.shortages.map((line) => [line.catalogItemId, line.missing]));

    const problems = parsed.flatMap(({ line, entries }) => {
      const missing = entries.flatMap((entry) => {
        const item = byId.get(entry.catalogItemId);
        if (!item) return [];
        const out = item.availability === 'OUT_OF_STOCK' || item.status !== 'ACTIVE';
        const short = shortBy.get(entry.catalogItemId) ?? 0;
        if (!out && short === 0) return [];
        return [
          { entry, item, problem: out ? ('OUT_OF_STOCK' as const) : ('SHORT' as const), short },
        ];
      });
      return missing.length > 0 ? [{ line, entries, missing }] : [];
    });
    if (problems.length === 0) return null;

    const policies = await substitutionPolicies(
      tx,
      ctx.tenantId,
      problems
        .filter(({ line }) => line.kind === 'CATALOG_ITEM' && line.catalogItemId)
        .map(({ line }) => line.catalogItemId!),
    );
    const candidates = await tx.catalogItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        type: { in: [...INGREDIENT_TYPES] },
        availability: { not: 'OUT_OF_STOCK' },
      },
      select: itemSelect,
    });

    const out: LineSubstitutionDto[] = [];
    for (const { line, entries, missing } of problems) {
      const mode = substitutionMode(
        { kind: line.kind === 'BUILDER' ? 'BUILDER' : 'CATALOG_ITEM' },
        line.catalogItemId ? (policies.get(line.catalogItemId) ?? null) : null,
      );
      const inRecipe = new Set(entries.map((entry) => entry.catalogItemId));
      const missingDtos: MissingIngredientDto[] = [];
      for (const { entry, item, problem, short } of missing) {
        const total = entry.quantity * line.quantity;
        let ranked: ReturnType<typeof rankSubstitutes> = [];
        if (mode !== 'NOT_ALLOWED') {
          const compatible = candidates.filter((candidate) =>
            canSubstitute(item, candidate, inRecipe),
          );
          // Basta la merce per tutta la riga? Solo per i prodotti controllati (gli altri sì).
          const check = await checkStockTx(
            tx,
            ctx,
            compatible.map((candidate) => ({ catalogItemId: candidate.id, quantity: total })),
          );
          const insufficient = new Set(check.shortages.map((row) => row.catalogItemId));
          ranked = rankSubstitutes(item, compatible, {
            inRecipe,
            enough: (id) => !insufficient.has(id),
          });
        }
        missingDtos.push({
          catalogItemId: entry.catalogItemId,
          name: entry.name,
          variety: entry.variety,
          saleUnit: entry.saleUnit,
          quantity: entry.quantity,
          total,
          problem,
          shortBy: problem === 'SHORT' ? short : null,
          candidates: ranked.map(({ item: candidate, reason }) => ({
            id: candidate.id,
            name: candidate.name,
            variety: candidate.variety,
            reason,
            availability: candidate.availability,
          })),
        });
      }
      out.push({
        lineId: line.id,
        description: line.description,
        quantity: line.quantity,
        mode,
        missing: missingDtos,
      });
    }
    return { lines: out, canApply: hasPermission(ctx, 'orders:fulfill') };
  });
  // Un ordine di un'altra fioreria risponde come uno inesistente (404, con l'evento di sicurezza).
  if (result === MISSING) return notFound(ctx, 'Order', orderId);
  return result;
}

// -----------------------------------------------------------------------------
// Cambio
// -----------------------------------------------------------------------------

export interface SubstitutionResult {
  readonly from: string;
  readonly to: string;
}

function label(item: { readonly name: string; readonly variety: string | null }): string {
  return item.variety ? `${item.name} ${item.variety}` : item.name;
}

/** Cambia un ingrediente di un ramo del pedido con un sostituto, secondo la regola della riga. */
export async function substituteOrderIngredient(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
): Promise<SubstitutionResult> {
  requirePermission(ctx, 'orders:fulfill');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = orderSubstitutionSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    // In fila con gli altri cambi dell'ordine (stato, righe, scarico).
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
    const order = await tx.order.findFirst({
      where: { tenantId: ctx.tenantId, id: orderId },
      select: { id: true, number: true, status: true, inventoryEntryId: true },
    });
    if (!order) return MISSING;
    if (
      !(SUBSTITUTABLE_STATUSES as readonly string[]).includes(order.status) ||
      order.inventoryEntryId !== null
    ) {
      throw new ConflictError('order_not_substitutable');
    }
    const line = await tx.orderLine.findFirst({
      where: { tenantId: ctx.tenantId, orderId: order.id, id: input.lineId },
      select: {
        id: true,
        kind: true,
        catalogItemId: true,
        quantity: true,
        unitCostMinor: true,
        snapshot: true,
      },
    });
    if (!line) throw new ValidationError({ lineId: 'invalid_option' });
    const snapshot = readSnapshot(line.snapshot);
    const found = ingredientsOf(line.kind, snapshot);
    const index =
      found?.entries.findIndex((entry) => entry.catalogItemId === input.fromItemId) ?? -1;
    if (!snapshot || !found || index < 0)
      throw new ValidationError({ fromItemId: 'invalid_option' });

    const policy =
      line.kind === 'CATALOG_ITEM' && line.catalogItemId
        ? ((await substitutionPolicies(tx, ctx.tenantId, [line.catalogItemId])).get(
            line.catalogItemId,
          ) ?? null)
        : null;
    const mode = substitutionMode(
      { kind: line.kind === 'BUILDER' ? 'BUILDER' : 'CATALOG_ITEM' },
      policy,
    );
    if (mode === 'NOT_ALLOWED') throw new ConflictError('substitution_not_allowed');
    if (mode === 'ASK_CUSTOMER' && !input.customerAgreed) {
      throw new ValidationError({ customerAgreed: 'substitution_customer_required' });
    }

    const items = await tx.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, id: { in: [input.fromItemId, input.toItemId] } },
      select: itemSelect,
    });
    const from = items.find((item) => item.id === input.fromItemId);
    const to = items.find((item) => item.id === input.toItemId);
    const inRecipe = new Set(
      found.entries.flatMap((entry) => (entry.catalogItemId ? [entry.catalogItemId] : [])),
    );
    if (!from || !to || !canSubstitute(from, to, inRecipe)) {
      throw new ValidationError({ toItemId: 'invalid_option' });
    }

    const entry = found.entries[index]!;
    const color =
      entry.color && to.colors.includes(entry.color)
        ? entry.color
        : to.colors.length === 1
          ? (to.colors[0] ?? null)
          : null;
    const replaces = entry.replaces ?? { name: entry.name, variety: entry.variety };
    const replaced: IngredientEntry = {
      ...entry,
      catalogItemId: to.id,
      name: to.name,
      variety: to.variety,
      saleUnit: to.saleUnit,
      ...(entry.color !== undefined || line.kind === 'BUILDER' ? { color } : {}),
      ...(entry.unitPriceMinor !== undefined ? { unitPriceMinor: to.priceMinor } : {}),
      ...(entry.availability !== undefined ? { availability: to.availability } : {}),
      replaces,
    };
    const nextEntries = found.entries.map((current, position) =>
      position === index ? replaced : current,
    );
    const nextSnapshot: SnapshotShape = { ...snapshot, [found.list]: nextEntries };
    // Diseñador: la distinta da mostrare (`recipe`) è allineata ai componenti.
    if (found.list === 'components' && Array.isArray(snapshot.recipe)) {
      nextSnapshot.recipe = snapshot.recipe.map((shown, position) =>
        position === index
          ? {
              ...shown,
              name: to.name,
              variety: to.variety,
              saleUnit: to.saleUnit,
              color,
              replaces,
            }
          : shown,
      );
    }
    // Costo stimato: si aggiorna quando i due costi sono noti; altrimenti resta la stima di prima.
    const unitCostMinor =
      line.unitCostMinor !== null && from.costMinor !== null && to.costMinor !== null
        ? Math.max(0, line.unitCostMinor + (to.costMinor - from.costMinor) * entry.quantity)
        : line.unitCostMinor;

    await tx.orderLine.update({
      where: { id: line.id, tenantId: ctx.tenantId },
      data: { snapshot: nextSnapshot as unknown as Prisma.InputJsonValue, unitCostMinor },
    });
    await syncOrderReservationTx(tx, ctx, order.id);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderIngredientSubstituted,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(order.number),
        lineId: line.id,
        name: label(from),
        ingredientName: label(to),
        quantity: entry.quantity,
        mode,
        customerAgreed: input.customerAgreed,
      },
    });
    return { from: label(from), to: label(to) };
  });
  if (result === MISSING) return notFound(ctx, 'Order', orderId);
  return result;
}

const MISSING = Symbol('missing');
