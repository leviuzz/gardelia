'use server';

/**
 * Server action del Bouquet Builder. Il client invia solo ID, quantità e dettagli:
 * prezzi, costi e disponibilità sono riletti e ricalcolati dal servizio (@floral/core).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  requestBouquetPreview,
  saveBouquetConfiguration,
  setBouquetConfigurationArchived,
} from '@floral/core';
import { actionError, type ActionState } from '@/lib/actions';
import { getTenantContext } from '@/lib/tenant';

export async function saveDesignAction(
  slug: string,
  configurationId: string | null,
  _prev: ActionState,
  payload: unknown,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  let id: string;
  try {
    id = (await saveBouquetConfiguration(ctx, payload, configurationId ?? undefined)).id;
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/builder`, 'layout');
  if (configurationId === null) redirect(`/app/${ctx.tenantSlug}/builder/${id}?saved=1`);
  const t = await getTranslations('builder.editor');
  return { status: 'success', message: t('saved') };
}

export async function setDesignArchivedAction(
  slug: string,
  configurationId: string,
  archived: boolean,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await setBouquetConfigurationArchived(ctx, configurationId, archived);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/builder`, 'layout');
  const t = await getTranslations('common');
  return { status: 'success', message: t('changesSaved') };
}

/** Richiede l'anteprima AI del disegno salvato: credito e cache gestiti dal servizio. */
export async function requestPreviewAction(
  slug: string,
  configurationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await requestBouquetPreview(ctx, configurationId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/builder/${configurationId}`);
  const t = await getTranslations('builder.preview');
  return { status: 'success', message: t('requested') };
}
