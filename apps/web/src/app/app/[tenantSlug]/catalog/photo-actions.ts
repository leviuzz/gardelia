'use server';

/**
 * Server action delle foto del catalogo. Il browser carica una foto per richiesta; ogni
 * action risolve di nuovo il contesto tenant e delega al servizio, che ricontrolla permessi,
 * tenant, tipo e dimensioni dell'immagine. Gli argomenti legati con .bind() non sono fidati.
 */
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { addCatalogItemPhoto, archiveCatalogItemPhoto } from '@floral/core';
import { actionError, type ActionState } from '@/lib/actions';
import { getTenantContext } from '@/lib/tenant';
import { uploadedBytes } from '@/lib/uploads';

export async function uploadCatalogPhotoAction(
  slug: string,
  itemId: string,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await addCatalogItemPhoto(ctx, itemId, await uploadedBytes(formData), {
      view: formData.get('view'),
      color: formData.get('color'),
    });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/catalog`, 'layout');
  return { status: 'success' };
}

export async function archiveCatalogPhotoAction(
  slug: string,
  photoId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await archiveCatalogItemPhoto(ctx, photoId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/catalog`, 'layout');
  const t = await getTranslations('photos');
  return { status: 'success', message: t('removed') };
}
