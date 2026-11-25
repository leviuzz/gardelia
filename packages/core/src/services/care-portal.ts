/**
 * Floral Care, pagina del cliente (blocco 5a, ADR-084) — lato fioreria: inviti e accessi.
 *
 *  - Chi gestisce (proprietario e gerente) invita una persona, per email, a vedere i contratti di
 *    un cliente: questo contratto o tutti, con o senza prezzi e cargos (decisione del founder del
 *    24/11). Il link è firmato con la fioreria e l'id dell'invito, come i link pubblici (ADR-056):
 *    si può copiare o mandare per WhatsApp anche quando l'email non parte (fioreria demo).
 *  - Un invito nuovo per la stessa email sostituisce quello in attesa; vale 7 giorni e solo per
 *    quell'email (lo controlla l'accettazione, `my-floral-care.ts`).
 *  - "Quitar acceso" chiude il collegamento (la riga resta).
 *
 * Ordine dei blocchi: cliente → contratto → invito → accesso (come l'accettazione).
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_PORTAL_LIMITS,
  careEmailsAllowed,
  carePortalInviteExpiresAt,
  carePortalInviteSchema,
  carePortalInviteStatus,
  formatSubscriptionNumber,
  getMarket,
  isUuid,
  resolveLocale,
  toFieldErrors,
  type CarePortalInviteStatus,
  type CarePortalScope,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import { carePortalInviteEmail } from '../care-email';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import type { Mailer } from '../mailer';
import { readIdPair, signIdPair } from '../signed-ids';
import { requireEntitlement } from './billing';

const INVITE_TOKEN_CONTEXT = 'gardelia:care-portal-invite:v1';

/** Token dell'invito: fioreria + ID dell'invito + firma (come i link pubblici). */
export function carePortalInviteToken(
  secret: string,
  ids: { readonly tenantId: string; readonly inviteId: string },
): string {
  return signIdPair(secret, INVITE_TOKEN_CONTEXT, ids.tenantId, ids.inviteId);
}

export function readCarePortalInviteToken(
  secret: string,
  token: unknown,
): { readonly tenantId: string; readonly inviteId: string } | null {
  const ids = readIdPair(secret, INVITE_TOKEN_CONTEXT, token);
  return ids ? { tenantId: ids[0], inviteId: ids[1] } : null;
}

/** L'indirizzo dell'invito: `/cuenta/floral-care/invitacion/<token>`. */
export function carePortalInviteUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/cuenta/floral-care/invitacion/${token}`;
}

export interface CarePortalDeps {
  readonly mailer: Mailer;
  /** URL pubblico dell'app, per il link. */
  readonly appUrl: string;
  /** Il segreto dei link firmati (lo stesso dei link pubblici). */
  readonly secret: string;
}

export interface CarePortalInviteDto {
  readonly id: string;
  readonly email: string;
  readonly scope: CarePortalScope;
  readonly canSeeMoney: boolean;
  /** Lo stato vero: uno in attesa oltre la scadenza è "Vencida". */
  readonly status: CarePortalInviteStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly emailSentAt: Date | null;
  /** Solo per gli inviti in attesa: il link da copiare o mandare. */
  readonly url: string | null;
}

export interface CarePortalPersonDto {
  readonly accessId: string;
  readonly name: string;
  readonly email: string;
  readonly scope: CarePortalScope;
  readonly canSeeMoney: boolean;
  readonly since: Date;
}

export interface CarePortalPanelDto {
  readonly subscriptionId: string;
  readonly customerId: string;
  /** L'email del cliente nel CRM, per precompilare l'invito. */
  readonly customerEmail: string | null;
  /** Si invita solo da un contratto attivo o in pausa, con il cliente attivo. */
  readonly canInvite: boolean;
  /** Fioreria LIVE e attiva: l'email parte (altrimenti solo il link). */
  readonly emailsAllowed: boolean;
  /** In attesa e scaduti di recente (per "Reenviar"). */
  readonly invites: readonly CarePortalInviteDto[];
  readonly people: readonly CarePortalPersonDto[];
}

export interface CarePortalInviteResult {
  readonly inviteId: string;
  readonly url: string;
  readonly emailSent: boolean;
}

/** Inviti scaduti ancora mostrati nel riquadro ("Reenviar"), per una settimana. */
const EXPIRED_SHOWN_MS = 7 * 24 * 3_600_000;

function scopeOf(subscriptionId: string | null): CarePortalScope {
  return subscriptionId === null ? 'CUSTOMER' : 'CONTRACT';
}

/** Il riquadro "Acceso del cliente" del contratto: inviti e persone che vedono questo contratto. */
export async function getCarePortalPanel(
  ctx: TenantContext,
  subscriptionId: string,
  deps: Pick<CarePortalDeps, 'appUrl' | 'secret'>,
): Promise<CarePortalPanelDto> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const now = new Date();
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      select: {
        id: true,
        status: true,
        customerId: true,
        customer: { select: { email: true, status: true } },
      },
    });
    if (!contract) return null;
    const covers = { OR: [{ subscriptionId }, { subscriptionId: null }] };
    const [invites, accesses] = await Promise.all([
      tx.carePortalInvite.findMany({
        where: {
          tenantId: ctx.tenantId,
          customerId: contract.customerId,
          ...covers,
          OR: [
            { status: 'PENDING' },
            { status: 'EXPIRED', expiresAt: { gte: new Date(now.getTime() - EXPIRED_SHOWN_MS) } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          email: true,
          subscriptionId: true,
          canSeeMoney: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          emailSentAt: true,
        },
      }),
      tx.carePortalAccess.findMany({
        where: {
          tenantId: ctx.tenantId,
          customerId: contract.customerId,
          revokedAt: null,
          ...covers,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          subscriptionId: true,
          canSeeMoney: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);
    return { contract, invites, accesses };
  });
  if (!found) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  const { contract, invites, accesses } = found;
  const open = contract.status === 'ACTIVE' || contract.status === 'PAUSED';
  return {
    subscriptionId: contract.id,
    customerId: contract.customerId,
    customerEmail: contract.customer.email,
    canInvite: open && contract.customer.status === 'ACTIVE',
    emailsAllowed: careEmailsAllowed({ mode: ctx.mode, status: 'ACTIVE' }),
    invites: invites
      .map((invite) => {
        const status = carePortalInviteStatus(invite, now);
        return {
          id: invite.id,
          email: invite.email,
          scope: scopeOf(invite.subscriptionId),
          canSeeMoney: invite.canSeeMoney,
          status,
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
          emailSentAt: invite.emailSentAt,
          url:
            status === 'PENDING'
              ? carePortalInviteUrl(
                  deps.appUrl,
                  carePortalInviteToken(deps.secret, {
                    tenantId: ctx.tenantId,
                    inviteId: invite.id,
                  }),
                )
              : null,
        };
      })
      .filter((invite) => invite.status === 'PENDING' || invite.status === 'EXPIRED'),
    people: accesses.map((access) => ({
      accessId: access.id,
      name: access.user.name,
      email: access.user.email,
      scope: scopeOf(access.subscriptionId),
      canSeeMoney: access.canSeeMoney,
      since: access.createdAt,
    })),
  };
}

/** Il cliente e il contratto, bloccati in lettura nell'ordine dei blocchi (cliente → contratto). */
async function lockCustomerAndContract(
  tx: TransactionClient,
  tenantId: string,
  subscriptionId: string,
) {
  const contract = await tx.customerSubscription.findFirst({
    where: { tenantId, id: subscriptionId, kind: 'CARE' },
    select: { id: true, customerId: true },
  });
  if (!contract) return null;
  await tx.$queryRaw`SELECT "id" FROM "Customer"
    WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${contract.customerId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "CustomerSubscription"
    WHERE "tenantId" = ${tenantId}::uuid AND "id" = ${subscriptionId}::uuid FOR SHARE`;
  return tx.customerSubscription.findFirst({
    where: { tenantId, id: subscriptionId },
    select: {
      id: true,
      number: true,
      status: true,
      customerId: true,
      customer: { select: { displayName: true, status: true } },
    },
  });
}

interface CreatedInvite {
  readonly inviteId: string;
  readonly email: string;
  readonly customerName: string;
}

async function createInviteTx(
  tx: TransactionClient,
  ctx: TenantContext,
  subscriptionId: string,
  input: { readonly email: string; readonly scope: CarePortalScope; readonly canSeeMoney: boolean },
  audit: 'invited' | 'resent',
): Promise<CreatedInvite | null> {
  const contract = await lockCustomerAndContract(tx, ctx.tenantId, subscriptionId);
  if (!contract) return null;
  if (contract.customer.status !== 'ACTIVE') {
    throw new ConflictError('care_portal_customer_archived');
  }
  if (contract.status !== 'ACTIVE' && contract.status !== 'PAUSED') {
    throw new ConflictError('care_portal_contract_not_open');
  }
  const now = new Date();
  const [pending, people] = await Promise.all([
    tx.carePortalInvite.count({
      where: {
        tenantId: ctx.tenantId,
        customerId: contract.customerId,
        status: 'PENDING',
        expiresAt: { gt: now },
        NOT: { email: input.email },
      },
    }),
    tx.carePortalAccess.count({
      where: { tenantId: ctx.tenantId, customerId: contract.customerId, revokedAt: null },
    }),
  ]);
  if (pending >= CARE_PORTAL_LIMITS.pendingInvites || people >= CARE_PORTAL_LIMITS.accesses) {
    throw new ConflictError('care_portal_invite_limit');
  }
  // Un invito nuovo sostituisce quello in attesa per la stessa email (indice unico parziale).
  await tx.carePortalInvite.updateMany({
    where: {
      tenantId: ctx.tenantId,
      customerId: contract.customerId,
      email: input.email,
      status: 'PENDING',
    },
    data: { status: 'REVOKED', revokedAt: now, revokedById: ctx.userId },
  });
  const invite = await tx.carePortalInvite.create({
    data: {
      tenantId: ctx.tenantId,
      customerId: contract.customerId,
      subscriptionId: input.scope === 'CONTRACT' ? contract.id : null,
      email: input.email,
      canSeeMoney: input.canSeeMoney,
      expiresAt: carePortalInviteExpiresAt(now),
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.carePortalInvited,
    entityType: 'CarePortalInvite',
    entityId: invite.id,
    metadata: {
      number: formatSubscriptionNumber(contract.number),
      scope: input.scope,
      canSeeMoney: input.canSeeMoney,
      ...(audit === 'resent' ? { resent: true } : {}),
    },
  });
  return { inviteId: invite.id, email: input.email, customerName: contract.customer.displayName };
}

/** Dopo il commit: il link sempre, l'email solo da una fioreria LIVE. */
async function deliverInvite(
  ctx: TenantContext,
  created: CreatedInvite,
  deps: CarePortalDeps,
): Promise<CarePortalInviteResult> {
  const url = carePortalInviteUrl(
    deps.appUrl,
    carePortalInviteToken(deps.secret, { tenantId: ctx.tenantId, inviteId: created.inviteId }),
  );
  if (!careEmailsAllowed({ mode: ctx.mode, status: 'ACTIVE' })) {
    return { inviteId: created.inviteId, url, emailSent: false };
  }
  try {
    const shop = await withTenantContext(getDb(), ctx, (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { displayName: true, contactEmail: true, contactPhone: true },
      }),
    );
    await deps.mailer.send(
      carePortalInviteEmail({
        locale: resolveLocale(getMarket(ctx.country).defaultLocale),
        to: created.email,
        customerName: created.customerName,
        shop: {
          name: shop.displayName,
          contactEmail: shop.contactEmail,
          contactPhone: shop.contactPhone,
        },
        url,
        expiresInDays: CARE_PORTAL_LIMITS.inviteDays,
      }),
    );
    await withTenantContext(getDb(), ctx, (tx) =>
      tx.carePortalInvite.updateMany({
        where: { tenantId: ctx.tenantId, id: created.inviteId, status: 'PENDING' },
        data: { emailSentAt: new Date() },
      }),
    );
    return { inviteId: created.inviteId, url, emailSent: true };
  } catch (error) {
    logger.error(
      { err: error, inviteId: created.inviteId },
      'invio dell’invito al portale non riuscito',
    );
    return { inviteId: created.inviteId, url, emailSent: false };
  }
}

/** "Invitar": email, questo contratto o tutti, e la casella dei soldi. */
export async function inviteCarePortal(
  ctx: TenantContext,
  subscriptionId: string,
  rawInput: unknown,
  deps: CarePortalDeps,
): Promise<CarePortalInviteResult> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const parsed = carePortalInviteSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const created = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    return createInviteTx(tx, ctx, subscriptionId, parsed.data, 'invited');
  });
  if (!created) return notFound(ctx, 'CustomerSubscription', subscriptionId);
  return deliverInvite(ctx, created, deps);
}

/** "Reenviar": un invito nuovo (link nuovo, 7 giorni) con la stessa email e le stesse scelte. */
export async function resendCarePortalInvite(
  ctx: TenantContext,
  inviteId: string,
  deps: CarePortalDeps,
): Promise<CarePortalInviteResult> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(inviteId)) throw new NotFoundError('CarePortalInvite');
  const now = new Date();
  const created = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const invite = await tx.carePortalInvite.findFirst({
      where: { tenantId: ctx.tenantId, id: inviteId },
      select: {
        email: true,
        subscriptionId: true,
        customerId: true,
        canSeeMoney: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!invite) return null;
    const status = carePortalInviteStatus(invite, now);
    if (status !== 'PENDING' && status !== 'EXPIRED') {
      throw new ConflictError('care_portal_invite_not_pending');
    }
    // Un invito per tutti i contratti si riapre da un contratto aperto del cliente.
    const contract = invite.subscriptionId
      ? { id: invite.subscriptionId }
      : await tx.customerSubscription.findFirst({
          where: {
            tenantId: ctx.tenantId,
            customerId: invite.customerId,
            kind: 'CARE',
            status: { in: ['ACTIVE', 'PAUSED'] },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
    if (!contract) throw new ConflictError('care_portal_contract_not_open');
    if (status === 'EXPIRED' && invite.status === 'PENDING') {
      await tx.carePortalInvite.updateMany({
        where: { tenantId: ctx.tenantId, id: inviteId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
    }
    return createInviteTx(
      tx,
      ctx,
      contract.id,
      {
        email: invite.email,
        scope: scopeOf(invite.subscriptionId),
        canSeeMoney: invite.canSeeMoney,
      },
      'resent',
    );
  });
  if (!created) return notFound(ctx, 'CarePortalInvite', inviteId);
  return deliverInvite(ctx, created, deps);
}

/** "Revocar" un invito in attesa: il link non si apre più. */
export async function revokeCarePortalInvite(ctx: TenantContext, inviteId: string): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(inviteId)) throw new NotFoundError('CarePortalInvite');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const invite = await tx.carePortalInvite.findFirst({
      where: { tenantId: ctx.tenantId, id: inviteId },
      select: { id: true, status: true, subscription: { select: { number: true } } },
    });
    if (!invite) return false;
    if (invite.status !== 'PENDING') throw new ConflictError('care_portal_invite_not_pending');
    const revoked = await tx.carePortalInvite.updateMany({
      where: { tenantId: ctx.tenantId, id: inviteId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedById: ctx.userId },
    });
    if (revoked.count !== 1) throw new ConflictError('care_portal_invite_not_pending');
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePortalInviteRevoked,
      entityType: 'CarePortalInvite',
      entityId: inviteId,
      ...(invite.subscription
        ? { metadata: { number: formatSubscriptionNumber(invite.subscription.number) } }
        : {}),
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CarePortalInvite', inviteId);
}

/** "Quitar acceso": la persona non vede più i contratti del cliente (la riga resta, chiusa). */
export async function revokeCarePortalAccess(ctx: TenantContext, accessId: string): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(accessId)) throw new NotFoundError('CarePortalAccess');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const access = await tx.carePortalAccess.findFirst({
      where: { tenantId: ctx.tenantId, id: accessId },
      select: { id: true, customerId: true, subscriptionId: true },
    });
    if (!access) return false;
    // Cliente prima dell'accesso, come l'accettazione.
    await tx.$queryRaw`SELECT "id" FROM "Customer"
      WHERE "tenantId" = ${ctx.tenantId}::uuid AND "id" = ${access.customerId}::uuid FOR SHARE`;
    const revoked = await tx.carePortalAccess.updateMany({
      where: { tenantId: ctx.tenantId, id: accessId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'MANUAL', revokedById: ctx.userId },
    });
    if (revoked.count === 1) {
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.carePortalAccessRevoked,
        entityType: 'CarePortalAccess',
        entityId: accessId,
        metadata: { reason: 'MANUAL', scope: scopeOf(access.subscriptionId) },
      });
    }
    return true;
  });
  if (!found) await notFound(ctx, 'CarePortalAccess', accessId);
}

export interface CustomerCarePortalSummaryDto {
  /** Persone che vedono almeno un contratto del cliente. */
  readonly people: number;
  readonly pendingInvites: number;
}

/** La riga "Portal" della scheda del cliente; null per chi non gestisce i contratti. */
export async function getCustomerCarePortalSummary(
  ctx: TenantContext,
  customerId: string,
): Promise<CustomerCarePortalSummaryDto | null> {
  if (!hasPermission(ctx, 'subscriptions:write') || !isUuid(customerId)) return null;
  const now = new Date();
  return withTenantContext(getDb(), ctx, async (tx) => {
    const [people, pendingInvites] = await Promise.all([
      tx.carePortalAccess.count({
        where: { tenantId: ctx.tenantId, customerId, revokedAt: null },
      }),
      tx.carePortalInvite.count({
        where: { tenantId: ctx.tenantId, customerId, status: 'PENDING', expiresAt: { gt: now } },
      }),
    ]);
    return { people, pendingInvites };
  });
}
