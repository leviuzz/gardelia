/**
 * Team della fioreria: membri, ruoli e inviti [CORE-01].
 *
 * Regole:
 *  - solo OWNER/MANAGER vedono il team e invitano; il MANAGER può invitare solo STAFF;
 *  - solo l'OWNER cambia ruoli e disattiva membri, mai su sé stesso;
 *  - deve restare sempre almeno un OWNER attivo (lock sulle righe per evitare race);
 *  - un invito vale 7 giorni, è legato all'email e il token in chiaro esiste solo nell'email.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  getDb,
  withSystemContext,
  withTenantContext,
  type InvitationStatus,
  type MembershipRole,
  type MembershipStatus,
  type TransactionClient,
} from '@floral/db';
import {
  AUDIT_ACTIONS,
  INVITATION_TTL_DAYS,
  changeRoleSchema,
  invitableRoles,
  inviteMemberSchema,
  isUuid,
  normalizeEmail,
  toFieldErrors,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { RequestMeta, TenantContext } from '../context';
import { invitationEmail } from '../email-templates';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import type { Mailer } from '../mailer';

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface TeamMember {
  readonly membershipId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly status: MembershipStatus;
  readonly joinedAt: Date;
  readonly isCurrentUser: boolean;
}

export interface PendingInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly expiresAt: Date;
  readonly invitedByName: string;
  readonly createdAt: Date;
}

export interface TeamOverview {
  readonly members: readonly TeamMember[];
  readonly invitations: readonly PendingInvitation[];
}

export async function getTeam(ctx: TenantContext): Promise<TeamOverview> {
  requirePermission(ctx, 'members:read');
  return withTenantContext(getDb(), ctx, async (tx) => {
    await expireStaleInvitations(tx, ctx.tenantId);
    const [members, invitations] = await Promise.all([
      tx.membership.findMany({
        where: { tenantId: ctx.tenantId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      }),
      tx.invitation.findMany({
        where: { tenantId: ctx.tenantId, status: 'PENDING' },
        include: { invitedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      members: members.map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        status: m.status,
        joinedAt: m.createdAt,
        isCurrentUser: m.userId === ctx.userId,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expiresAt,
        invitedByName: i.invitedBy.name,
        createdAt: i.createdAt,
      })),
    };
  });
}

async function expireStaleInvitations(tx: TransactionClient, tenantId: string): Promise<void> {
  await tx.invitation.updateMany({
    where: { tenantId, status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
}

export interface InviteDeps {
  readonly mailer: Mailer;
  /** URL pubblico dell'app, per il link nell'email. */
  readonly appUrl: string;
}

export interface InviteResult {
  readonly invitationId: string;
  readonly emailSent: boolean;
}

export async function inviteMember(
  ctx: TenantContext,
  data: unknown,
  deps: InviteDeps,
): Promise<InviteResult> {
  requirePermission(ctx, 'members:invite');
  const parsed = inviteMemberSchema.safeParse(data);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { email, role } = parsed.data;
  if (!invitableRoles(ctx.role).includes(role)) throw new ForbiddenError('role_not_invitable');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { invitationId, inviterName } = await withTenantContext(getDb(), ctx, async (tx) => {
    // La tabella User non è tenant-scoped: la ricerca per email serve solo a capire
    // se la persona è già nel team (la membership è letta nel contesto del tenant).
    const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      const membership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: ctx.tenantId, userId: existingUser.id } },
        select: { status: true },
      });
      if (membership?.status === 'ACTIVE') throw new ConflictError('already_member');
    }

    // Un nuovo invito sostituisce quello eventualmente in attesa (indice univoco parziale).
    await tx.invitation.updateMany({
      where: { tenantId: ctx.tenantId, email, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    const invitation = await tx.invitation.create({
      data: {
        tenantId: ctx.tenantId,
        email,
        role,
        tokenHash: hashInvitationToken(token),
        expiresAt,
        invitedById: ctx.userId,
      },
    });
    const inviter = await tx.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { name: true },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.memberInvited,
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: { role },
    });
    return { invitationId: invitation.id, inviterName: inviter.name };
  });

  // Invio FUORI dalla transazione: un provider lento non deve tenere aperta una connessione.
  try {
    await deps.mailer.send(
      invitationEmail({
        to: email,
        inviterName,
        tenantName: ctx.tenantName,
        role,
        url: `${deps.appUrl.replace(/\/$/, '')}/invite/${token}`,
        expiresInDays: INVITATION_TTL_DAYS,
      }),
    );
    return { invitationId, emailSent: true };
  } catch (error) {
    logger.error({ err: error, invitationId }, 'invio email di invito non riuscito');
    return { invitationId, emailSent: false };
  }
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string): Promise<void> {
  requirePermission(ctx, 'members:invite');
  if (!isUuid(invitationId)) throw new NotFoundError('Invitation');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const invitation = await tx.invitation.findFirst({
      where: { id: invitationId, tenantId: ctx.tenantId },
    });
    if (!invitation) return false;
    if (!invitableRoles(ctx.role).includes(invitation.role)) {
      throw new ForbiddenError('role_not_invitable');
    }
    if (invitation.status !== 'PENDING') throw new ConflictError('invitation_not_pending');
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.invitationRevoked,
      entityType: 'Invitation',
      entityId: invitation.id,
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Invitation', invitationId);
}

async function lockActiveOwners(tx: TransactionClient, tenantId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Membership"
    WHERE "tenantId" = ${tenantId}::uuid AND role = 'OWNER' AND status = 'ACTIVE'
    FOR UPDATE`;
  return rows.map((row) => row.id);
}

async function loadMembershipForUpdate(tx: TransactionClient, ctx: TenantContext, membershipId: string) {
  return tx.membership.findFirst({ where: { id: membershipId, tenantId: ctx.tenantId } });
}

export async function changeMemberRole(
  ctx: TenantContext,
  membershipId: string,
  data: unknown,
): Promise<void> {
  requirePermission(ctx, 'members:manage');
  const parsed = changeRoleSchema.safeParse(data);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  if (!isUuid(membershipId)) throw new NotFoundError('Membership');
  if (membershipId === ctx.membershipId) throw new ConflictError('self_change');

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const owners = await lockActiveOwners(tx, ctx.tenantId);
    const membership = await loadMembershipForUpdate(tx, ctx, membershipId);
    if (!membership) return false;
    const newRole = parsed.data.role;
    if (membership.role === newRole) return true;
    if (membership.role === 'OWNER' && membership.status === 'ACTIVE' && owners.length <= 1) {
      throw new ConflictError('last_owner');
    }
    await tx.membership.update({ where: { id: membership.id }, data: { role: newRole } });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.memberRoleChanged,
      entityType: 'Membership',
      entityId: membership.id,
      metadata: { from: membership.role, to: newRole },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Membership', membershipId);
}

export async function setMemberActive(
  ctx: TenantContext,
  membershipId: string,
  active: boolean,
): Promise<void> {
  requirePermission(ctx, 'members:manage');
  if (!isUuid(membershipId)) throw new NotFoundError('Membership');
  if (membershipId === ctx.membershipId) throw new ConflictError('self_change');

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const owners = await lockActiveOwners(tx, ctx.tenantId);
    const membership = await loadMembershipForUpdate(tx, ctx, membershipId);
    if (!membership) return false;
    const targetStatus: MembershipStatus = active ? 'ACTIVE' : 'SUSPENDED';
    if (membership.status === targetStatus) return true;
    if (!active && membership.role === 'OWNER' && owners.length <= 1) {
      throw new ConflictError('last_owner');
    }
    await tx.membership.update({
      where: { id: membership.id },
      data: { status: targetStatus, deactivatedAt: active ? null : new Date() },
    });
    await recordAudit(tx, ctx, {
      action: active ? AUDIT_ACTIONS.memberReactivated : AUDIT_ACTIONS.memberDeactivated,
      entityType: 'Membership',
      entityId: membership.id,
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Membership', membershipId);
}

// -----------------------------------------------------------------------------
// Accettazione degli inviti (l'utente NON è ancora membro: il token è la prova)
// -----------------------------------------------------------------------------

export type InvitationPreviewStatus = InvitationStatus | 'NOT_FOUND';

export interface InvitationPreview {
  readonly status: InvitationPreviewStatus;
  readonly email?: string;
  readonly role?: MembershipRole;
  readonly tenantName?: string;
  readonly tenantSlug?: string;
  readonly inviterName?: string;
  readonly expiresAt?: Date;
}

async function findInvitationByToken(token: string) {
  if (token.length < 20 || token.length > 200) return null;
  return withSystemContext(getDb(), { reason: 'invitation: lookup by token' }, (tx) =>
    tx.invitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: {
        tenant: { select: { displayName: true, slug: true, status: true } },
        invitedBy: { select: { name: true } },
      },
    }),
  );
}

export async function getInvitationPreview(token: string): Promise<InvitationPreview> {
  const invitation = await findInvitationByToken(token);
  if (!invitation || invitation.tenant.status !== 'ACTIVE') return { status: 'NOT_FOUND' };
  const status: InvitationStatus =
    invitation.status === 'PENDING' && invitation.expiresAt < new Date()
      ? 'EXPIRED'
      : invitation.status;
  return {
    status,
    email: invitation.email,
    role: invitation.role,
    tenantName: invitation.tenant.displayName,
    tenantSlug: invitation.tenant.slug,
    inviterName: invitation.invitedBy.name,
    expiresAt: invitation.expiresAt,
  };
}

export async function acceptInvitation(input: {
  readonly token: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly request?: RequestMeta;
}): Promise<{ tenantSlug: string }> {
  const invitation = await findInvitationByToken(input.token);
  if (!invitation || invitation.tenant.status !== 'ACTIVE') throw new NotFoundError('Invitation');
  if (normalizeEmail(input.userEmail) !== invitation.email) {
    throw new ForbiddenError('invitation_email_mismatch');
  }

  return withTenantContext(
    getDb(),
    { tenantId: invitation.tenantId, userId: input.userId },
    async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: invitation.tenantId, userId: input.userId } },
      });
      // Idempotenza: un secondo click su "Aceptar" con membership già attiva non è un errore.
      if (invitation.status === 'ACCEPTED' && existing?.status === 'ACTIVE') {
        return { tenantSlug: invitation.tenant.slug };
      }
      if (invitation.status !== 'PENDING') throw new ConflictError('invitation_not_pending');
      if (invitation.expiresAt < new Date()) throw new ConflictError('invitation_expired');

      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: input.userId },
      });
      if (claimed.count !== 1) throw new ConflictError('invitation_not_pending');

      const membership = existing
        ? await tx.membership.update({
            where: { id: existing.id },
            data: { role: invitation.role, status: 'ACTIVE', deactivatedAt: null },
          })
        : await tx.membership.create({
            data: {
              tenantId: invitation.tenantId,
              userId: input.userId,
              role: invitation.role,
              invitedById: invitation.invitedById,
            },
          });

      await tx.auditLog.create({
        data: {
          tenantId: invitation.tenantId,
          actorUserId: input.userId,
          action: AUDIT_ACTIONS.invitationAccepted,
          entityType: 'Membership',
          entityId: membership.id,
          metadata: { invitationId: invitation.id, role: invitation.role },
          requestId: input.request?.requestId ?? null,
          ipAddress: input.request?.ipAddress ?? null,
        },
      });
      return { tenantSlug: invitation.tenant.slug };
    },
  );
}
