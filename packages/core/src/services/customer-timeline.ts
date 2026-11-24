/**
 * Cronologia del cliente [CRM-01]: preventivi, ordini (nascita, conferma, consegna o ritiro,
 * annullamento), pagamenti e promozioni in una sola linea del tempo, dalla più recente.
 *
 *  - Solo lettura: ogni evento viene dalla tabella del suo modulo (preventivi, ordini, promozioni),
 *    senza toccarne il codice; i moduli che l'utente non può vedere non compaiono.
 *  - "Ver más" allarga la pagina (20, 40, … fino a 200): ogni fonte dà al massimo quel numero di
 *    eventi, si uniscono, si ordinano e si taglia.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  CUSTOMER_TIMELINE_ORDER_STATUSES,
  formatSubscriptionNumber,
  customerTimelineLimit,
  formatOrderNumber,
  formatQuoteNumber,
  isUuid,
  type FulfillmentMode,
  type OccasionType,
  type OrderPaymentKind,
  type OrderStatus,
  type PaymentMethod,
  type QuoteStatus,
} from '@floral/domain';
import { notFound } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import { getEntitlements } from './billing';
import type { TenantContext } from '../context';
import { NotFoundError } from '../errors';

interface TimelineBase {
  /** Chiave stabile dell'evento (tipo e id della riga d'origine). */
  readonly id: string;
  readonly at: Date;
}

export type CustomerTimelineEvent =
  | (TimelineBase & { readonly kind: 'customer_created' })
  | (TimelineBase & {
      readonly kind: 'quote_created';
      readonly quoteId: string;
      readonly number: string;
      readonly title: string | null;
      readonly totalMinor: number;
      readonly currency: string;
    })
  | (TimelineBase & {
      readonly kind: 'quote_status';
      readonly quoteId: string;
      readonly number: string;
      readonly status: QuoteStatus;
    })
  | (TimelineBase & {
      readonly kind: 'order_status';
      readonly orderId: string;
      readonly number: string;
      readonly status: OrderStatus;
      /** true: è la nascita dell'ordine (con lo stato in cui è nato). */
      readonly created: boolean;
      readonly fulfillmentMode: FulfillmentMode;
      readonly totalMinor: number;
      readonly currency: string;
      readonly note: string | null;
    })
  | (TimelineBase & {
      readonly kind: 'payment';
      readonly orderId: string;
      readonly number: string;
      readonly paymentKind: OrderPaymentKind;
      readonly method: PaymentMethod;
      readonly amountMinor: number;
      readonly currency: string;
    })
  | (TimelineBase & {
      readonly kind: 'promo_sent';
      readonly code: string;
      readonly occasionType: OccasionType;
      readonly occasionLabel: string | null;
    })
  | (TimelineBase & { readonly kind: 'promo_redeemed'; readonly code: string })
  | (TimelineBase & {
      /** Visita di Floral Care chiusa (ADR-076): hecha o no realizada. */
      readonly kind: 'care_visit';
      readonly visitId: string;
      readonly subscriptionId: string;
      readonly number: string;
      readonly status: 'DONE' | 'NOT_DONE';
    });

export interface CustomerTimelineResult {
  readonly events: readonly CustomerTimelineEvent[];
  /** Ci sono eventi più vecchi oltre quelli mostrati. */
  readonly hasMore: boolean;
  readonly limit: number;
}

/**
 * Cronologia di un cliente della fioreria del contesto (404 per un cliente di un'altra fioreria).
 * `rawLimit`: quanti eventi mostrare (`?historial=`), multipli di 20 fino a 200.
 */
export async function getCustomerTimeline(
  ctx: TenantContext,
  customerId: string,
  rawLimit?: unknown,
): Promise<CustomerTimelineResult> {
  requirePermission(ctx, 'customers:read');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const limit = customerTimelineLimit(rawLimit);
  const canQuotes = hasPermission(ctx, 'quotes:read');
  const canOrders = hasPermission(ctx, 'orders:read');
  const canCare = hasPermission(ctx, 'subscriptions:read');
  const tenantId = ctx.tenantId;

  const events = await withTenantContext(getDb(), ctx, async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, createdAt: true },
    });
    if (!customer) return null;
    const collected: CustomerTimelineEvent[] = [
      { kind: 'customer_created', id: `customer:${customer.id}`, at: customer.createdAt },
    ];

    if (canQuotes) {
      const created = await tx.quote.findMany({
        where: { tenantId, customerId },
        select: {
          id: true,
          number: true,
          title: true,
          totalMinor: true,
          currency: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      for (const quote of created) {
        collected.push({
          kind: 'quote_created',
          id: `quote:${quote.id}`,
          at: quote.createdAt,
          quoteId: quote.id,
          number: formatQuoteNumber(quote.number),
          title: quote.title,
          totalMinor: quote.totalMinor,
          currency: quote.currency,
        });
      }
      // Lo stato attuale del preventivo, quando non è più una bozza (il preventivo non ha uno
      // storico degli stati: si mostra l'ultimo cambio).
      const changed = await tx.quote.findMany({
        where: { tenantId, customerId, status: { not: 'DRAFT' }, statusChangedAt: { not: null } },
        select: { id: true, number: true, status: true, statusChangedAt: true },
        orderBy: [{ statusChangedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      for (const quote of changed) {
        if (!quote.statusChangedAt) continue;
        collected.push({
          kind: 'quote_status',
          id: `quote-status:${quote.id}`,
          at: quote.statusChangedAt,
          quoteId: quote.id,
          number: formatQuoteNumber(quote.number),
          status: quote.status,
        });
      }
    }

    if (canOrders) {
      const steps = await tx.orderStatusEvent.findMany({
        where: {
          tenantId,
          order: { tenantId, customerId },
          OR: [{ fromStatus: null }, { toStatus: { in: [...CUSTOMER_TIMELINE_ORDER_STATUSES] } }],
        },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          note: true,
          createdAt: true,
          order: {
            select: {
              id: true,
              number: true,
              fulfillmentMode: true,
              totalMinor: true,
              currency: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      for (const step of steps) {
        collected.push({
          kind: 'order_status',
          id: `order-status:${step.id}`,
          at: step.createdAt,
          orderId: step.order.id,
          number: formatOrderNumber(step.order.number),
          status: step.toStatus,
          created: step.fromStatus === null,
          fulfillmentMode: step.order.fulfillmentMode,
          totalMinor: step.order.totalMinor,
          currency: step.order.currency,
          note: step.note,
        });
      }
      const payments = await tx.orderPayment.findMany({
        where: { tenantId, order: { tenantId, customerId } },
        select: {
          id: true,
          kind: true,
          method: true,
          amountMinor: true,
          createdAt: true,
          order: { select: { id: true, number: true, currency: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      for (const payment of payments) {
        collected.push({
          kind: 'payment',
          id: `payment:${payment.id}`,
          at: payment.createdAt,
          orderId: payment.order.id,
          number: formatOrderNumber(payment.order.number),
          paymentKind: payment.kind,
          method: payment.method,
          amountMinor: payment.amountMinor,
          currency: payment.order.currency,
        });
      }
    }

    // Promozioni delle date speciali (ADR-047/048): visibili a chi vede il cliente, come nella scheda.
    const sent = await tx.occasionPromoEmail.findMany({
      where: { tenantId, customerId, status: 'SENT', sentAt: { not: null } },
      select: {
        id: true,
        code: true,
        sentAt: true,
        occasion: { select: { type: true, label: true } },
      },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    for (const promo of sent) {
      if (!promo.sentAt) continue;
      collected.push({
        kind: 'promo_sent',
        id: `promo:${promo.id}`,
        at: promo.sentAt,
        code: promo.code,
        occasionType: promo.occasion.type,
        occasionLabel: promo.occasion.label,
      });
    }
    const redeemed = await tx.occasionPromoEmail.findMany({
      where: { tenantId, customerId, redeemedAt: { not: null } },
      select: { id: true, code: true, redeemedAt: true },
      orderBy: [{ redeemedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    for (const promo of redeemed) {
      if (!promo.redeemedAt) continue;
      collected.push({
        kind: 'promo_redeemed',
        id: `promo-redeemed:${promo.id}`,
        at: promo.redeemedAt,
        code: promo.code,
      });
    }

    // Visite di Floral Care chiuse (ADR-076): per chi vede i contratti, se la fioreria ha il piano.
    if (canCare && (await getEntitlements(ctx, tx)).floralCare) {
      const visits = await tx.careVisit.findMany({
        where: {
          tenantId,
          status: { in: ['DONE', 'NOT_DONE'] },
          finishedAt: { not: null },
          subscription: { tenantId, customerId },
        },
        select: {
          id: true,
          status: true,
          finishedAt: true,
          subscriptionId: true,
          subscription: { select: { number: true } },
        },
        orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      for (const visit of visits) {
        if (!visit.finishedAt) continue;
        collected.push({
          kind: 'care_visit',
          id: `care-visit:${visit.id}`,
          at: visit.finishedAt,
          visitId: visit.id,
          subscriptionId: visit.subscriptionId,
          number: formatSubscriptionNumber(visit.subscription.number),
          status: visit.status === 'DONE' ? 'DONE' : 'NOT_DONE',
        });
      }
    }
    return collected;
  });
  if (!events) return notFound(ctx, 'Customer', customerId);

  // Dal più recente; a parità d'istante, l'ordine d'inserimento resta (sort stabile).
  const sorted = [...events].sort((a, b) => b.at.getTime() - a.at.getTime());
  return { events: sorted.slice(0, limit), hasMore: sorted.length > limit, limit };
}
