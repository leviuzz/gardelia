/**
 * Contesto di una richiesta dentro una fioreria.
 *
 * Un TenantContext si ottiene SOLO da `resolveTenantContext` (verifica server-side di
 * sessione + membership attiva + tenant attivo): i servizi lo ricevono come prova
 * dell'autorizzazione e non accettano mai tenantId arbitrari dal client.
 */
import {
  getDb,
  withSystemContext,
  withUserContext,
  type MembershipRole,
  type TenantMode,
} from '@floral/db';
import {
  AUDIT_ACTIONS,
  isMarketCountry,
  isUuid,
  resolveLocale,
  type CurrencyCode,
  type MarketCountry,
  type SupportedLocale,
  isCurrencyCode,
} from '@floral/domain';
import { recordPlatformSecurityEvent } from './audit';
import { logger } from './logger';

declare const tenantContextBrand: unique symbol;

/** Metadati della richiesta HTTP, per audit e log. */
export interface RequestMeta {
  readonly requestId?: string | undefined;
  readonly ipAddress?: string | undefined;
}

export interface TenantContext {
  readonly [tenantContextBrand]: true;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly mode: TenantMode;
  readonly country: MarketCountry;
  readonly currency: CurrencyCode;
  readonly timezone: string;
  readonly locale: SupportedLocale;
  readonly userId: string;
  readonly membershipId: string;
  readonly role: MembershipRole;
  readonly request: RequestMeta;
}

const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ResolveTenantContextInput {
  readonly userId: string;
  readonly slug: string;
  readonly request?: RequestMeta;
  /**
   * Lingua dell'interfaccia scelta dalla persona per questa richiesta (ADR-042): ha la precedenza
   * sulla lingua salvata dell'utente e su quella della fioreria. Non dà accesso a nulla.
   */
  readonly locale?: string;
}

/**
 * Restituisce il contesto se l'utente è membro ATTIVO di un tenant ATTIVO con quello slug;
 * altrimenti null (il chiamante risponde 404, senza rivelare se la fioreria esiste).
 * Un accesso negato a un tenant esistente viene registrato come evento di sicurezza.
 */
export async function resolveTenantContext(
  input: ResolveTenantContextInput,
): Promise<TenantContext | null> {
  if (!isUuid(input.userId) || !SLUG_SHAPE.test(input.slug) || input.slug.length > 64) {
    return null;
  }
  const db = getDb();
  const membership = await withUserContext(db, input.userId, (tx) =>
    tx.membership.findFirst({
      where: {
        userId: input.userId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        tenant: { slug: input.slug, status: 'ACTIVE' },
      },
      include: {
        tenant: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            mode: true,
            marketCountry: true,
            currency: true,
            timezone: true,
            defaultLocale: true,
          },
        },
        user: { select: { locale: true } },
      },
    }),
  );

  if (!membership) {
    await reportDeniedTenantAccess(input);
    return null;
  }

  const { tenant } = membership;
  if (!isMarketCountry(tenant.marketCountry) || !isCurrencyCode(tenant.currency)) {
    logger.error({ tenantId: tenant.id }, 'tenant con mercato o valuta non supportati');
    return null;
  }

  const context = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.displayName,
    mode: tenant.mode,
    country: tenant.marketCountry,
    currency: tenant.currency,
    timezone: tenant.timezone,
    locale: resolveLocale(input.locale ?? membership.user.locale ?? tenant.defaultLocale),
    userId: input.userId,
    membershipId: membership.id,
    role: membership.role,
    request: input.request ?? {},
  };
  return context as TenantContext;
}

async function reportDeniedTenantAccess(input: ResolveTenantContextInput): Promise<void> {
  try {
    const target = await withSystemContext(
      getDb(),
      { reason: 'security: verifica accesso negato a tenant' },
      (tx) => tx.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } }),
    );
    if (!target) return; // slug inesistente: semplice 404, nessun evento
    await recordPlatformSecurityEvent({
      action: AUDIT_ACTIONS.securityTenantAccessDenied,
      actorUserId: input.userId,
      entityType: 'Tenant',
      entityId: target.id,
      metadata: { slug: input.slug },
      request: input.request,
    });
  } catch (error) {
    // La registrazione dell'evento non deve mai trasformare un 404 in un 500.
    logger.error({ err: error }, 'impossibile registrare evento di sicurezza');
  }
}

/** Fiorerie a cui l'utente ha accesso (per il selettore e il redirect dopo il login). */
export async function listUserTenants(userId: string): Promise<
  readonly {
    readonly slug: string;
    readonly displayName: string;
    readonly role: MembershipRole;
    readonly mode: TenantMode;
  }[]
> {
  if (!isUuid(userId)) return [];
  const memberships = await withUserContext(getDb(), userId, (tx) =>
    tx.membership.findMany({
      where: { userId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      include: { tenant: { select: { slug: true, displayName: true, mode: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  );
  return memberships.map((m) => ({
    slug: m.tenant.slug,
    displayName: m.tenant.displayName,
    role: m.role,
    mode: m.tenant.mode,
  }));
}

/** Una fioreria in eliminazione che il titolare può ancora recuperare (ADR-074). */
export interface TenantPendingDeletion {
  readonly slug: string;
  readonly displayName: string;
  /** Da quando la manutenzione la cancella davvero. */
  readonly deleteAfter: Date;
}

/**
 * Fiorerie archiviate con l'eliminazione in corso di cui l'utente è titolare: compaiono nella
 * scelta della fioreria con "Recuperar". Le altre archiviate (da piattaforma) no.
 */
export async function listTenantsPendingDeletion(
  userId: string,
): Promise<readonly TenantPendingDeletion[]> {
  if (!isUuid(userId)) return [];
  const memberships = await withUserContext(getDb(), userId, (tx) =>
    tx.membership.findMany({
      where: {
        userId,
        role: 'OWNER',
        status: 'ACTIVE',
        tenant: { status: 'ARCHIVED', deleteAfter: { not: null, gt: new Date() } },
      },
      include: { tenant: { select: { slug: true, displayName: true, deleteAfter: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  );
  return memberships.flatMap(({ tenant }) =>
    tenant.deleteAfter
      ? [{ slug: tenant.slug, displayName: tenant.displayName, deleteAfter: tenant.deleteAfter }]
      : [],
  );
}

/**
 * Contesto SOLO per "Recuperar" una fioreria in eliminazione (ADR-074): titolare attivo, fioreria
 * archiviata con l'eliminazione non ancora eseguita. Ogni altro servizio continua a richiedere una
 * fioreria attiva (`resolveTenantContext`); null → 404 come per qualsiasi fioreria non tua.
 */
export async function resolveTenantContextForRestore(
  input: ResolveTenantContextInput,
): Promise<TenantContext | null> {
  if (!isUuid(input.userId) || !SLUG_SHAPE.test(input.slug) || input.slug.length > 64) {
    return null;
  }
  const membership = await withUserContext(getDb(), input.userId, (tx) =>
    tx.membership.findFirst({
      where: {
        userId: input.userId,
        role: 'OWNER',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        tenant: {
          slug: input.slug,
          status: 'ARCHIVED',
          deleteAfter: { not: null, gt: new Date() },
        },
      },
      include: {
        tenant: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            mode: true,
            marketCountry: true,
            currency: true,
            timezone: true,
            defaultLocale: true,
          },
        },
        user: { select: { locale: true } },
      },
    }),
  );
  if (!membership) return null;
  const { tenant } = membership;
  if (!isMarketCountry(tenant.marketCountry) || !isCurrencyCode(tenant.currency)) return null;
  const context = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.displayName,
    mode: tenant.mode,
    country: tenant.marketCountry,
    currency: tenant.currency,
    timezone: tenant.timezone,
    locale: resolveLocale(input.locale ?? membership.user.locale ?? tenant.defaultLocale),
    userId: input.userId,
    membershipId: membership.id,
    role: membership.role,
    request: input.request ?? {},
  };
  return context as TenantContext;
}
