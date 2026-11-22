import { timingSafeEqual } from 'node:crypto';

/**
 * Richiesta interna autorizzata (avvio dei job AI, Vercel Cron): intestazione
 * `Authorization: Bearer <CRON_SECRET>`, confrontata in tempo costante. Senza segreto
 * configurato nessuna richiesta è autorizzata.
 */
export function isAuthorizedInternalRequest(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  const prefix = 'Bearer ';
  if (!secret || !authorization?.startsWith(prefix)) return false;
  const given = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
