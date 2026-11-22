'use server';

/**
 * Server action del catalogo: validano l'input con gli schemi del dominio e delegano al servizio
 * di @floral/core, che ricontrolla permessi e fioreria. Contesto, errori, pagine da ricaricare e
 * messaggi: `runTenantAction` (lib/tenant-action.ts). Gli argomenti legati con .bind() arrivano
 * dal client: non sono affidabili.
 */
import { z } from 'zod';
import {
  addRecipeLine,
  createCatalogItem,
  removeRecipeLine,
  setCatalogItemArchived,
  updateCatalogItem,
  updateRecipeDetails,
  updateRecipeLineQuantity,
} from '@floral/core';
import {
  allowsPhotos,
  catalogItemFormSchema,
  recipeDetailsFormSchema,
  recipeLineFormSchema,
  requiredInteger,
  RECIPE_LIMITS,
} from '@floral/domain';
import type { ActionState } from '@/lib/action-state';
import { parseForm } from '@/lib/form-data';
import { runTenantAction, section } from '@/lib/tenant-action';

export async function createItemAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const input = parseForm(catalogItemFormSchema(ctx.currency), formData, ['colors']);
    const { id } = await createCatalogItem(ctx, input);
    // Creazione guidata: poi la foto (se il tipo ne ha) e il passo finale.
    return {
      revalidate: routes.catalog.list(),
      redirectTo: allowsPhotos(input.type)
        ? routes.catalog.added(id)
        : routes.catalog.added(id, { step: 'done' }),
    };
  });
}

export async function updateItemAction(
  slug: string,
  itemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const input = parseForm(catalogItemFormSchema(ctx.currency), formData, ['colors']);
    await updateCatalogItem(ctx, itemId, input);
    return { revalidate: section(routes.catalog.list()), success: 'common.changesSaved' };
  });
}

export async function setArchivedAction(
  slug: string,
  itemId: string,
  archived: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await setCatalogItemArchived(ctx, itemId, archived);
    return {
      revalidate: section(routes.catalog.list()),
      success: archived ? 'catalog.form.archived' : 'catalog.form.restored',
    };
  });
}

export async function addRecipeLineAction(
  slug: string,
  bouquetId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addRecipeLine(ctx, bouquetId, parseForm(recipeLineFormSchema, formData));
    return { revalidate: routes.catalog.item(bouquetId), success: 'recipe.lineAdded' };
  });
}

const quantityForm = z.object({
  quantity: requiredInteger({ min: 1, max: RECIPE_LIMITS.quantityMax }),
});

export async function updateRecipeLineAction(
  slug: string,
  bouquetId: string,
  lineId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { quantity } = parseForm(quantityForm, formData);
    await updateRecipeLineQuantity(ctx, bouquetId, lineId, quantity);
    return { revalidate: routes.catalog.item(bouquetId), success: 'recipe.lineUpdated' };
  });
}

export async function removeRecipeLineAction(
  slug: string,
  bouquetId: string,
  lineId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeRecipeLine(ctx, bouquetId, lineId);
    return { revalidate: routes.catalog.item(bouquetId), success: 'recipe.lineRemoved' };
  });
}

export async function updateRecipeDetailsAction(
  slug: string,
  bouquetId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateRecipeDetails(
      ctx,
      bouquetId,
      parseForm(recipeDetailsFormSchema(ctx.currency), formData),
    );
    return { revalidate: routes.catalog.item(bouquetId), success: 'recipe.detailsSaved' };
  });
}
