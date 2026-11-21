import 'server-only';
import { headers } from 'next/headers';
import type { RequestMeta } from '@floral/core';

/** requestId (impostato da proxy.ts) e IP del client, per audit e log. */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get(process.env.TRUSTED_IP_HEADER ?? 'x-forwarded-for');
  const ipAddress = forwarded?.split(',')[0]?.trim() || undefined;
  return { requestId: h.get('x-request-id') ?? undefined, ipAddress };
}
