'use server';

/**
 * "Dispositivos conectados" (ADR-077): la persona e la sessione in uso vengono SOLO dalla sessione;
 * l'ID della sessione da chiudere, legato con .bind(), arriva dal browser e il servizio lo cerca
 * solo fra le sessioni della persona.
 */
import { redirect } from 'next/navigation';
import { revokeAccountSession, revokeOtherAccountSessions } from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { getRequestMeta } from '@/lib/request-meta';
import { securityRoutes } from '@/lib/routes';
import { getSession } from '@/lib/session';
import { nextOutcomeDeps, settleAction } from '@/lib/tenant-action';

async function currentSession() {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(securityRoutes.home())}`);
  return session;
}

export async function revokeSessionAction(
  sessionId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const session = await currentSession();
  return settleAction(nextOutcomeDeps, async () => {
    await revokeAccountSession({
      userId: session.user.id,
      currentSessionId: session.session.id,
      sessionId,
      request: await getRequestMeta(),
    });
    return { revalidate: securityRoutes.home(), success: 'security.sessions.revoked' };
  });
}

export async function revokeOtherSessionsAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const session = await currentSession();
  return settleAction(nextOutcomeDeps, async () => {
    await revokeOtherAccountSessions({
      userId: session.user.id,
      currentSessionId: session.session.id,
      request: await getRequestMeta(),
    });
    return { revalidate: securityRoutes.home(), success: 'security.sessions.othersRevoked' };
  });
}
