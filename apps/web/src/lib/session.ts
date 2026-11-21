import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from './auth';

/** Sessione corrente (verificata lato server), deduplicata per richiesta. */
export const getSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() });
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSession>>>['user'];

/** Utente autenticato o redirect al login (con ritorno alla pagina richiesta). */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  return session.user;
}

/** Accetta solo percorsi interni come destinazione post-login (niente open redirect). */
export function safeNextPath(value: string | null | undefined, fallback = '/app'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}
