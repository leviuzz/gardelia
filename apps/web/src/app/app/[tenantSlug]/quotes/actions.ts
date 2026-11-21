'use server';

/**
 * Server action dei preventivi. Prezzi e totali sono calcolati SOLO dal servizio
 * (@floral/core) leggendo il catalogo del tenant: il client invia ID e quantità.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  addCatalogItemToQuote,
  addCustomLineToQuote,
  changeQuoteStatus,
  createQuote,
  createQuoteFromConfiguration,
  removeQuoteLine,
  updateQuoteDetails,
  updateQuoteLineQuantity,
} from '@floral/core';
import { actionError, type ActionState } from '@/lib/actions';
import { formDataToObject } from '@/lib/form-data';
import { getTenantContext } from '@/lib/tenant';

function quotePath(slug: string, quoteId: string): string {
  return `/app/${slug}/quotes/${quoteId}`;
}

export async function createQuoteAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  const customerId = formData.get('customerId');
  const configurationId = formData.get('configurationId');
  let quoteId: string;
  try {
    // Da un disegno del Builder: prezzo e distinta ricalcolati dal servizio.
    quoteId =
      typeof configurationId === 'string' && configurationId !== ''
        ? (await createQuoteFromConfiguration(ctx, { configurationId, customerId })).id
        : (await createQuote(ctx, { customerId })).id;
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/quotes`);
  redirect(quotePath(ctx.tenantSlug, quoteId));
}

async function lineAdded(): Promise<ActionState> {
  const t = await getTranslations('quotes.editor');
  return { status: 'success', message: t('lineAdded') };
}

export async function addCatalogLineAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await addCatalogItemToQuote(ctx, quoteId, formDataToObject(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(quotePath(ctx.tenantSlug, quoteId));
  return lineAdded();
}

export async function addCustomLineAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await addCustomLineToQuote(ctx, quoteId, formDataToObject(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(quotePath(ctx.tenantSlug, quoteId));
  return lineAdded();
}

export async function updateLineQuantityAction(
  slug: string,
  quoteId: string,
  lineId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await updateQuoteLineQuantity(ctx, quoteId, lineId, formData.get('quantity'));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(quotePath(ctx.tenantSlug, quoteId));
  const t = await getTranslations('quotes.editor');
  return { status: 'success', message: t('lineUpdated') };
}

export async function removeLineAction(
  slug: string,
  quoteId: string,
  lineId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await removeQuoteLine(ctx, quoteId, lineId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(quotePath(ctx.tenantSlug, quoteId));
  const t = await getTranslations('quotes.editor');
  return { status: 'success', message: t('lineRemoved') };
}

export async function updateDetailsAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await updateQuoteDetails(ctx, quoteId, formDataToObject(formData));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(quotePath(ctx.tenantSlug, quoteId));
  const t = await getTranslations('quotes.editor');
  return { status: 'success', message: t('detailsSaved') };
}

/** Lo stato richiesto arriva dal pulsante premuto: il servizio verifica la transizione. */
export async function changeStatusAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  let result: string;
  try {
    result = await changeQuoteStatus(ctx, quoteId, formData.get('status'));
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/quotes`, 'layout');
  const t = await getTranslations('quotes');
  return {
    status: 'success',
    message: t('editor.statusChanged', { status: t(`statuses.${result}`) }),
  };
}
