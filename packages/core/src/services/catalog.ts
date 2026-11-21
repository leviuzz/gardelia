/**
 * Catalogo prodotti, bouquet e servizi [CAT-01].
 *
 *  - tutte le query filtrano esplicitamente per tenantId (oltre alla RLS);
 *  - i costi sono restituiti solo a chi ha `catalog:costs:read` (lo STAFF non li vede);
 *  - nessuna cancellazione fisica: gli articoli si archiviano e restano negli storici;
 *  - la tipologia è immutabile dopo la creazione (evita distinte incoerenti).
 */
import {
  getDb,
  isUniqueViolation,
  withTenantContext,
  type CanonicalCategory,
  type Prisma,
} from '@floral/db';
import {
  AUDIT_ACTIONS,
  CATALOG_PAGE_SIZE,
  INGREDIENT_TYPES,
  catalogItemInputSchema,
  catalogListFiltersSchema,
  diffFields,
  isUuid,
  resolveLocale,
  toFieldErrors,
  type Availability,
  type CatalogItemInput,
  type CatalogItemType,
  type RecordStatus,
  type SaleUnit,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

export interface CatalogItemDto {
  readonly id: string;
  readonly type: CatalogItemType;
  readonly name: string;
  readonly description: string | null;
  readonly sku: string | null;
  readonly canonicalFlowerId: string | null;
  readonly canonicalName: string | null;
  readonly variety: string | null;
  readonly colors: readonly string[];
  readonly saleUnit: SaleUnit;
  readonly priceMinor: number;
  /** Sempre null per chi non può vedere i costi. */
  readonly costMinor: number | null;
  readonly currency: string;
  readonly availability: Availability;
  readonly prepMinutes: number | null;
  readonly heightCm: number | null;
  readonly widthCm: number | null;
  readonly tags: readonly string[];
  readonly status: RecordStatus;
  readonly archivedAt: Date | null;
  readonly updatedAt: Date;
  readonly recipeLineCount: number | null;
}

const itemInclude = {
  canonicalFlower: { select: { names: true } },
  recipe: { select: { _count: { select: { lines: true } } } },
} satisfies Prisma.CatalogItemInclude;

type ItemWithRelations = Prisma.CatalogItemGetPayload<{ include: typeof itemInclude }>;

function localizedName(names: Prisma.JsonValue | undefined, locale: string): string | null {
  if (!names || typeof names !== 'object' || Array.isArray(names)) return null;
  const record = names as Record<string, unknown>;
  const value = record[locale] ?? record['es-MX'];
  return typeof value === 'string' ? value : null;
}

function toDto(item: ItemWithRelations, ctx: TenantContext): CatalogItemDto {
  const canSeeCosts = hasPermission(ctx, 'catalog:costs:read');
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description,
    sku: item.sku,
    canonicalFlowerId: item.canonicalFlowerId,
    canonicalName: localizedName(item.canonicalFlower?.names, ctx.locale),
    variety: item.variety,
    colors: item.colors,
    saleUnit: item.saleUnit,
    priceMinor: item.priceMinor,
    costMinor: canSeeCosts ? item.costMinor : null,
    currency: item.currency,
    availability: item.availability,
    prepMinutes: item.prepMinutes,
    heightCm: item.heightCm,
    widthCm: item.widthCm,
    tags: item.tags,
    status: item.status,
    archivedAt: item.archivedAt,
    updatedAt: item.updatedAt,
    recipeLineCount: item.recipe ? item.recipe._count.lines : null,
  };
}

export interface CatalogListResult {
  readonly items: readonly CatalogItemDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly canViewCosts: boolean;
  readonly canWrite: boolean;
}

export async function listCatalogItems(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<CatalogListResult> {
  requirePermission(ctx, 'catalog:read');
  const filters = catalogListFiltersSchema.parse(rawFilters ?? {});
  const where: Prisma.CatalogItemWhereInput = {
    tenantId: ctx.tenantId,
    status: filters.status,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.availability ? { availability: filters.availability } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { variety: { contains: filters.q, mode: 'insensitive' } },
            { sku: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  return withTenantContext(getDb(), ctx, async (tx) => {
    const total = await tx.catalogItem.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const items = await tx.catalogItem.findMany({
      where,
      include: itemInclude,
      orderBy: [{ type: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * CATALOG_PAGE_SIZE,
      take: CATALOG_PAGE_SIZE,
    });
    return {
      items: items.map((item) => toDto(item, ctx)),
      total,
      page,
      pageCount,
      canViewCosts: hasPermission(ctx, 'catalog:costs:read'),
      canWrite: hasPermission(ctx, 'catalog:write'),
    };
  });
}

export async function getCatalogItem(ctx: TenantContext, itemId: string): Promise<CatalogItemDto> {
  requirePermission(ctx, 'catalog:read');
  if (!isUuid(itemId)) throw new NotFoundError('CatalogItem');
  const item = await withTenantContext(getDb(), ctx, (tx) =>
    tx.catalogItem.findFirst({
      where: { id: itemId, tenantId: ctx.tenantId },
      include: itemInclude,
    }),
  );
  if (!item) return notFound(ctx, 'CatalogItem', itemId);
  return toDto(item, ctx);
}

const CATEGORY_BY_TYPE: Partial<Record<CatalogItemType, CanonicalCategory>> = {
  CUT_FLOWER: 'CUT_FLOWER',
  FOLIAGE: 'FOLIAGE',
  PLANT: 'PLANT',
};

function parseItemInput(input: unknown): CatalogItemInput {
  const parsed = catalogItemInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

async function assertCanonicalCompatible(
  tx: Prisma.TransactionClient,
  input: CatalogItemInput,
): Promise<void> {
  if (input.canonicalFlowerId === null) return;
  const canonical = await tx.canonicalFlower.findUnique({
    where: { id: input.canonicalFlowerId },
    select: { category: true },
  });
  if (!canonical || canonical.category !== CATEGORY_BY_TYPE[input.type]) {
    throw new ValidationError({ canonicalFlowerId: 'invalid_option' });
  }
}

function itemData(input: CatalogItemInput) {
  return {
    name: input.name,
    description: input.description,
    sku: input.sku,
    canonicalFlowerId: input.canonicalFlowerId,
    variety: input.variety,
    colors: [...input.colors],
    saleUnit: input.saleUnit,
    priceMinor: input.priceMinor,
    costMinor: input.costMinor,
    availability: input.availability,
    prepMinutes: input.prepMinutes,
    heightCm: input.heightCm,
    widthCm: input.widthCm,
    tags: [...input.tags],
  };
}

export async function createCatalogItem(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<CatalogItemDto> {
  requirePermission(ctx, 'catalog:write');
  const input = parseItemInput(rawInput);
  try {
    return await withTenantContext(getDb(), ctx, async (tx) => {
      await assertCanonicalCompatible(tx, input);
      const created = await tx.catalogItem.create({
        data: {
          tenantId: ctx.tenantId,
          type: input.type,
          currency: ctx.currency,
          ...itemData(input),
          // Ogni bouquet nasce con la sua distinta (vuota), da completare nell'editor.
          // Il tenantId della distinta è ereditato dall'articolo (FK composita).
          ...(input.type === 'BOUQUET' ? { recipe: { create: {} } } : {}),
        },
        include: itemInclude,
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.catalogItemCreated,
        entityType: 'CatalogItem',
        entityId: created.id,
        metadata: { name: created.name, type: created.type },
      });
      return toDto(created, ctx);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'sku')) throw new ConflictError('sku_taken');
    throw error;
  }
}

const AUDITED_FIELDS = [
  'name',
  'description',
  'sku',
  'canonicalFlowerId',
  'variety',
  'colors',
  'saleUnit',
  'priceMinor',
  'costMinor',
  'availability',
  'prepMinutes',
  'heightCm',
  'widthCm',
  'tags',
] as const;

export async function updateCatalogItem(
  ctx: TenantContext,
  itemId: string,
  rawInput: unknown,
): Promise<CatalogItemDto> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(itemId)) throw new NotFoundError('CatalogItem');
  const input = parseItemInput(rawInput);

  let result: CatalogItemDto | null;
  try {
    result = await withTenantContext(getDb(), ctx, async (tx) => {
      const existing = await tx.catalogItem.findFirst({
        where: { id: itemId, tenantId: ctx.tenantId },
      });
      if (!existing) return null;
      if (existing.type !== input.type) throw new ValidationError({ type: 'invalid_option' });
      await assertCanonicalCompatible(tx, input);

      const data = itemData(input);
      const changes = diffFields(existing, data, AUDITED_FIELDS);
      const updated = await tx.catalogItem.update({
        where: { id: existing.id },
        data,
        include: itemInclude,
      });
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, ctx, {
          action: AUDIT_ACTIONS.catalogItemUpdated,
          entityType: 'CatalogItem',
          entityId: existing.id,
          metadata: { name: updated.name, changes: JSON.parse(JSON.stringify(changes)) },
        });
      }
      return toDto(updated, ctx);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'sku')) throw new ConflictError('sku_taken');
    throw error;
  }
  if (!result) return notFound(ctx, 'CatalogItem', itemId);
  return result;
}

export async function setCatalogItemArchived(
  ctx: TenantContext,
  itemId: string,
  archived: boolean,
): Promise<CatalogItemDto> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(itemId)) throw new NotFoundError('CatalogItem');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const existing = await tx.catalogItem.findFirst({
      where: { id: itemId, tenantId: ctx.tenantId },
    });
    if (!existing) return null;
    const targetStatus: RecordStatus = archived ? 'ARCHIVED' : 'ACTIVE';
    if (existing.status === targetStatus) {
      const same = await tx.catalogItem.findUniqueOrThrow({
        where: { id: existing.id },
        include: itemInclude,
      });
      return toDto(same, ctx);
    }
    const updated = await tx.catalogItem.update({
      where: { id: existing.id },
      data: { status: targetStatus, archivedAt: archived ? new Date() : null },
      include: itemInclude,
    });
    await recordAudit(tx, ctx, {
      action: archived ? AUDIT_ACTIONS.catalogItemArchived : AUDIT_ACTIONS.catalogItemRestored,
      entityType: 'CatalogItem',
      entityId: existing.id,
      metadata: { name: existing.name },
    });
    return toDto(updated, ctx);
  });
  if (!result) return notFound(ctx, 'CatalogItem', itemId);
  return result;
}

export interface CanonicalFlowerOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly scientificName: string;
  readonly category: CanonicalCategory;
}

/** Tassonomia globale (non contiene dati di tenant). */
export async function listCanonicalFlowers(
  locale: string,
): Promise<readonly CanonicalFlowerOption[]> {
  const resolved = resolveLocale(locale);
  const flowers = await getDb().canonicalFlower.findMany({ orderBy: { slug: 'asc' } });
  return flowers
    .map((flower) => ({
      id: flower.id,
      slug: flower.slug,
      name: localizedName(flower.names, resolved) ?? flower.slug,
      scientificName: flower.scientificName,
      category: flower.category,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, resolved));
}

export interface IngredientOption {
  readonly id: string;
  readonly name: string;
  readonly variety: string | null;
  readonly type: CatalogItemType;
  readonly saleUnit: SaleUnit;
  readonly availability: Availability;
}

/** Articoli attivi utilizzabili come ingredienti di una distinta. */
export async function listIngredientOptions(
  ctx: TenantContext,
): Promise<readonly IngredientOption[]> {
  requirePermission(ctx, 'catalog:read');
  return withTenantContext(getDb(), ctx, (tx) =>
    tx.catalogItem.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', type: { in: [...INGREDIENT_TYPES] } },
      select: {
        id: true,
        name: true,
        variety: true,
        type: true,
        saleUnit: true,
        availability: true,
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }),
  );
}
