'use server';

/**
 * "Recuperar" una fioreria in eliminazione (ADR-074), dalla scelta della fioreria. Qui la fioreria
 * è archiviata, quindi niente `runTenantAction`: il servizio ricava fioreria e titolare dalla
 * sessione e dallo slug, e risponde "non trovata" a chi non è il titolare.
 */
import { redirect } from 'next/navigation';
import { restoreTenant } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { actionError } from '@/lib/actions';
import { getRequestMeta } from '@/lib/request-meta';
import { appRoutes, tenantRoutes } from '@/lib/routes';
import { requireUser } from '@/lib/session';

export async function restoreShopAction(
  slug: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await requireUser(appRoutes.home);
  let restored: string;
  try {
    ({ slug: restored } = await restoreTenant({
      userId: user.id,
      slug,
      request: await getRequestMeta(),
    }));
  } catch (error) {
    return actionError(error);
  }
  redirect(tenantRoutes(restored).home);
}
