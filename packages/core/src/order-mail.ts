/**
 * Email degli ordini fatti dalla tienda en línea (ADR-067): a chi compra (ricevuto, accettato,
 * annullato) e alla fioreria (nuovo ordine). In più la conferma al cliente degli ordini del banco
 * (ADR-072). I dati si raccolgono DENTRO la transazione che cambia
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
  orderBalanceMinor,
  pendingOrderDeadline,
  pendingOrderDeadlineShown,
  type CurrencyCode,
  type FulfillmentMode,
  type OrderChangeAddress,
  type OrderChangeDiff,
  type OrderChangeSchedule,
  type StorePaymentMethod,
} from '@floral/domain';
import {
  counterOrderConfirmedEmail,
  newOnlineOrderEmail,
  onlineOrderAcceptedEmail,
  onlineOrderCancelledEmail,
  onlineOrderChangedEmail,
  onlineOrderExpiredShopEmail,
  onlineOrderReceivedEmail,
  onlineOrderStepEmail,
  onlineOrderWithdrawnEmail,
  orderChangeAnsweredShopEmail,
  orderChangeAskedEmail,
  orderChangeReminderEmail,
  orderAssignedEmail,
  orderMessageForBuyerEmail,
  orderMessageForShopEmail,
  orderPaymentRecordedEmail,
  paymentProofReceivedShopEmail,
  paymentProofRejectedEmail,
  pendingOrderReminderEmail,
  type OnlineOrderEmailFacts,
  type OnlineOrderStep,
} from './email-templates';
import { logger } from './logger';
import type { EmailMessage, Mailer } from './mailer';
import { createPublicLinkToken, publicLinkUrl } from './public-links';
import { dateToParts } from './services/quote-internals';

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
    /** «Mensajes» di Floral Care nel gestionale (riassunto giornaliero, ADR-084). */
    readonly careMessages?: (tenantSlug: string) => string;
    /**
     * La pagina dell'ordine nel conto di chi compra (M3: messaggi e cambi); senza, "Mi cuenta".
     */
    readonly buyerOrder?: (orderId: string) => string;
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

export type BuyerOrderMailKind =
  | 'received'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'withdrawn'
  /** M3: i passi dell'ordine e i cambi che la fioreria avvisa. */
  | 'step_preparing'
  | 'step_ready_pickup'
  | 'step_on_the_way'
  | 'step_delivered'
  | 'changed'
  /** M3-2: annullato perché chi compra non ha confermato in tempo i cambi. */
  | 'unconfirmed';

const STEP_KINDS: Readonly<Record<string, OnlineOrderStep>> = {
  step_preparing: 'preparing',
  step_ready_pickup: 'ready_pickup',
  step_on_the_way: 'on_the_way',
  step_delivered: 'delivered',
};

/** La pagina dell'ordine nel conto di chi compra (M3), o "Mi cuenta" se il web non la passa. */
function buyerOrderUrl(orderId: string, deps: OrderMailDeps): string {
  return deps.links.buyerOrder?.(orderId) ?? deps.links.account;
}

/** Le righe dell'ordine come si leggono in un'email: "2 × Ramo Clásico 12 rosas". */
async function lineLabelsTx(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<string[]> {
  const lines = await tx.orderLine.findMany({
    where: { tenantId, orderId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { description: true, quantity: true },
  });
  return lines.map((line) => `${line.quantity} × ${line.description}`);
}

/** Una data e un'ora nel fuso della fioreria, es. "jueves 28 de noviembre, 20:15". */
export function shopDateTimeLabel(at: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(at);
  const time = new Intl.DateTimeFormat(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(at);
  return `${day}, ${time}`;
}

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
  const step = STEP_KINDS[kind];
  if (step) {
    const location =
      step === 'ready_pickup'
        ? await tx.location.findFirst({
            where: { tenantId, isPrimary: true, status: 'ACTIVE' },
            select: { addressLine1: true, neighborhood: true, city: true },
          })
        : null;
    return onlineOrderStepEmail({
      ...common,
      step,
      pickupAddress: location
        ? [location.addressLine1, location.neighborhood, location.city].filter(Boolean).join(', ')
        : null,
    });
  }
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
    case 'changed':
      return onlineOrderChangedEmail({
        ...common,
        url: buyerOrderUrl(order.id, deps),
        lines: await lineLabelsTx(tx, tenantId, order.id),
      });
    case 'rejected':
    case 'cancelled':
    case 'expired':
    case 'withdrawn':
    case 'unconfirmed':
      return onlineOrderCancelledEmail({
        ...common,
        kind,
        reason:
          kind === 'expired' || kind === 'withdrawn' || kind === 'unconfirmed'
            ? null
            : order.cancelReason,
        searchUrl: deps.links.search,
      });
    default:
      return null;
  }
}

/**
 * La conferma per il cliente di un ordine del banco (ADR-072), con il link di tracciamento già
 * pronto (`linkId`, attivo). Da chiamare dentro la transazione del tenant, DOPO la conferma.
 */
export async function counterOrderConfirmationMail(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  input: { readonly to: string; readonly name: string; readonly linkId: string },
  deps: OrderMailDeps,
): Promise<EmailMessage> {
  const [order, tenant] = await Promise.all([
    tx.order.findFirstOrThrow({ where: { tenantId, id: orderId } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, contactEmail: true },
    }),
  ]);
  return counterOrderConfirmedEmail({
    to: input.to,
    name: input.name,
    facts: orderFacts(tenant.displayName, order),
    url: publicLinkUrl(
      deps.appUrl,
      'ORDER',
      createPublicLinkToken(deps.secret, { tenantId, linkId: input.linkId }),
    ),
    replyTo: tenant.contactEmail,
  });
}

/** Gli indirizzi di proprietari e gerenti attivi della fioreria (avvisi degli ordini online). */
async function managerEmailsTx(tx: TransactionClient, tenantId: string): Promise<string[]> {
  const members = await tx.membership.findMany({
    where: { tenantId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(members.map((member) => member.user.email))];
}

/** Il nome di chi ha fatto l'ordine, per gli avvisi alla fioreria ("Un cliente" senza conto). */
async function buyerNameTx(tx: TransactionClient, buyerUserId: string | null): Promise<string> {
  if (!buyerUserId) return 'Un cliente';
  const user = await tx.user.findUnique({ where: { id: buyerUserId }, select: { name: true } });
  return user?.name ?? 'Un cliente';
}

/**
 * Le email per propietari e gerenti attivi della fioreria: un ordine online da guardare, con i
 * prodotti, la zona della consegna (mai l'indirizzo intero), chi riceve, i commenti e la scadenza.
 */
export async function newOrderMailsForShop(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  input: { readonly buyerName: string },
  deps: OrderMailDeps,
): Promise<EmailMessage[]> {
  const [order, tenant, emails, lines] = await Promise.all([
    tx.order.findFirstOrThrow({ where: { tenantId, id: orderId } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, slug: true, timezone: true },
    }),
    managerEmailsTx(tx, tenantId),
    lineLabelsTx(tx, tenantId, orderId),
  ]);
  const facts = orderFacts(tenant.displayName, order);
  const url = deps.links.order(tenant.slug, order.id);
  const zone =
    order.fulfillmentMode === 'DELIVERY'
      ? [order.deliveryNeighborhood, order.deliveryCity].filter(Boolean).join(', ') || null
      : null;
  const deadline = pendingOrderDeadline(
    {
      createdAt: order.createdAt,
      scheduledDate: order.scheduledDate ? dateToParts(order.scheduledDate) : null,
    },
    tenant.timezone,
  );
  return emails.map((to) =>
    newOnlineOrderEmail({
      to,
      buyerName: input.buyerName,
      facts,
      lines,
      zone,
      recipientName: order.fulfillmentMode === 'DELIVERY' ? order.recipientName : null,
      buyerNotes: order.buyerNotes,
      deadlineLabel: shopDateTimeLabel(pendingOrderDeadlineShown(deadline), tenant.timezone),
      url,
    }),
  );
}

/** Le email per propietari e gerenti attivi: chi compra ha annullato l'ordine ancora da accettare. */
export async function withdrawnOrderMailsForShop(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  buyerName: string,
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
    onlineOrderWithdrawnEmail({ to: member.user.email, buyerName, facts, url }),
  );
}

// -----------------------------------------------------------------------------
// Marketplace M3 (ADR-088): avvisi dei messaggi, promemoria e scadenza alla fioreria
// -----------------------------------------------------------------------------

/** A chi compra: la fioreria ha scritto sul suo ordine; null se non c'è più nessuno a cui scrivere. */
export async function buyerMessageNoticeMail(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  deps: OrderMailDeps,
): Promise<EmailMessage | null> {
  const order = await tx.order.findFirst({
    where: { tenantId, id: orderId },
    select: { id: true, number: true, placedOnline: true, buyerUserId: true },
  });
  if (!order?.placedOnline || !order.buyerUserId) return null;
  const [buyer, tenant] = await Promise.all([
    tx.user.findUnique({ where: { id: order.buyerUserId }, select: { name: true, email: true } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, contactEmail: true },
    }),
  ]);
  if (!buyer) return null;
  return orderMessageForBuyerEmail({
    to: buyer.email,
    name: buyer.name,
    shopName: tenant.displayName,
    numberLabel: formatOrderNumber(order.number),
    // Dritto ai messaggi, dove si risponde (se il web non dà la pagina dell'ordine, «Mi cuenta»).
    url: deps.links.buyerOrder ? `${deps.links.buyerOrder(order.id)}#mensajes` : deps.links.account,
    replyTo: tenant.contactEmail,
  });
}

/** A proprietari e gerenti: chi ha fatto l'ordine ha scritto. */
export async function shopMessageNoticeMails(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  deps: OrderMailDeps,
): Promise<EmailMessage[]> {
  const [order, tenant, emails] = await Promise.all([
    tx.order.findFirstOrThrow({
      where: { tenantId, id: orderId },
      select: { id: true, number: true, buyerUserId: true },
    }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, slug: true },
    }),
    managerEmailsTx(tx, tenantId),
  ]);
  const buyerName = await buyerNameTx(tx, order.buyerUserId);
  const url = `${deps.links.order(tenant.slug, order.id)}#mensajes`;
  return emails.map((to) =>
    orderMessageForShopEmail({
      to,
      buyerName,
      shopName: tenant.displayName,
      numberLabel: formatOrderNumber(order.number),
      url,
    }),
  );
}

/** A proprietari e gerenti: l'ordine online da accettare si annulla prima del prossimo giro. */
export async function pendingReminderMailsForShop(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  deadline: Date,
  deps: OrderMailDeps,
): Promise<EmailMessage[]> {
  const [order, tenant, emails] = await Promise.all([
    tx.order.findFirstOrThrow({ where: { tenantId, id: orderId } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, slug: true, timezone: true },
    }),
    managerEmailsTx(tx, tenantId),
  ]);
  const buyerName = await buyerNameTx(tx, order.buyerUserId);
  const facts = orderFacts(tenant.displayName, order);
  const url = deps.links.order(tenant.slug, order.id);
  const deadlineLabel = shopDateTimeLabel(pendingOrderDeadlineShown(deadline), tenant.timezone);
  return emails.map((to) =>
    pendingOrderReminderEmail({ to, buyerName, facts, deadlineLabel, url }),
  );
}

/**
 * A proprietari e gerenti: l'ordine online si è annullato da solo, nessuno l'ha accettato (o chi
 * compra non ha confermato in tempo i cambi, `unconfirmed`, M3-2).
 */
export async function expiredOrderMailsForShop(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  deps: OrderMailDeps,
  options: { readonly unconfirmed?: boolean } = {},
): Promise<EmailMessage[]> {
  const [order, tenant, emails] = await Promise.all([
    tx.order.findFirstOrThrow({ where: { tenantId, id: orderId } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, slug: true },
    }),
    managerEmailsTx(tx, tenantId),
  ]);
  const buyerName = await buyerNameTx(tx, order.buyerUserId);
  const facts = orderFacts(tenant.displayName, order);
  const url = deps.links.order(tenant.slug, order.id);
  return emails.map((to) =>
    onlineOrderExpiredShopEmail({
      to,
      buyerName,
      facts,
      url,
      ...(options.unconfirmed ? { unconfirmed: true } : {}),
    }),
  );
}

// -----------------------------------------------------------------------------
// Marketplace M3-2 (ADR-088): cambi da confermare
// -----------------------------------------------------------------------------

const money = (minor: number, currency: string) =>
  formatMoney(minor, currency as CurrencyCode, LOCALE);

function scheduleLabel(schedule: OrderChangeSchedule, mode: FulfillmentMode): string {
  return whenLabel({
    number: 0,
    fulfillmentMode: mode,
    scheduledDate: schedule.date ? new Date(`${schedule.date}T00:00:00Z`) : null,
    windowStartMinutes: schedule.windowStartMinutes,
    windowEndMinutes: schedule.windowEndMinutes,
    totalMinor: 0,
    currency: 'MXN',
  });
}

function addressLabel(address: OrderChangeAddress | null): string {
  if (!address) return 'sin dirección';
  return [address.line1, address.line2, address.neighborhood, address.city]
    .filter(Boolean)
    .join(', ');
}

const MODE_LABELS: Record<FulfillmentMode, string> = {
  DELIVERY: 'a domicilio',
  PICKUP: 'recoger en la tienda',
};

/** I cambi come si leggono in un'email a chi compra (es-MX): «Día y horario: … → …». */
export function orderChangeLinesEs(
  diff: OrderChangeDiff,
  currency: string,
  mode: FulfillmentMode,
): string[] {
  const lines: string[] = [];
  if (diff.fulfillmentMode) {
    lines.push(
      `Entrega: ${MODE_LABELS[diff.fulfillmentMode.before]} → ${MODE_LABELS[diff.fulfillmentMode.after]}`,
    );
  }
  if (diff.schedule) {
    const before = diff.fulfillmentMode?.before ?? mode;
    lines.push(
      `Día y horario: ${scheduleLabel(diff.schedule.before, before)} → ${scheduleLabel(diff.schedule.after, mode)}`,
    );
  }
  // Passando al ritiro l'indirizzo non serve più: lo dice già la riga della consegna.
  if (diff.address && diff.address.after !== null) {
    lines.push(
      `Dirección: ${addressLabel(diff.address.before)} → ${addressLabel(diff.address.after)}`,
    );
  }
  for (const line of diff.lines) {
    if (line.change === 'added' && line.after) {
      lines.push(
        `Agregado: ${line.after.quantity} × ${line.description} (${money(line.after.lineTotalMinor, currency)})`,
      );
    } else if (line.change === 'removed' && line.before) {
      lines.push(`Quitado: ${line.before.quantity} × ${line.description}`);
    } else if (line.before && line.after) {
      lines.push(
        line.before.quantity !== line.after.quantity
          ? `${line.description}: ${line.before.quantity} → ${line.after.quantity}`
          : `${line.description}: ${money(line.before.unitPriceMinor, currency)} → ${money(line.after.unitPriceMinor, currency)} c/u`,
      );
    }
  }
  if (diff.deliveryFee) {
    lines.push(
      `Envío: ${money(diff.deliveryFee.before, currency)} → ${money(diff.deliveryFee.after, currency)}`,
    );
  }
  if (diff.discount) {
    lines.push(
      `Descuento: ${money(diff.discount.before, currency)} → ${money(diff.discount.after, currency)}`,
    );
  }
  if (diff.total) {
    lines.push(
      `Total: ${money(diff.total.before, currency)} → ${money(diff.total.after, currency)}`,
    );
  }
  return lines;
}

/** La pagina dell'ordine di chi compra, alla scheda dei cambi. */
function buyerChangesUrl(orderId: string, deps: OrderMailDeps): string {
  return deps.links.buyerOrder ? `${deps.links.buyerOrder(orderId)}#cambios` : deps.links.account;
}

/** L'ordine, chi l'ha fatto e la scadenza di adesso (con la richiesta e la risposta). */
async function changeContextTx(tx: TransactionClient, tenantId: string, orderId: string) {
  const order = await tx.order.findFirst({ where: { tenantId, id: orderId } });
  if (!order?.placedOnline || !order.buyerUserId) return null;
  const [buyer, tenant, change] = await Promise.all([
    tx.user.findUnique({ where: { id: order.buyerUserId }, select: { name: true, email: true } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, contactEmail: true, timezone: true },
    }),
    tx.orderChangeRequest.findUnique({
      where: { tenantId_orderId: { tenantId, orderId } },
      select: { askedAt: true, answeredAt: true },
    }),
  ]);
  if (!buyer) return null;
  const deadline = pendingOrderDeadline(
    {
      createdAt: order.createdAt,
      scheduledDate: order.scheduledDate ? dateToParts(order.scheduledDate) : null,
      changeAskedAt: change?.askedAt ?? null,
      changeAnsweredAt: change?.answeredAt ?? null,
    },
    tenant.timezone,
  );
  return { order, buyer, tenant, deadline };
}

/**
 * A chi compra: la fioreria chiede di confermare i cambi (M3-2), con la lista e la scadenza. Da
 * chiamare dentro la transazione della richiesta, DOPO averla scritta.
 */
export async function changeAskedMailTx(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  diff: OrderChangeDiff,
  deps: OrderMailDeps,
): Promise<EmailMessage | null> {
  const found = await changeContextTx(tx, tenantId, orderId);
  if (!found) return null;
  const { order, buyer, tenant, deadline } = found;
  return orderChangeAskedEmail({
    to: buyer.email,
    name: buyer.name,
    facts: orderFacts(tenant.displayName, order),
    changes: orderChangeLinesEs(diff, order.currency, order.fulfillmentMode),
    deadlineLabel: shopDateTimeLabel(pendingOrderDeadlineShown(deadline), tenant.timezone),
    url: buyerChangesUrl(order.id, deps),
    replyTo: tenant.contactEmail,
  });
}

/** A chi compra: la richiesta aspetta la sua risposta e l'ordine si annulla prima del giro dopo. */
export async function changeReminderMailTx(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  deps: OrderMailDeps,
): Promise<EmailMessage | null> {
  const found = await changeContextTx(tx, tenantId, orderId);
  if (!found) return null;
  const { order, buyer, tenant, deadline } = found;
  return orderChangeReminderEmail({
    to: buyer.email,
    name: buyer.name,
    facts: orderFacts(tenant.displayName, order),
    deadlineLabel: shopDateTimeLabel(pendingOrderDeadlineShown(deadline), tenant.timezone),
    url: buyerChangesUrl(order.id, deps),
    replyTo: tenant.contactEmail,
  });
}

/** A proprietari e gerenti: chi compra ha confermato i cambi o ha detto «No, gracias». */
export async function changeAnsweredMailsForShop(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  answer: 'CONFIRMED' | 'DECLINED',
  deps: OrderMailDeps,
): Promise<EmailMessage[]> {
  const [order, tenant, emails] = await Promise.all([
    tx.order.findFirstOrThrow({ where: { tenantId, id: orderId } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, slug: true },
    }),
    managerEmailsTx(tx, tenantId),
  ]);
  const buyerName = await buyerNameTx(tx, order.buyerUserId);
  const facts = orderFacts(tenant.displayName, order);
  const url = deps.links.order(tenant.slug, order.id);
  return emails.map((to) => orderChangeAnsweredShopEmail({ to, buyerName, facts, answer, url }));
}

// -----------------------------------------------------------------------------
// M3-3 «Soldi e squadra»: pagamenti, prove e assegnazioni
// -----------------------------------------------------------------------------

/** La pagina dell'ordine di chi compra, alla scheda dei pagamenti. */
function buyerPaymentsUrl(orderId: string, deps: OrderMailDeps): string {
  return deps.links.buyerOrder ? `${deps.links.buyerOrder(orderId)}#pagos` : deps.links.account;
}

/** Chi ha fatto l'ordine online e la fioreria, o null (ordine del banco, conto eliminato). */
async function buyerOfOrderTx(tx: TransactionClient, tenantId: string, orderId: string) {
  const order = await tx.order.findFirst({ where: { tenantId, id: orderId } });
  if (!order?.placedOnline || !order.buyerUserId) return null;
  const [buyer, tenant] = await Promise.all([
    tx.user.findUnique({ where: { id: order.buyerUserId }, select: { name: true, email: true } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, contactEmail: true },
    }),
  ]);
  return buyer ? { order, buyer, tenant } : null;
}

/**
 * A chi compra: il pagamento (o il rimborso) appena registrato, con totale, pagato e quanto manca.
 * Da chiamare DOPO la scrittura, nella stessa transazione: legge il pagato aggiornato.
 */
export async function paymentRecordedMailTx(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  input: { readonly amountMinor: number; readonly refund: boolean },
  deps: OrderMailDeps,
): Promise<EmailMessage | null> {
  const found = await buyerOfOrderTx(tx, tenantId, orderId);
  if (!found) return null;
  const { order, buyer, tenant } = found;
  const currency = order.currency as CurrencyCode;
  const label = (minor: number) => formatMoney(minor, currency, LOCALE);
  return orderPaymentRecordedEmail({
    to: buyer.email,
    name: buyer.name,
    facts: orderFacts(tenant.displayName, order),
    refund: input.refund,
    amountLabel: label(input.amountMinor),
    paidLabel: label(order.paidMinor),
    balanceLabel: label(orderBalanceMinor(order.paidMinor, order.totalMinor)),
    url: buyerPaymentsUrl(order.id, deps),
    replyTo: tenant.contactEmail,
  });
}

/** A chi compra: la fioreria non ha trovato il pagamento della sua prova (con il motivo). */
export async function paymentProofRejectedMailTx(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  input: { readonly amountMinor: number; readonly reason: string },
  deps: OrderMailDeps,
): Promise<EmailMessage | null> {
  const found = await buyerOfOrderTx(tx, tenantId, orderId);
  if (!found) return null;
  const { order, buyer, tenant } = found;
  return paymentProofRejectedEmail({
    to: buyer.email,
    name: buyer.name,
    facts: orderFacts(tenant.displayName, order),
    amountLabel: formatMoney(input.amountMinor, order.currency as CurrencyCode, LOCALE),
    reason: input.reason,
    url: buyerPaymentsUrl(order.id, deps),
    replyTo: tenant.contactEmail,
  });
}

/** A proprietari e gerenti: chi compra ha caricato una prova di pagamento da controllare. */
export async function paymentProofReceivedMailsForShop(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  amountMinor: number,
  deps: OrderMailDeps,
): Promise<EmailMessage[]> {
  const [order, tenant, emails] = await Promise.all([
    tx.order.findFirstOrThrow({
      where: { tenantId, id: orderId },
      select: { id: true, number: true, currency: true },
    }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, slug: true },
    }),
    managerEmailsTx(tx, tenantId),
  ]);
  const url = `${deps.links.order(tenant.slug, order.id)}#pagos`;
  return emails.map((to) =>
    paymentProofReceivedShopEmail({
      to,
      shopName: tenant.displayName,
      numberLabel: formatOrderNumber(order.number),
      amountLabel: formatMoney(amountMinor, order.currency as CurrencyCode, LOCALE),
      url,
    }),
  );
}

/**
 * A chi consegna: gli hanno assegnato un ordine (giorno, fascia e zona; mai l'indirizzo intero,
 * che legge nell'ordine). Null se la persona non è più attiva.
 */
export async function orderAssignedMailTx(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
  membershipId: string,
  deps: OrderMailDeps,
): Promise<EmailMessage | null> {
  const [order, tenant, member] = await Promise.all([
    tx.order.findFirstOrThrow({ where: { tenantId, id: orderId } }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { displayName: true, slug: true },
    }),
    tx.membership.findFirst({
      where: { tenantId, id: membershipId, status: 'ACTIVE' },
      select: { user: { select: { name: true, email: true } } },
    }),
  ]);
  if (!member) return null;
  const zone = [order.deliveryNeighborhood, order.deliveryCity].filter(Boolean).join(', ') || null;
  return orderAssignedEmail({
    to: member.user.email,
    name: member.user.name,
    shopName: tenant.displayName,
    numberLabel: formatOrderNumber(order.number),
    when: whenLabel(order),
    zone,
    url: deps.links.order(tenant.slug, order.id),
  });
}
