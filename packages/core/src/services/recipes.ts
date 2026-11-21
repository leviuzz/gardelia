/**
 * Distinta base (BOM) dei bouquet [CAT-01, INV-01 parziale].
 * La distinta è la fonte di verità per composizione e costi (mai l'immagine AI).
 */
import { getDb, isUniqueViolation, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  RECIPE_LIMITS,
  computeRecipeCosting,
  isIngredientType,
  isUuid,
  recipeDetailsInputSchema,
  recipeLineInputSchema,
  toFieldErrors,
  type Availability,
  type CatalogItemType,
  type RecipeCosting,
  type RecordStatus,
  type SaleUnit,
  type SubstitutionPolicy,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

export interface RecipeLineDto {
  readonly id: string;
  readonly quantity: number;
  readonly ingredient: {
    readonly id: string;
    readonly name: string;
    readonly variety: string | null;
    readonly type: CatalogItemType;
    readonly saleUnit: SaleUnit;
    readonly availability: Availability;
    readonly status: RecordStatus;
    readonly priceMinor: number;
    /** null se non compilato o se l'utente non può vedere i costi. */
    readonly costMinor: number | null;
  };
}

export interface RecipeDto {
  readonly recipeId: string | null;
  readonly bouquet: { readonly id: string; readonly name: string; readonly priceMinor: number };
  readonly lines: readonly RecipeLineDto[];
  readonly laborCostMinor: number | null;
  readonly styleTags: readonly string[];
  readonly notes: string | null;
  readonly substitutionPolicy: SubstitutionPolicy;
  /** null per chi non può vedere i costi. */
  readonly costing: RecipeCosting | null;
  readonly componentsRetailMinor: number;
  readonly hasUnavailableIngredients: boolean;
  readonly canEdit: boolean;
}

async function loadBouquet(tx: TransactionClient, ctx: TenantContext, bouquetId: string) {
  return tx.catalogItem.findFirst({
    where: { id: bouquetId, tenantId: ctx.tenantId },
    select: { id: true, name: true, type: true, priceMinor: true },
  });
}

export async function getRecipe(ctx: TenantContext, bouquetId: string): Promise<RecipeDto> {
  requirePermission(ctx, 'catalog:read');
  if (!isUuid(bouquetId)) throw new NotFoundError('CatalogItem');
  const canSeeCosts = hasPermission(ctx, 'catalog:costs:read');

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const bouquet = await loadBouquet(tx, ctx, bouquetId);
    if (!bouquet) return null;
    if (bouquet.type !== 'BOUQUET') throw new ConflictError('not_a_bouquet');
    const recipe = await tx.bouquetRecipe.findFirst({
      where: { tenantId: ctx.tenantId, catalogItemId: bouquet.id },
      include: {
        lines: {
          where: { tenantId: ctx.tenantId },
          include: { ingredient: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    return { bouquet, recipe };
  });
  if (!result) return notFound(ctx, 'CatalogItem', bouquetId);

  const { bouquet, recipe } = result;
  const lines: RecipeLineDto[] = (recipe?.lines ?? []).map((line) => ({
    id: line.id,
    quantity: line.quantity,
    ingredient: {
      id: line.ingredient.id,
      name: line.ingredient.name,
      variety: line.ingredient.variety,
      type: line.ingredient.type,
      saleUnit: line.ingredient.saleUnit,
      availability: line.ingredient.availability,
      status: line.ingredient.status,
      priceMinor: line.ingredient.priceMinor,
      costMinor: canSeeCosts ? line.ingredient.costMinor : null,
    },
  }));

  const laborCostMinor = recipe?.laborCostMinor ?? null;
  const costing = computeRecipeCosting({
    salePriceMinor: bouquet.priceMinor,
    laborCostMinor,
    lines: lines.map((line) => ({
      quantity: line.quantity,
      unitPriceMinor: line.ingredient.priceMinor,
      unitCostMinor: line.ingredient.costMinor,
    })),
  });

  return {
    recipeId: recipe?.id ?? null,
    bouquet: { id: bouquet.id, name: bouquet.name, priceMinor: bouquet.priceMinor },
    lines,
    laborCostMinor: canSeeCosts ? laborCostMinor : null,
    styleTags: recipe?.styleTags ?? [],
    notes: recipe?.notes ?? null,
    substitutionPolicy: recipe?.substitutionPolicy ?? 'ASK_CUSTOMER',
    costing: canSeeCosts ? costing : null,
    componentsRetailMinor: costing.componentsRetailMinor,
    hasUnavailableIngredients: lines.some(
      (line) =>
        line.ingredient.status === 'ARCHIVED' || line.ingredient.availability === 'OUT_OF_STOCK',
    ),
    canEdit: hasPermission(ctx, 'catalog:write'),
  };
}

/** Restituisce la distinta del bouquet, creandola se manca. */
async function ensureRecipe(tx: TransactionClient, ctx: TenantContext, bouquetId: string) {
  const bouquet = await loadBouquet(tx, ctx, bouquetId);
  if (!bouquet) return null;
  if (bouquet.type !== 'BOUQUET') throw new ConflictError('not_a_bouquet');
  const recipe = await tx.bouquetRecipe.upsert({
    where: { tenantId_catalogItemId: { tenantId: ctx.tenantId, catalogItemId: bouquet.id } },
    update: {},
    create: { tenantId: ctx.tenantId, catalogItemId: bouquet.id },
  });
  return { bouquet, recipe };
}

export async function addRecipeLine(ctx: TenantContext, bouquetId: string, rawInput: unknown): Promise<void> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(bouquetId)) throw new NotFoundError('CatalogItem');
  const parsed = recipeLineInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;

  let found: boolean;
  try {
    found = await withTenantContext(getDb(), ctx, async (tx) => {
      const target = await ensureRecipe(tx, ctx, bouquetId);
      if (!target) return false;

      // L'ingrediente deve appartenere allo STESSO tenant ed essere un tipo ammesso.
      const ingredient = await tx.catalogItem.findFirst({
        where: { id: input.ingredientItemId, tenantId: ctx.tenantId, status: 'ACTIVE' },
        select: { id: true, name: true, type: true },
      });
      if (!ingredient || !isIngredientType(ingredient.type)) {
        throw new ValidationError({ ingredientItemId: 'invalid_option' });
      }

      const lineCount = await tx.bouquetRecipeLine.count({
        where: { tenantId: ctx.tenantId, recipeId: target.recipe.id },
      });
      if (lineCount >= RECIPE_LIMITS.linesMax) throw new ConflictError('recipe_line_limit');

      const line = await tx.bouquetRecipeLine.create({
        data: {
          tenantId: ctx.tenantId,
          recipeId: target.recipe.id,
          ingredientItemId: ingredient.id,
          quantity: input.quantity,
          sortOrder: lineCount,
        },
      });
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.recipeLineAdded,
        entityType: 'BouquetRecipeLine',
        entityId: line.id,
        metadata: {
          bouquetId: target.bouquet.id,
          bouquetName: target.bouquet.name,
          ingredientName: ingredient.name,
          quantity: input.quantity,
        },
      });
      return true;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('ingredient_already_in_recipe');
    throw error;
  }
  if (!found) await notFound(ctx, 'CatalogItem', bouquetId);
}

async function loadLine(tx: TransactionClient, ctx: TenantContext, bouquetId: string, lineId: string) {
  return tx.bouquetRecipeLine.findFirst({
    where: {
      id: lineId,
      tenantId: ctx.tenantId,
      recipe: { tenantId: ctx.tenantId, catalogItemId: bouquetId },
    },
    include: { ingredient: { select: { name: true } }, recipe: { select: { catalogItemId: true } } },
  });
}

export async function updateRecipeLineQuantity(
  ctx: TenantContext,
  bouquetId: string,
  lineId: string,
  rawQuantity: unknown,
): Promise<void> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(bouquetId) || !isUuid(lineId)) throw new NotFoundError('BouquetRecipeLine');
  const parsed = recipeLineInputSchema.shape.quantity.safeParse(rawQuantity);
  if (!parsed.success) throw new ValidationError({ quantity: 'out_of_range' });

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const line = await loadLine(tx, ctx, bouquetId, lineId);
    if (!line) return false;
    if (line.quantity === parsed.data) return true;
    await tx.bouquetRecipeLine.update({ where: { id: line.id }, data: { quantity: parsed.data } });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.recipeLineUpdated,
      entityType: 'BouquetRecipeLine',
      entityId: line.id,
      metadata: {
        bouquetId,
        ingredientName: line.ingredient.name,
        changes: { quantity: { from: line.quantity, to: parsed.data } },
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'BouquetRecipeLine', lineId);
}

export async function removeRecipeLine(ctx: TenantContext, bouquetId: string, lineId: string): Promise<void> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(bouquetId) || !isUuid(lineId)) throw new NotFoundError('BouquetRecipeLine');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const line = await loadLine(tx, ctx, bouquetId, lineId);
    if (!line) return false;
    await tx.bouquetRecipeLine.delete({ where: { id: line.id } });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.recipeLineRemoved,
      entityType: 'BouquetRecipeLine',
      entityId: line.id,
      metadata: { bouquetId, ingredientName: line.ingredient.name, quantity: line.quantity },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'BouquetRecipeLine', lineId);
}

export async function updateRecipeDetails(ctx: TenantContext, bouquetId: string, rawInput: unknown): Promise<void> {
  requirePermission(ctx, 'catalog:write');
  if (!isUuid(bouquetId)) throw new NotFoundError('CatalogItem');
  const parsed = recipeDetailsInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const target = await ensureRecipe(tx, ctx, bouquetId);
    if (!target) return false;
    await tx.bouquetRecipe.update({
      where: { id: target.recipe.id },
      data: {
        laborCostMinor: parsed.data.laborCostMinor,
        styleTags: [...parsed.data.styleTags],
        notes: parsed.data.notes,
        substitutionPolicy: parsed.data.substitutionPolicy,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.recipeUpdated,
      entityType: 'BouquetRecipe',
      entityId: target.recipe.id,
      metadata: { bouquetId, bouquetName: target.bouquet.name },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CatalogItem', bouquetId);
}
