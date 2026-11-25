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
  setCatalogItemFeatured,
  setCatalogItemOnline,
  setCatalogItemsOnline,
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

/**
 * Stella «In evidenza» dell'elenco del catalogo (M1): il valore arriva dal pulsante premuto
 * (`featured=on|off`); il servizio ricontrolla permessi, prodotto online e il limite di 8.
 */
export async function setItemFeaturedAction(
  slug: string,
  itemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const featured = formData.get('featured') === 'on';
    await setCatalogItemFeatured(ctx, itemId, featured);
    return {
      revalidate: [section(routes.catalog.list()), routes.settings.store],
      success: featured ? 'catalog.featuredOn' : 'catalog.featuredOff',
    };
  });
}

/**
 * Interruttore "Tienda en línea" dell'elenco del catalogo: il valore arriva dal pulsante premuto
 * (`online=on|off`); il servizio ricontrolla permessi, tipo e stato del prodotto.
 */
export async function setItemOnlineAction(
  slug: string,
  itemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const online = formData.get('online') === 'on';
    await setCatalogItemOnline(ctx, itemId, online);
    return {
      // Anche "Mi tienda en línea": conta i prodotti visibili e dice se si può pubblicare.
      revalidate: [section(routes.catalog.list()), routes.settings.store],
      success: online ? 'catalog.onlineShown' : 'catalog.onlineHidden',
    };
  });
}

/**
 * «Mostra nel negozio» / «Togli dal negozio» per i prodotti scelti nel Catalogo (M1-2): gli ID e
 * il pulsante premuto arrivano dal client; il servizio ricontrolla tutto e dice quanti ne ha
 * cambiati e quanti ha saltato.
 */
export async function setItemsOnlineAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const online = formData.get('online') === 'on';
    const ids = formData.getAll('itemId').map(String);
    const { changed, skipped } = await setCatalogItemsOnline(ctx, ids, online);
    return {
      revalidate: [section(routes.catalog.list()), routes.settings.store],
      success: (t) =>
        [
          t(online ? 'catalog.bulk.shown' : 'catalog.bulk.hidden', { count: changed }),
          skipped > 0 ? t('catalog.bulk.skipped', { count: skipped }) : null,
        ]
          .filter(Boolean)
          .join(' '),
    };
  });
}
