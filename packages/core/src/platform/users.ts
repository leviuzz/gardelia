/**
 * Accesso di una persona senza l'email di conferma (richiesta del founder, 23/11/2026, ADR-050).
 * Finché il dominio email non è verificato su Resend, le email di conferma arrivano solo al
 * titolare dell'account Resend: l'amministratore della piattaforma conferma a mano l'email di una
 * persona che conosce (registrata da sola, con la sua password) e, se serve, la aggiunge a una
 * fioreria come manager o staff. Solo CLI di piattaforma (ADR-021), con audit; mai dal web.
 */
import { getDb, withSystemContext } from '@floral/db';
import { AUDIT_ACTIONS, normalizeEmail } from '@floral/domain';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';

/** Ruoli che la piattaforma può dare: il proprietario nasce solo creando la propria fioreria. */
export const PLATFORM_MEMBER_ROLES = ['MANAGER', 'STAFF'] as const;
export type PlatformMemberRole = (typeof PLATFORM_MEMBER_ROLES)[number];

function isPlatformMemberRole(value: string | null): value is PlatformMemberRole {
  return value !== null && (PLATFORM_MEMBER_ROLES as readonly string[]).includes(value);
}

export interface ConfirmUserInput {
  readonly operatorEmail: string;
  /** Email con cui la persona si è registrata. */
  readonly email: string;
  /** Fioreria a cui aggiungerla (indirizzo dopo /app/); assente = solo conferma dell'email. */
  readonly tenantSlug?: string | null;
  readonly role?: string | null;
}

export interface ConfirmUserResult {
  readonly userId: string;
  /** false = l'email era già confermata. */
  readonly emailConfirmed: boolean;
  readonly membership: {
    readonly tenantSlug: string;
    readonly role: string;
    /** false = era già nel team (ruolo invariato). */
    readonly added: boolean;
  } | null;
}

export async function confirmUserAccess(input: ConfirmUserInput): Promise<ConfirmUserResult> {
  const operatorEmail = normalizeEmail(input.operatorEmail);
  const email = normalizeEmail(input.email);
  if (!email) throw new ValidationError({ email: 'required' });
  const tenantSlug = input.tenantSlug?.trim().toLowerCase() || null;
  const role = input.role?.trim().toUpperCase() || null;
  if (tenantSlug && !isPlatformMemberRole(role)) {
    throw new ValidationError({ role: 'invalid_option' });
  }

  const result = await withSystemContext(
    getDb(),
    { reason: 'platform: accesso confermato a mano (senza email di conferma)' },
    async (tx) => {
      const operator = await tx.user.findFirst({
        where: { email: operatorEmail, platformRole: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      if (!operator) throw new ForbiddenError('platform_admin_required');
      // Prima si registra da sola (sceglie lei la password): qui non si crea nessun account.
      const user = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, status: true, emailVerified: true },
      });
      if (!user || user.status !== 'ACTIVE') throw new NotFoundError('User');
      const tenant = tenantSlug
        ? await tx.tenant.findUnique({
            where: { slug: tenantSlug },
            select: { id: true, slug: true, status: true },
          })
        : null;
      if (tenantSlug && (!tenant || tenant.status !== 'ACTIVE')) throw new NotFoundError('Tenant');

      let emailConfirmed = false;
      if (!user.emailVerified) {
        await tx.user.update({ where: { id: user.id }, data: { emailVerified: true } });
        await tx.auditLog.create({
          data: {
            tenantId: null,
            actorUserId: operator.id,
            action: AUDIT_ACTIONS.platformUserEmailConfirmed,
            entityType: 'User',
            entityId: user.id,
            metadata: { via: 'platform-cli' },
          },
        });
        emailConfirmed = true;
      }

      let membership: ConfirmUserResult['membership'] = null;
      if (tenant && isPlatformMemberRole(role)) {
        const existing = await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        });
        if (existing?.status === 'ACTIVE') {
          // Già nel team: nessun cambio di ruolo da qui (si cambia dalla pagina Equipo).
          membership = { tenantSlug: tenant.slug, role: existing.role, added: false };
        } else {
          const saved = existing
            ? await tx.membership.update({
                where: { id: existing.id },
                data: { role, status: 'ACTIVE', deactivatedAt: null },
              })
            : await tx.membership.create({
                data: { tenantId: tenant.id, userId: user.id, role, invitedById: operator.id },
              });
          await tx.auditLog.create({
            data: {
              tenantId: tenant.id,
              actorUserId: operator.id,
              action: AUDIT_ACTIONS.memberAddedByPlatform,
              entityType: 'Membership',
              entityId: saved.id,
              metadata: { via: 'platform-cli', role },
            },
          });
          membership = { tenantSlug: tenant.slug, role, added: true };
        }
      }
      return { userId: user.id, emailConfirmed, membership };
    },
  );
  logger.warn(
    {
      userId: result.userId,
      emailConfirmed: result.emailConfirmed,
      memberAdded: result.membership?.added ?? false,
    },
    'accesso confermato a mano dalla piattaforma',
  );
  return result;
}

export interface ResetTwoFactorInput {
  readonly operatorEmail: string;
  /** Email della persona che ha perso il telefono e i codici di respaldo. */
  readonly email: string;
}

export interface ResetTwoFactorResult {
  readonly userId: string;
  /** false = la persona non aveva la verifica attiva (nessun cambio). */
  readonly wasEnabled: boolean;
  /** Sessioni chiuse: la persona deve entrare di nuovo ovunque. */
  readonly sessionsClosed: number;
}

/**
 * Supporto (ADR-077): chi ha perso telefono e codici di respaldo non entra più con la password.
 * L'amministratore, dopo aver verificato chi è (fuori dall'app), toglie la verifica e chiude tutte le
 * sue sessioni; al prossimo accesso basta la password e, se è titolare oltre la scadenza, la
 * riattiva subito. Solo CLI di piattaforma (ADR-021), con audit.
 */
export async function resetUserTwoFactor(
  input: ResetTwoFactorInput,
): Promise<ResetTwoFactorResult> {
  const operatorEmail = normalizeEmail(input.operatorEmail);
  const email = normalizeEmail(input.email);
  if (!email) throw new ValidationError({ email: 'required' });

  const result = await withSystemContext(
    getDb(),
    { reason: 'platform: verifica in due passaggi tolta (supporto)' },
    async (tx) => {
      const operator = await tx.user.findFirst({
        where: { email: operatorEmail, platformRole: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      if (!operator) throw new ForbiddenError('platform_admin_required');
      const user = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, twoFactorEnabled: true },
      });
      if (!user) throw new NotFoundError('User');
      await tx.twoFactor.deleteMany({ where: { userId: user.id } });
      if (user.twoFactorEnabled) {
        await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
      }
      const sessions = await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          tenantId: null,
          actorUserId: operator.id,
          action: AUDIT_ACTIONS.platformTwoFactorReset,
          entityType: 'User',
          entityId: user.id,
          metadata: {
            via: 'platform-cli',
            wasEnabled: user.twoFactorEnabled,
            sessions: sessions.count,
          },
        },
      });
      return { userId: user.id, wasEnabled: user.twoFactorEnabled, sessionsClosed: sessions.count };
    },
  );
  logger.warn(
    { userId: result.userId, wasEnabled: result.wasEnabled, sessions: result.sessionsClosed },
    'verifica in due passaggi tolta dalla piattaforma',
  );
  return result;
}
