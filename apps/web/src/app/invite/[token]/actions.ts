'use server';

import { redirect } from 'next/navigation';
import { acceptInvitation } from '@floral/core';
import { actionError, type ActionState } from '@/lib/actions';
import { getRequestMeta } from '@/lib/request-meta';
import { tenantRoutes } from '@/lib/routes';
import { requireUser } from '@/lib/session';

export async function acceptInvitationAction(
  token: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await requireUser(`/invite/${token}`);
  let slug: string;
  try {
    const result = await acceptInvitation({
      token,
      userId: user.id,
      userEmail: user.email,
      request: await getRequestMeta(),
    });
    slug = result.tenantSlug;
  } catch (error) {
    return actionError(error);
  }
  redirect(tenantRoutes(slug).home);
}
