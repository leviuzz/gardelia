/**
 * Link pubblici di preventivi, ordini e resoconti delle visite di Floral Care, lato fioreria
 * (ADR-056, ADR-078): crearlo (o ritrovare quello attivo), rinnovarlo e disattivarlo. Il token non si salva: si ricalcola firmando fioreria e ID
 * del link, quindi il fiorista può ricopiarlo quando vuole. Cosa vede il cliente: `public-links.ts`.
 */
import { getDb, isUniqueViolation, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  canShareCareVisit,
  canShareOrder,
  canShareQuote,
  effectiveQuoteStatus,
  formatOrderNumber,
  formatQuoteNumber,
  formatSubscriptionNumber,
  isUuid,
  orderLinkDeliveryExpiry,
  orderLinkExpiry,
  publicLinkExpiry,
  todayInTimeZone,
  type CareVisitStatus,
  type OrderStatus,
  type PublicLinkKind,
  type QuoteStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError } from '../errors';
import { createPublicLinkToken } from '../public-links';
import { requireEntitlement } from './billing';
import { dateToParts } from './quote-internals';

/** Il documento del link: un preventivo, un ordine o una visita della fioreria del contesto. */
export type PublicLinkTarget =
  | { readonly kind: 'QUOTE'; readonly id: string }
  | { readonly kind: 'ORDER'; readonly id: string }
  | { readonly kind: 'CARE_VISIT'; readonly id: string };

export interface PublicLinkDto {
  readonly kind: PublicLinkKind;
  /** Da mettere nell'URL pubblico (`/cotizacion/…`, `/pedido/…` o `/visita/…`). */
  readonly token: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

const ENTITY = { QUOTE: 'Quote', ORDER: 'Order', CARE_VISIT: 'CareVisit' } as const;

/**
 * Chi condivide il documento è chi lo gestisce: il link mostra dati del cliente. Il resoconto di
 * una visita lo condivide anche chi l'ha fatta (dal posto, per WhatsApp); rinnovarlo o
 * disattivarlo resta a chi gestisce i contratti.
 */
function permissionFor(target: PublicLinkTarget, use: 'share' | 'manage') {
  if (target.kind === 'QUOTE') return 'quotes:write' as const;
  if (target.kind === 'ORDER') return 'orders:write' as const;
  return use === 'share' ? ('care:visit' as const) : ('subscriptions:write' as const);
}

function documentWhere(ctx: TenantContext, target: PublicLinkTarget) {
  switch (target.kind) {
    case 'QUOTE':
      return { tenantId: ctx.tenantId, kind: 'QUOTE' as const, quoteId: target.id };
    case 'ORDER':
      return { tenantId: ctx.tenantId, kind: 'ORDER' as const, orderId: target.id };
    case 'CARE_VISIT':
      return { tenantId: ctx.tenantId, kind: 'CARE_VISIT' as const, careVisitId: target.id };
  }
}

/** Il resoconto di una visita è di Floral Care: serve la funzione del piano. */
async function requireTargetPlan(
  tx: TransactionClient,
  ctx: TenantContext,
  target: PublicLinkTarget,
): Promise<void> {
  if (target.kind === 'CARE_VISIT') await requireEntitlement(ctx, 'floralCare', tx);
}

/** Numero leggibile del documento, o null se non è della fioreria. Blocca la riga. */
async function lockDocument(
  tx: TransactionClient,
  ctx: TenantContext,
  target: PublicLinkTarget,
): Promise<{
  readonly label: string;
  readonly shareable: boolean;
  readonly deliveryDate?: Date | null;
} | null> {
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
  if (target.kind === 'CARE_VISIT') {
    const [visit] = await tx.$queryRaw<{ number: number; status: CareVisitStatus }[]>`
      SELECT s."number", v."status" FROM "CareVisit" v
      JOIN "CustomerSubscription" s ON s."tenantId" = v."tenantId" AND s."id" = v."subscriptionId"
      WHERE v."id" = ${target.id}::uuid AND v."tenantId" = ${ctx.tenantId}::uuid
      FOR UPDATE OF v`;
    if (!visit) return null;
    return {
      label: formatSubscriptionNumber(visit.number),
      shareable: canShareCareVisit(visit.status),
    };
  }
  const [order] = await tx.$queryRaw<
    { number: number; status: OrderStatus; scheduledDate: Date | null }[]
  >`
    SELECT "number", "status", "scheduledDate" FROM "Order"
    WHERE "id" = ${target.id}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  if (!order) return null;
  return {
    label: formatOrderNumber(order.number),
    shareable: canShareOrder(order.status),
    deliveryDate: order.scheduledDate,
  };
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
  requirePermission(ctx, permissionFor(target, 'share'));
  if (!isUuid(target.id)) throw new NotFoundError(ENTITY[target.kind]);
  const link = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireTargetPlan(tx, ctx, target);
    return tx.publicLink.findFirst({
      where: { ...documentWhere(ctx, target), revokedAt: null, expiresAt: { gt: new Date() } },
    });
  });
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
  document: {
    readonly label: string;
    readonly shareable: boolean;
    /** Giorno di consegna di un ordine: il link vale fino a 30 giorni dopo (M0). */
    readonly deliveryDate?: Date | null;
  },
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
      expiresAt:
        target.kind === 'ORDER'
          ? orderLinkExpiry(now, document.deliveryDate ?? null)
          : publicLinkExpiry(now),
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
  // Il giorno appena salvato nella stessa transazione: il link vale fino a 30 giorni dopo (M0).
  const current = await tx.order.findFirst({
    where: { id: order.id, tenantId: ctx.tenantId },
    select: { scheduledDate: true },
  });
  const link = await activeOrNewLinkTx(
    tx,
    ctx,
    { kind: 'ORDER', id: order.id },
    {
      label: formatOrderNumber(order.number),
      shareable: true,
      deliveryDate: current?.scheduledDate ?? null,
    },
    false,
  );
  return link.id;
}

/**
 * Il giorno di consegna è cambiato: il link attivo dell'ordine vale fino a 30 giorni dopo il nuovo
 * giorno (M0). Solo allunga: mai accorcia, mai riapre un link scaduto o disattivato. Da chiamare
 * nella transazione che ha cambiato il giorno, con la riga dell'ordine bloccata.
 */
export async function extendOrderPublicLinkTx(
  tx: TransactionClient,
  ctx: TenantContext,
  orderId: string,
  deliveryDate: Date | null,
): Promise<void> {
  if (!deliveryDate) return;
  const now = new Date();
  const until = orderLinkDeliveryExpiry(deliveryDate);
  await tx.publicLink.updateMany({
    where: {
      tenantId: ctx.tenantId,
      kind: 'ORDER',
      orderId,
      revokedAt: null,
      expiresAt: { gt: now, lt: until },
    },
    data: { expiresAt: until },
  });
}

/**
 * Link del resoconto di una visita di Floral Care appena chiusa (ADR-078): lo stesso se è ancora
 * attivo, altrimenti uno nuovo. Da chiamare nella transazione che chiude la visita, con la sua riga
 * bloccata e il permesso già controllato (`care:visit`). Restituisce l'ID del link.
 */
export async function ensureCareVisitPublicLinkTx(
  tx: TransactionClient,
  ctx: TenantContext,
  visit: { readonly id: string; readonly number: number },
): Promise<string> {
  const link = await activeOrNewLinkTx(
    tx,
    ctx,
    { kind: 'CARE_VISIT', id: visit.id },
    { label: formatSubscriptionNumber(visit.number), shareable: true },
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
  requirePermission(ctx, permissionFor(target, options.renew === true ? 'manage' : 'share'));
  if (!isUuid(target.id)) throw new NotFoundError(ENTITY[target.kind]);
  try {
    const result = await withTenantContext(getDb(), ctx, async (tx) => {
      await requireTargetPlan(tx, ctx, target);
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
  requirePermission(ctx, permissionFor(target, 'manage'));
  if (!isUuid(target.id)) throw new NotFoundError(ENTITY[target.kind]);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireTargetPlan(tx, ctx, target);
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
