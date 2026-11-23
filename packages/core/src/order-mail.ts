/**
 * Email degli ordini fatti dalla tienda en línea (ADR-067): a chi compra (ricevuto, accettato,
 * annullato) e alla fioreria (nuovo ordine). I dati si raccolgono DENTRO la transazione che cambia
 * l'ordine; l'invio avviene DOPO il commit e non fa mai fallire l'operazione (un SMTP giù non
 * annulla un ordine): l'errore finisce nel log.
 *
 * Gli indirizzi dell'app (scheda dell'ordine, conto, ricerca) li costruisce il web con le sue rotte
 * e arrivano qui già pronti (`OrderMailDeps.links`).
 */
import type { TransactionClient } from '@floral/db';
import {
  MARKETPLACE_ORDER_LIMITS,
  formatMoney,
  formatOrderNumber,
  formatTimeOfDay,
  type CurrencyCode,
  type FulfillmentMode,
  type StorePaymentMethod,
} from '@floral/domain';
import {
  newOnlineOrderEmail,
  onlineOrderAcceptedEmail,
  onlineOrderCancelledEmail,
  onlineOrderReceivedEmail,
  type OnlineOrderEmailFacts,
} from './email-templates';
import { logger } from './logger';
import type { EmailMessage, Mailer } from './mailer';
import { createPublicLinkToken, publicLinkUrl } from './public-links';

export interface OrderMailDeps {
  readonly mailer: Mailer;
  /** URL pubblico dell'app (APP_URL), per i link di tracciamento. */
  readonly appUrl: string;
  /** Firma dei link pubblici (BETTER_AUTH_SECRET). */
  readonly secret: string;
  readonly links: {
    /** Scheda dell'ordine nel gestionale. */
    readonly order: (tenantSlug: string, orderId: string) => string;
    /** "Mi cuenta" di chi compra. */
    readonly account: string;
    /** Ricerca delle fiorerie (per chi deve cercarne un'altra). */
    readonly search: string;
  };
}

const LOCALE = 'es-MX';

/** Forme di pagamento nella lingua del mercato (le email al cliente sono in es-MX, ADR-042). */
const PAYMENT_LABELS: Record<StorePaymentMethod, string> = {
  TRANSFER: 'Transferencia',
  CASH: 'Efectivo',
  CARD_IN_STORE: 'Tarjeta en tienda',
  PAYMENT_LINK: 'Link de pago',
};

interface OrderFactsRow {
  readonly number: number;
  readonly fulfillmentMode: FulfillmentMode;
  readonly scheduledDate: Date | null;
  readonly windowStartMinutes: number | null;
  readonly windowEndMinutes: number | null;
  readonly totalMinor: number;
  readonly currency: string;
}

function whenLabel(order: OrderFactsRow): string {
  const day = order.scheduledDate
    ? new Intl.DateTimeFormat(LOCALE, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }).format(order.scheduledDate)
    : '';
  if (order.windowStartMinutes !== null && order.windowEndMinutes !== null) {
    return `${day}, de ${formatTimeOfDay(order.windowStartMinutes)} a ${formatTimeOfDay(order.windowEndMinutes)}`;
  }
  return order.fulfillmentMode === 'DELIVERY' ? `${day}, durante el día` : day;
}

function orderFacts(shopName: string, order: OrderFactsRow): OnlineOrderEmailFacts {
  return {
    shopName,
    numberLabel: formatOrderNumber(order.number),
    mode: order.fulfillmentMode,
    when: whenLabel(order),
    totalLabel: formatMoney(order.totalMinor, order.currency as CurrencyCode, LOCALE),
  };
}

/** Invia senza mai far fallire chi chiama. */
export async function sendOrderMails(
  mailer: Mailer,
  messages: readonly EmailMessage[],
): Promise<void> {
  for (const message of messages) {
    try {
      await mailer.send(message);
    } catch (error) {
      logger.error({ err: error, category: message.category }, 'email di un ordine non inviata');
    }
  }
}

/** Indirizzo del link di tracciamento attivo dell'ordine, o "Mi cuenta" se non ce n'è uno. */
async function trackingUrl(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  deps: OrderMailDeps,
): Promise<string> {
  const link = await tx.publicLink.findFirst({
    where: { tenantId, orderId, kind: 'ORDER', revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!link) return deps.links.account;
  return publicLinkUrl(
    deps.appUrl,
    'ORDER',
    createPublicLinkToken(deps.secret, { tenantId, linkId: link.id }),
  );
}

export type BuyerOrderMailKind = 'received' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

/**
 * L'email per chi ha fatto l'ordine online, o null se non c'è nessuno a cui scrivere (ordine del
 * banco, conto cancellato). Da chiamare dentro la transazione del tenant, DOPO la modifica.
 */
export async function buyerOrderMail(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  kind: BuyerOrderMailKind,
  deps: OrderMailDeps,
): Promise<EmailMessage | null> {
  const order = await tx.order.findFirst({ where: { tenantId, id: orderId } });
  if (!order?.placedOnline || !order.buyerUserId) return null;
  const [buyer, tenant, store] = await Promise.all([
    tx.user.findUnique({
      where: { id: order.buyerUserId },
      select: { name: true, email: true },
    }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, contactEmail: true },
    }),
    tx.onlineStore.findUnique({
      where: { tenantId },
      select: { paymentMethods: true, paymentInstructions: true },
    }),
  ]);
  if (!buyer) return null;
  const facts = orderFacts(tenant.displayName, order);
  const url = await trackingUrl(tx, tenantId, order.id, deps);
  const common = { to: buyer.email, name: buyer.name, facts, url, replyTo: tenant.contactEmail };
  switch (kind) {
    case 'received':
      return onlineOrderReceivedEmail({
        ...common,
        acceptDays: MARKETPLACE_ORDER_LIMITS.acceptDays,
      });
    case 'accepted':
      return onlineOrderAcceptedEmail({
        ...common,
        paymentMethods: ((store?.paymentMethods ?? []) as StorePaymentMethod[]).map(
          (method) => PAYMENT_LABELS[method],
        ),
        paymentInstructions: store?.paymentInstructions ?? null,
      });
    case 'rejected':
    case 'cancelled':
    case 'expired':
      return onlineOrderCancelledEmail({
        ...common,
        kind,
        reason: kind === 'expired' ? null : order.cancelReason,
        searchUrl: deps.links.search,
      });
  }
}

/** Le email per propietari e gerenti attivi della fioreria: un ordine online da guardare. */
export async function newOrderMailsForShop(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  input: { readonly buyerName: string; readonly itemCount: number },
  deps: OrderMailDeps,
): Promise<EmailMessage[]> {
  const [order, tenant, members] = await Promise.all([
    tx.order.findFirstOrThrow({ where: { tenantId, id: orderId } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, slug: true },
    }),
    tx.membership.findMany({
      where: { tenantId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } },
      select: { user: { select: { email: true } } },
    }),
  ]);
  const facts = orderFacts(tenant.displayName, order);
  const url = deps.links.order(tenant.slug, order.id);
  return members.map((member) =>
    newOnlineOrderEmail({
      to: member.user.email,
      buyerName: input.buyerName,
      itemCount: input.itemCount,
      facts,
      acceptDays: MARKETPLACE_ORDER_LIMITS.acceptDays,
      url,
    }),
  );
}
