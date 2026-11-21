'use server';

/**
 * Server action del catalogo. Ogni action:
 *  1. risolve di nuovo il contesto tenant (sessione + membership) dallo slug;
 *  2. valida l'input del form con gli schemi del dominio;
 *  3. delega al servizio di @floral/core, che ricontrolla permessi e tenant.
 * Gli argomenti legati con .bind() arrivano dal client: non sono considerati affidabili.
 */
import { revalidatePath } from 'next/cache';
import type { ZodError } from 'zod';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ValidationError,
  addRecipeLine,
  createCatalogItem,
  removeRecipeLine,
  setCatalogItemArchived,
  updateCatalogItem,
  updateRecipeDetails,
  updateRecipeLineQuantity,
} from '@floral/core';
import {
  catalogItemFormSchema,
  recipeDetailsFormSchema,
  recipeLineFormSchema,
  requiredInteger,
  toFieldErrors,
  RECIPE_LIMITS,
} from '@floral/domain';
import { actionError, type ActionState } from '@/lib/actions';
import { formDataToObject } from '@/lib/form-data';
import { getTenantContext } from '@/lib/tenant';

function parseOrThrow<T>(
  result: { success: true; data: T } | { success: false; error: ZodError },
): T {
  if (!result.success) throw new ValidationError(toFieldErrors(result.error));
  return result.data;
}

export async function createItemAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  let itemId: string;
  try {
    const input = parseOrThrow(
      catalogItemFormSchema(ctx.currency).safeParse(formDataToObject(formData, ['colors'])),
    );
    itemId = (await createCatalogItem(ctx, input)).id;
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/catalog`);
  redirect(`/app/${ctx.tenantSlug}/catalog/${itemId}?created=1`);
}

export async function updateItemAction(
  slug: string,
  itemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    const input = parseOrThrow(
      catalogItemFormSchema(ctx.currency).safeParse(formDataToObject(formData, ['colors'])),
    );
    await updateCatalogItem(ctx, itemId, input);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/catalog`, 'layout');
  const t = await getTranslations('common');
  return { status: 'success', message: t('changesSaved') };
}

export async function setArchivedAction(
  slug: string,
  itemId: string,
  archived: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await setCatalogItemArchived(ctx, itemId, archived);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/catalog`, 'layout');
  const t = await getTranslations('catalog.form');
  return { status: 'success', message: archived ? t('archived') : t('restored') };
}

export async function addRecipeLineAction(
  slug: string,
  bouquetId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    const input = parseOrThrow(recipeLineFormSchema.safeParse(formDataToObject(formData)));
    await addRecipeLine(ctx, bouquetId, input);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/catalog/${bouquetId}`);
  const t = await getTranslations('recipe');
  return { status: 'success', message: t('lineAdded') };
}

const quantityField = requiredInteger({ min: 1, max: RECIPE_LIMITS.quantityMax });

export async function updateRecipeLineAction(
  slug: string,
  bouquetId: string,
  lineId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    const parsed = quantityField.safeParse(formData.get('quantity'));
    if (!parsed.success) {
      throw new ValidationError({ quantity: parsed.error.issues[0]?.message ?? 'invalid' });
    }
    await updateRecipeLineQuantity(ctx, bouquetId, lineId, parsed.data);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/catalog/${bouquetId}`);
  const t = await getTranslations('recipe');
  return { status: 'success', message: t('lineUpdated') };
}

export async function removeRecipeLineAction(
  slug: string,
  bouquetId: string,
  lineId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await removeRecipeLine(ctx, bouquetId, lineId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/catalog/${bouquetId}`);
  const t = await getTranslations('recipe');
  return { status: 'success', message: t('lineRemoved') };
}

export async function updateRecipeDetailsAction(
  slug: string,
  bouquetId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    const input = parseOrThrow(
      recipeDetailsFormSchema(ctx.currency).safeParse(formDataToObject(formData)),
    );
    await updateRecipeDetails(ctx, bouquetId, input);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/catalog/${bouquetId}`);
  const t = await getTranslations('recipe');
  return { status: 'success', message: t('detailsSaved') };
}
