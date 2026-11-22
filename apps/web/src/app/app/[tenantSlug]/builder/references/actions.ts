'use server';

/**
 * Server action di "Mis ramos". Una foto per richiesta; il servizio ricontrolla permessi,
 * piano, consenso e immagine. Contesto ed errori: `runTenantAction`. Gli argomenti legati con
 * .bind() non sono fidati.
 */
import { addStyleReference, archiveStyleReference } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { runTenantAction } from '@/lib/tenant-action';
import { uploadedBytes } from '@/lib/uploads';

export async function uploadStyleReferenceAction(
  slug: string,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addStyleReference(ctx, await uploadedBytes(formData), {
      style: formData.get('style'),
      caption: formData.get('caption'),
      consent: formData.get('consent'),
    });
    return { revalidate: routes.builder.references };
  });
}

export async function archiveStyleReferenceAction(
  slug: string,
  referenceId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await archiveStyleReference(ctx, referenceId);
    return { revalidate: routes.builder.references, success: 'styleReferences.removed' };
  });
}
