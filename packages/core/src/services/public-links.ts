/**
 * Link pubblici di preventivi e ordini, lato fioreria (ADR-056): crearlo (o ritrovare quello
 * attivo), rinnovarlo e disattivarlo. Il token non si salva: si ricalcola firmando fioreria e ID
 * del link, quindi il fiorista può ricopiarlo quando vuole. Cosa vede il cliente: `public-links.ts`.
 */
import { getDb, isUniqueViolation, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  canShareOrder,
  canShareQuote,
  effectiveQuoteStatus,
  formatOrderNumber,
  formatQuoteNumber,
  isUuid,
  publicLinkExpiry,
  todayInTimeZone,
  type OrderStatus,
  type PublicLinkKind,
  type QuoteStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError } from '../errors';
import { createPublicLinkToken } from '../public-links';
import { dateToParts } from './quote-internals';

/** Il documento del link: un preventivo o un ordine della fioreria del contesto. */
export type PublicLinkTarget =
  { readonly kind: 'QUOTE'; readonly id: string } | { readonly kind: 'ORDER'; readonly id: string };

export interface PublicLinkDto {
  readonly kind: PublicLinkKind;
  /** Da mettere nell'URL pubblico (`/cotizacion/…` o `/pedido/…`). */
  readonly token: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

const ENTITY = { QUOTE: 'Quote', ORDER: 'Order' } as const;

function permissionFor(target: PublicLinkTarget) {
  // Chi condivide il documento è chi lo gestisce: il link mostra dati del cliente.
  return target.kind === 'QUOTE' ? ('quotes:write' as const) : ('orders:write' as const);
}

function documentWhere(ctx: TenantContext, target: PublicLinkTarget) {
  return target.kind === 'QUOTE'
    ? { tenantId: ctx.tenantId, kind: 'QUOTE' as const, quoteId: target.id }
    : { tenantId: ctx.tenantId, kind: 'ORDER' as const, orderId: target.id };
}

/** Numero leggibile del documento, o null se non è della fioreria. Blocca la riga. */
async function lockDocument(
  tx: TransactionClient,
  ctx: TenantContext,
  target: PublicLinkTarget,
): Promise<{ readonly label: string; readonly shareable: boolean } | null> {
  if (target.kind === 'QUOTE') {
    const [quote] = await tx.$queryRaw<
      { number: number; status: QuoteStatus; validUntil: Date | null }[]
    >`SELECT "number", "status", "validUntil" FROM "Quote"
      WHERE "id" = ${target.id}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
    if (!quote) return null;
    const status = effectiveQuoteStatus(
      quote.status,
      dateToParts(quote.validUntil),
      todayInTimeZone(ctx.timezone),
    );
    return { label: formatQuoteNumber(quote.number), shareable: canShareQuote(status) };
  }
  const [order] = await tx.$queryRaw<{ number: number; status: OrderStatus }[]>`
    SELECT "number", "status" FROM "Order"
    WHERE "id" = ${target.id}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  if (!order) return null;
  return { label: formatOrderNumber(order.number), shareable: canShareOrder(order.status) };
}

function toDto(
  ctx: TenantContext,
  secret: string,
  link: { id: string; kind: PublicLinkKind; createdAt: Date; expiresAt: Date },
): PublicLinkDto {
  return {
    kind: link.kind,
    token: createPublicLinkToken(secret, { tenantId: ctx.tenantId, linkId: link.id }),
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
  };
}

/** Il link attivo (non disattivato né scaduto) del documento, o null. */
export async function getPublicLink(
  ctx: TenantContext,
  secret: string,
  target: PublicLinkTarget,
): Promise<PublicLinkDto | null> {
  requirePermission(ctx, permissionFor(target));
  if (!isUuid(target.id)) throw new NotFoundError(ENTITY[target.kind]);
  const link = await withTenantContext(getDb(), ctx, (tx) =>
    tx.publicLink.findFirst({
      where: { ...documentWhere(ctx, target), revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  );
  return link ? toDto(ctx, secret, link) : null;
}

/**
 * Il link attivo del documento, o uno nuovo (con audit) se non c'è, è scaduto o va rinnovato. Il
 * documento è già bloccato da chi chiama: due richieste insieme si mettono in fila sulla sua riga.
 */
async function activeOrNewLinkTx(
  tx: TransactionClient,
  ctx: TenantContext,
  target: PublicLinkTarget,
  document: { readonly label: string; readonly shareable: boolean },
  renew: boolean,
) {
  const now = new Date();
  const active = await tx.publicLink.findFirst({
    where: { ...documentWhere(ctx, target), revokedAt: null },
  });
  if (active && active.expiresAt > now && !renew) return active;
  if (!document.shareable) throw new ConflictError('public_link_unavailable');
  if (active) {
    await tx.publicLink.updateMany({
      where: { id: active.id, tenantId: ctx.tenantId },
      data: { revokedAt: now },
    });
  }
  const created = await tx.publicLink.create({
    data: {
      ...documentWhere(ctx, target),
      createdById: ctx.userId,
      createdAt: now,
      expiresAt: publicLinkExpiry(now),
    },
  });
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.publicLinkCreated,
    entityType: ENTITY[target.kind],
    entityId: target.id,
    metadata: { number: document.label, renewed: active !== null },
  });
  return created;
}

/**
 * Link di tracciamento per la conferma al cliente di un ordine del banco (ADR-072): lo stesso di
 * "Compartir enlace" se è ancora attivo, altrimenti uno nuovo. Da chiamare nella transazione che ha
 * appena confermato l'ordine, con la sua riga bloccata (o appena creata) e il permesso già controllato
 * da chi chiama (`orders:write`, lo stesso di "Compartir enlace"). Restituisce l'ID del link.
 */
export async function ensureOrderPublicLinkTx(
  tx: TransactionClient,
  ctx: TenantContext,
  order: { readonly id: string; readonly number: number },
): Promise<string> {
  const link = await activeOrNewLinkTx(
    tx,
    ctx,
    { kind: 'ORDER', id: order.id },
    { label: formatOrderNumber(order.number), shareable: true },
    false,
  );
  return link.id;
}

/**
 * "Compartir enlace": restituisce il link attivo o ne crea uno. Con `renew` il vecchio smette di
 * funzionare e ne nasce uno nuovo (es. inviato alla persona sbagliata).
 */
export async function sharePublicLink(
  ctx: TenantContext,
  secret: string,
  target: PublicLinkTarget,
  options: { readonly renew?: boolean } = {},
): Promise<PublicLinkDto> {
  requirePermission(ctx, permissionFor(target));
  if (!isUuid(target.id)) throw new NotFoundError(ENTITY[target.kind]);
  try {
    const result = await withTenantContext(getDb(), ctx, async (tx) => {
      const document = await lockDocument(tx, ctx, target);
      if (!document) return null;
      return activeOrNewLinkTx(tx, ctx, target, document, options.renew === true);
    });
    if (!result) return notFound(ctx, ENTITY[target.kind], target.id);
    return toDto(ctx, secret, result);
  } catch (error) {
    // Due clic insieme: l'indice "uno solo attivo" ferma il secondo, che ritrova il primo.
    if (isUniqueViolation(error)) {
      const existing = await getPublicLink(ctx, secret, target);
      if (existing) return existing;
    }
    throw error;
  }
}

/** "Desactivar enlace": da subito il cliente vede "enlace no válido". */
export async function revokePublicLink(
  ctx: TenantContext,
  target: PublicLinkTarget,
): Promise<void> {
  requirePermission(ctx, permissionFor(target));
  if (!isUuid(target.id)) throw new NotFoundError(ENTITY[target.kind]);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const document = await lockDocument(tx, ctx, target);
    if (!document) return false;
    const revoked = await tx.publicLink.updateMany({
      where: { ...documentWhere(ctx, target), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count > 0) {
      await recordAudit(tx, ctx, {
        action: AUDIT_ACTIONS.publicLinkRevoked,
        entityType: ENTITY[target.kind],
        entityId: target.id,
        metadata: { number: document.label },
      });
    }
    return true;
  });
  if (!found) await notFound(ctx, ENTITY[target.kind], target.id);
}
