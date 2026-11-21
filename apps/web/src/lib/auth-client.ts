'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Client Better Auth per i form di autenticazione. Le chiamate passano da /api/auth/*,
 * dove si applicano rate limiting e controllo dell'origine.
 */
export const authClient = createAuthClient();

/** Codici d'errore di Better Auth tradotti nell'interfaccia (chiavi `auth.errors.*`). */
export const KNOWN_AUTH_ERRORS = [
  'INVALID_EMAIL_OR_PASSWORD',
  'EMAIL_NOT_VERIFIED',
  'USER_ALREADY_EXISTS',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'INVALID_TOKEN',
  'INVALID_EMAIL',
  'FAILED_TO_CREATE_SESSION',
] as const;

export function authErrorKey(error: { code?: string | undefined; status?: number } | null): string {
  if (!error) return 'generic';
  if (error.status === 429) return 'TOO_MANY_REQUESTS';
  const code = error.code ?? '';
  return (KNOWN_AUTH_ERRORS as readonly string[]).includes(code) ? code : 'generic';
}
