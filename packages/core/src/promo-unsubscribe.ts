/**
 * Disiscrizione dalle promozioni (ADR-047): ogni email della promo porta un link personale. Il
 * link contiene fioreria e cliente, firmati dal server (HMAC con una chiave derivata dal segreto
 * dell'app): nessuno può costruirne uno per un altro cliente o un'altra fioreria, e il link non
 * scade (deve funzionare anche da un'email vecchia).
 *
 * Il cliente non ha una sessione: fioreria e cliente vengono SOLO dal link verificato, e i dati si
 * leggono e scrivono nel contesto di quella fioreria (RLS attiva), mai con un contesto di sistema.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import { AUDIT_ACTIONS, getMarket, resolveLocale, type SupportedLocale } from '@floral/domain';
import type { RequestMeta } from './context';
import { logger } from './logger';
import { readIdPair, signIdPair } from './signed-ids';

const TOKEN_CONTEXT = 'gardelia:promo-unsubscribe:v1';

/** Link personale (64 caratteri URL-safe): fioreria + cliente + firma. */
export function createUnsubscribeToken(
  secret: string,
  ids: { readonly tenantId: string; readonly customerId: string },
): string {
  return signIdPair(secret, TOKEN_CONTEXT, ids.tenantId, ids.customerId);
}

/** Fioreria e cliente di un link valido, o null (formato sbagliato o firma che non torna). */
export function readUnsubscribeToken(
  secret: string,
  token: unknown,
): { readonly tenantId: string; readonly customerId: string } | null {
  const ids = readIdPair(secret, TOKEN_CONTEXT, token);
  return ids ? { tenantId: ids[0], customerId: ids[1] } : null;
}

/** Indirizzi pubblici del link: pagina con conferma e disiscrizione con un clic (RFC 8058). */
export function unsubscribeUrls(appUrl: string, token: string) {
  const base = appUrl.replace(/\/+$/, '');
  return {
    page: `${base}/unsubscribe/${token}`,
    oneClick: `${base}/api/unsubscribe/${token}`,
  } as const;
}

export interface UnsubscribeInfo {
  readonly shopName: string;
  /** Lingua del mercato della fioreria: la pagina parla come le email (ADR-042). */
  readonly locale: SupportedLocale;
  /** true se il cliente riceve ancora le promozioni. */
  readonly subscribed: boolean;
}

async function withLinkedCustomer<T>(
  secret: string,
  token: unknown,
  fn: (
    tx: TransactionClient,
    ids: { readonly tenantId: string; readonly customerId: string },
    info: UnsubscribeInfo,
  ) => Promise<T>,
): Promise<T | null> {
  const ids = readUnsubscribeToken(secret, token);
  if (!ids) return null;
  return withTenantContext(getDb(), { tenantId: ids.tenantId, userId: null }, async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { tenantId: ids.tenantId, id: ids.customerId },
      select: {
        marketingConsent: true,
        tenant: { select: { displayName: true, marketCountry: true } },
      },
    });
    if (!customer) return null;
    const info: UnsubscribeInfo = {
      shopName: customer.tenant.displayName,
      locale: resolveLocale(getMarket(customer.tenant.marketCountry).defaultLocale),
      subscribed: customer.marketingConsent,
    };
    return fn(tx, ids, info);
  });
}

/** Cosa mostra la pagina del link: fioreria, lingua e stato attuale; null se il link non vale. */
export async function describeUnsubscribe(
  secret: string,
  token: unknown,
): Promise<UnsubscribeInfo | null> {
  return withLinkedCustomer(secret, token, async (_tx, _ids, info) => info);
}

/**
 * Toglie il consenso alle promozioni del cliente del link (idempotente: un secondo clic non
 * cambia nulla). Registrato nell'attività della fioreria, senza dati personali.
 */
export async function unsubscribeFromPromotions(
  secret: string,
  token: unknown,
  request: RequestMeta = {},
): Promise<UnsubscribeInfo | null> {
  return withLinkedCustomer(secret, token, async (tx, ids, info) => {
    if (!info.subscribed) return info;
    await tx.customer.update({
      where: { tenantId_id: { tenantId: ids.tenantId, id: ids.customerId } },
      data: { marketingConsent: false, marketingConsentAt: null },
    });
    await tx.auditLog.create({
      data: {
        tenantId: ids.tenantId,
        actorUserId: null,
        action: AUDIT_ACTIONS.customerUnsubscribed,
        entityType: 'Customer',
        entityId: ids.customerId,
        metadata: { via: 'email_link' },
        requestId: request.requestId ?? null,
        ipAddress: request.ipAddress ?? null,
      },
    });
    logger.info({ tenantId: ids.tenantId, customerId: ids.customerId }, 'cliente disiscritto');
    return { ...info, subscribed: false };
  });
}
