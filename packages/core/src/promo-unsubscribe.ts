/**
 * Disiscrizione dalle promozioni (ADR-047): ogni email della promo porta un link personale. Il
 * link contiene fioreria e cliente, firmati dal server (HMAC con una chiave derivata dal segreto
 * dell'app): nessuno può costruirne uno per un altro cliente o un'altra fioreria, e il link non
 * scade (deve funzionare anche da un'email vecchia).
 *
 * Il cliente non ha una sessione: fioreria e cliente vengono SOLO dal link verificato, e i dati si
 * leggono e scrivono nel contesto di quella fioreria (RLS attiva), mai con un contesto di sistema.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import { AUDIT_ACTIONS, getMarket, resolveLocale, type SupportedLocale } from '@floral/domain';
import type { RequestMeta } from './context';
import { logger } from './logger';

const TOKEN_CONTEXT = 'gardelia:promo-unsubscribe:v1';
const SIGNATURE_BYTES = 16;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{64}$/;

function uuidBytes(id: string): Buffer {
  return Buffer.from(id.replaceAll('-', ''), 'hex');
}

function uuidFrom(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function signature(secret: string, payload: Buffer): Buffer {
  // Chiave propria di questo uso: il segreto dell'app non firma mai direttamente i link.
  const key = createHmac('sha256', secret).update(TOKEN_CONTEXT).digest();
  return createHmac('sha256', key).update(payload).digest().subarray(0, SIGNATURE_BYTES);
}

/** Link personale (64 caratteri URL-safe): fioreria + cliente + firma. */
export function createUnsubscribeToken(
  secret: string,
  ids: { readonly tenantId: string; readonly customerId: string },
): string {
  const payload = Buffer.concat([uuidBytes(ids.tenantId), uuidBytes(ids.customerId)]);
  return Buffer.concat([payload, signature(secret, payload)]).toString('base64url');
}

/** Fioreria e cliente di un link valido, o null (formato sbagliato o firma che non torna). */
export function readUnsubscribeToken(
  secret: string,
  token: unknown,
): { readonly tenantId: string; readonly customerId: string } | null {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 32 + SIGNATURE_BYTES) return null;
  const payload = bytes.subarray(0, 32);
  if (!timingSafeEqual(signature(secret, payload), bytes.subarray(32))) return null;
  return {
    tenantId: uuidFrom(payload.subarray(0, 16)),
    customerId: uuidFrom(payload.subarray(16)),
  };
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
