'use server';

import { redirect } from 'next/navigation';
import { createTenant } from '@floral/core';
import { actionError, type ActionState } from '@/lib/actions';
import { formDataToObject } from '@/lib/form-data';
import { getRequestMeta } from '@/lib/request-meta';
import { requireUser } from '@/lib/session';

export async function createTenantAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser('/onboarding');
  let slug: string;
  try {
    const result = await createTenant({
      userId: user.id,
      country: 'MX',
      data: formDataToObject(formData),
      request: await getRequestMeta(),
    });
    slug = result.slug;
  } catch (error) {
    return actionError(error);
  }
  redirect(`/app/${slug}`);
}
