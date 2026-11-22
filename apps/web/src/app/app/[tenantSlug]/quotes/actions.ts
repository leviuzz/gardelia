'use server';

/**
 * Server action dei preventivi. Prezzi e totali sono calcolati SOLO dal servizio
 * (@floral/core) leggendo il catalogo del tenant: il client invia ID e quantità.
 * Contesto, errori, pagine da ricaricare e messaggi: `runTenantAction`.
 */
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
import type { ActionState } from '@/lib/action-state';
import { formDataToObject } from '@/lib/form-data';
import { runTenantAction, section } from '@/lib/tenant-action';

export async function createQuoteAction(
  slug: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const customerId = formData.get('customerId');
    const configurationId = formData.get('configurationId');
    // Da un disegno del Diseñador: prezzo e distinta ricalcolati dal servizio.
    const { id } =
      typeof configurationId === 'string' && configurationId !== ''
        ? await createQuoteFromConfiguration(ctx, { configurationId, customerId })
        : await createQuote(ctx, { customerId });
    return { revalidate: routes.quotes.list(), redirectTo: routes.quotes.detail(id) };
  });
}

export async function addCatalogLineAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCatalogItemToQuote(ctx, quoteId, formDataToObject(formData));
    return { revalidate: routes.quotes.detail(quoteId), success: 'quotes.editor.lineAdded' };
  });
}

export async function addCustomLineAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCustomLineToQuote(ctx, quoteId, formDataToObject(formData));
    return { revalidate: routes.quotes.detail(quoteId), success: 'quotes.editor.lineAdded' };
  });
}

export async function updateLineQuantityAction(
  slug: string,
  quoteId: string,
  lineId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateQuoteLineQuantity(ctx, quoteId, lineId, formData.get('quantity'));
    return { revalidate: routes.quotes.detail(quoteId), success: 'quotes.editor.lineUpdated' };
  });
}

export async function removeLineAction(
  slug: string,
  quoteId: string,
  lineId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await removeQuoteLine(ctx, quoteId, lineId);
    return { revalidate: routes.quotes.detail(quoteId), success: 'quotes.editor.lineRemoved' };
  });
}

export async function updateDetailsAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await updateQuoteDetails(ctx, quoteId, formDataToObject(formData));
    return { revalidate: routes.quotes.detail(quoteId), success: 'quotes.editor.detailsSaved' };
  });
}

/** Lo stato richiesto arriva dal pulsante premuto: il servizio verifica la transizione. */
export async function changeStatusAction(
  slug: string,
  quoteId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const status = await changeQuoteStatus(ctx, quoteId, formData.get('status'));
    return {
      revalidate: section(routes.quotes.list()),
      success: (t) => t('quotes.editor.statusChanged', { status: t(`quotes.statuses.${status}`) }),
    };
  });
}
