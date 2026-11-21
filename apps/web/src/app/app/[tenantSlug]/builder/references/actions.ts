'use server';

/**
 * Server action di "Mis ramos". Una foto per richiesta; il servizio ricontrolla permessi,
 * piano, consenso e immagine. Gli argomenti legati con .bind() non sono fidati.
 */
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { addStyleReference, archiveStyleReference } from '@floral/core';
import { actionError, type ActionState } from '@/lib/actions';
import { getTenantContext } from '@/lib/tenant';
import { uploadedBytes } from '@/lib/uploads';

export async function uploadStyleReferenceAction(
  slug: string,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await addStyleReference(ctx, await uploadedBytes(formData), {
      style: formData.get('style'),
      caption: formData.get('caption'),
      consent: formData.get('consent'),
    });
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/builder/references`);
  return { status: 'success' };
}

export async function archiveStyleReferenceAction(
  slug: string,
  referenceId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const ctx = await getTenantContext(slug);
  try {
    await archiveStyleReference(ctx, referenceId);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath(`/app/${ctx.tenantSlug}/builder/references`);
  const t = await getTranslations('styleReferences');
  return { status: 'success', message: t('removed') };
}
