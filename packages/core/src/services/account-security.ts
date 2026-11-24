/**
 * Sicurezza del conto (ADR-077): quando la verifica in due passaggi è obbligatoria e quali
 * dispositivi hanno una sessione aperta. La verifica e le sessioni le gestisce Better Auth
 * (identità); qui solo le regole della piattaforma e i dati da mostrare, letti per l'utente stesso.
 */
import { getDb, withUserContext } from '@floral/db';
import {
  AUDIT_ACTIONS,
  isUuid,
  twoFactorRequirement,
  type TwoFactorRequirement,
} from '@floral/domain';
import { recordPlatformSecurityEvent } from '../audit';
import type { RequestMeta } from '../context';
import { ConflictError, NotFoundError } from '../errors';
import { logger } from '../logger';

/**
 * Verifica in due passaggi per questa persona: attiva, obbligatoria (titolare con password di una
 * fioreria vera e attiva), entro quando, e se la scadenza è passata.
 *
 * "Titolare da" = l'ultima modifica della membership di titolare più vecchia: chi diventa titolare
 * dopo essere stato manager ha comunque i suoi 14 giorni.
 */
export async function getTwoFactorRequirement(
  userId: string,
  now: Date = new Date(),
): Promise<TwoFactorRequirement> {
  if (!isUuid(userId)) throw new TypeError('getTwoFactorRequirement: utente non valido');
  const [user, credentials, owner] = await withUserContext(getDb(), userId, (tx) =>
    Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
      tx.account.count({ where: { userId, providerId: 'credential' } }),
      tx.membership.findFirst({
        where: {
          userId,
          role: 'OWNER',
          status: 'ACTIVE',
          // Le fiorerie demo servono a provare: non obbligano nessuno.
          tenant: { status: 'ACTIVE', mode: 'LIVE' },
        },
        orderBy: { updatedAt: 'asc' },
        select: { updatedAt: true },
      }),
    ]),
  );
  return twoFactorRequirement(
    {
      enabled: user?.twoFactorEnabled === true,
      hasPassword: credentials > 0,
      ownerSince: owner?.updatedAt ?? null,
    },
    now,
  );
}

export interface AccountSessionDto {
  readonly id: string;
  readonly userAgent: string | null;
  readonly createdAt: Date;
  /** Ultimo rinnovo (Better Auth la rinnova al più una volta al giorno). */
  readonly lastSeenAt: Date;
  readonly current: boolean;
}

/**
 * I dispositivi collegati della persona (sessioni non scadute), dal più recente. Il token non esce
 * mai da qui: per chiuderne una si passa l'ID e il web lo ritrova fra quelle della persona.
 */
export async function listAccountSessions(
  userId: string,
  currentSessionId: string,
): Promise<AccountSessionDto[]> {
  if (!isUuid(userId)) throw new TypeError('listAccountSessions: utente non valido');
  const rows = await withUserContext(getDb(), userId, (tx) =>
    tx.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, updatedAt: true },
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastSeenAt: row.updatedAt,
    current: row.id === currentSessionId,
  }));
}

/**
 * "Cerrar sesión" su un altro dispositivo: solo fra le sessioni della persona, mai quella da cui
 * chiede (per quella c'è "Cerrar sesión"). Il dispositivo esce entro pochi minuti (la cache della
 * sessione nel cookie dura 5 minuti).
 */
export async function revokeAccountSession(input: {
  readonly userId: string;
  readonly currentSessionId: string;
  readonly sessionId: unknown;
  readonly request?: RequestMeta;
}): Promise<void> {
  const { userId, currentSessionId, sessionId } = input;
  if (!isUuid(userId)) throw new TypeError('revokeAccountSession: utente non valido');
  if (typeof sessionId !== 'string' || !isUuid(sessionId)) throw new NotFoundError('Session');
  if (sessionId === currentSessionId) throw new ConflictError('session_is_current');
  const removed = await withUserContext(getDb(), userId, (tx) =>
    tx.session.deleteMany({ where: { id: sessionId, userId } }),
  );
  if (removed.count !== 1) throw new NotFoundError('Session');
  logger.info({ userId }, 'sessione chiusa da un altro dispositivo');
  await recordPlatformSecurityEvent({
    action: AUDIT_ACTIONS.securitySessionRevoked,
    actorUserId: userId,
    entityType: 'User',
    entityId: userId,
    ...(input.request ? { request: input.request } : {}),
  });
}

/** "Cerrar sesión en los demás dispositivos": resta aperta solo quella da cui si chiede. */
export async function revokeOtherAccountSessions(input: {
  readonly userId: string;
  readonly currentSessionId: string;
  readonly request?: RequestMeta;
}): Promise<number> {
  const { userId, currentSessionId } = input;
  if (!isUuid(userId)) throw new TypeError('revokeOtherAccountSessions: utente non valido');
  const removed = await withUserContext(getDb(), userId, (tx) =>
    tx.session.deleteMany({ where: { userId, id: { not: currentSessionId } } }),
  );
  logger.info({ userId, sessions: removed.count }, 'altre sessioni chiuse');
  await recordPlatformSecurityEvent({
    action: AUDIT_ACTIONS.securityOtherSessionsRevoked,
    actorUserId: userId,
    entityType: 'User',
    entityId: userId,
    metadata: { sessions: removed.count },
    ...(input.request ? { request: input.request } : {}),
  });
  return removed.count;
}

/** Evento di sicurezza del conto (verifica attivata o tolta, codici rigenerati): solo ID. */
export async function recordAccountSecurityEvent(
  userId: string,
  action:
    | typeof AUDIT_ACTIONS.securityTwoFactorEnabled
    | typeof AUDIT_ACTIONS.securityTwoFactorDisabled
    | typeof AUDIT_ACTIONS.securityBackupCodesRegenerated,
  request?: RequestMeta,
): Promise<void> {
  if (!isUuid(userId)) return;
  await recordPlatformSecurityEvent({
    action,
    actorUserId: userId,
    entityType: 'User',
    entityId: userId,
    ...(request ? { request } : {}),
  });
}
