/**
 * Ordini [ORD-01] (ADR-054, docs/ORDERS_MARKETPLACE_PLAN.md §3).
 *
 *  - un ordine nasce da un preventivo ACCETTATO (blocco A1a) copiandone righe e snapshot: prezzi,
 *    distinta e immagine del ramo restano quelli concordati col cliente;
 *  - numero progressivo per tenant (PED-0001) nella stessa transazione della creazione;
 *  - indirizzo di consegna COPIATO nell'ordine (dalla rubrica del cliente o nuovo);
 *  - pagamenti registrati a mano (D-26), con storno al posto della cancellazione; il database
 *    verifica totali e stato del pagamento (CHECK);
 *  - ogni cambio di stato va nella cronologia (`OrderStatusEvent`) e nel registro di audit.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  EMPTY_PLACE,
  ORDER_LIMITS,
  ORDER_PAGE_SIZE,
  ORDER_STATUSES,
  acceptsOrderPayments,
  acceptsOrderPhoto,
  areOrderLinesEditable,
  canCancelOrder,
  canStepOrder,
  catalogQuoteLineSchema,
  counterConfirmationRecipient,
  customQuoteLineSchema,
  deliveryAddressSchema,
  diffFields,
  effectiveQuoteStatus,
  formatOrderNumber,
  formatQuoteNumber,
  formatTimeOfDay,
  freshCoordinates,
  isOrderAcceptance,
  isOrderEditable,
  isOrderHandedOver,
  isUuid,
  nextStoredPlace,
  orderBalanceMinor,
  orderCancelSchema,
  onlineOrderAcceptSchema,
  onlineOrderNeedsFreeDeliveryConfirmation,
  onlineOrderRejectSchema,
  onlineRejectReasonText,
  orderStepNotice,
  pendingOrderDeadline,
  checkboxField,
  orderConfirmationNoticeSchema,
  orderDiscountSchema,
  orderFulfillmentSchema,
  orderListFiltersSchema,
  orderPaymentSchema,
  orderPaymentStatus,
  orderStepsFrom,
  priceOrder,
  quoteLineQuantitySchema,
  roundedDistanceKm,
  todayInTimeZone,
  toFieldErrors,
  worstAvailability,
  type AcquisitionSource,
  type Availability,
  type FulfillmentMode,
  type OrderFulfillmentInput,
  type OrderPaymentKind,
  type OrderPaymentStatus,
  type OrderStatus,
  type OrderWhenFilter,
  type PaymentMethod,
  type SaleUnit,
  type StoredPlace,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import type { EmailMessage } from '../mailer';
import { readStoredImage } from '../media/stored-files';
import {
  buyerOrderMail,
  counterOrderConfirmationMail,
  sendOrderMails,
  type OrderMailDeps,
} from '../order-mail';
import { claimOnceNoticeTx } from '../order-message-internals';
import { requireEntitlement } from './billing';
import { consumeStockTx } from './inventory';
import { consumeReservationTx, releaseReservationTx } from './inventory-reservations';
import { orderStockRequest } from './order-inventory';
import { activeOrderReservationId, syncOrderReservationTx } from './order-reservation';
import { loadShopPlace } from './care-internals';
import { ensureOrderPublicLinkTx, extendOrderPublicLinkTx } from './public-links';
import {
  catalogLineDraft,
  configurationLineDraft,
  customLineDraft,
  lineRowData,
  recipeForDisplay,
  serviceForDisplay,
  type LineDraft,
  type LineServiceInfo,
} from './line-internals';
import {
  addDays,
  dateToParts,
  formatDateParts,
  lockQuote,
  nextTenantCounter,
  partsToDate,
  type DateParts,
} from './quote-internals';

// -----------------------------------------------------------------------------
// DTO
// -----------------------------------------------------------------------------

export interface OrderSummaryDto {
  readonly id: string;
  readonly number: number;
  readonly numberLabel: string;
  readonly status: OrderStatus;
  readonly fulfillmentMode: FulfillmentMode;
  /** "AAAA-MM-GG" nel calendario del tenant; null solo per i borradores. */
  readonly scheduledDate: string | null;
  /** "HH:MM" nel fuso del tenant; null = in giornata. */
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly customerId: string;
  readonly customerName: string;
  readonly recipientName: string | null;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly paymentStatus: OrderPaymentStatus;
  readonly currency: string;
  readonly createdAt: Date;
  /** Fatto da chi compra dalla tienda en línea (segno «Online», M3). */
  readonly placedOnline: boolean;
  /** Messaggi di chi compra ancora da leggere (M3); 0 per gli ordini del banco. */
  readonly unreadMessages: number;
  /** Ordine online da accettare: fino a quando, poi si annulla da solo (M3). */
  readonly onlineDeadline: Date | null;
}

export interface OrderRecipeLineSnapshot {
  readonly name: string;
  readonly variety: string | null;
  readonly quantity: number;
  readonly saleUnit: SaleUnit;
  readonly color?: string | null;
  /** Il fiore concordato all'inizio, se poi è stato sostituito (ADR-081). */
  readonly replaces?: { readonly name: string; readonly variety: string | null };
}

export interface OrderLineDto {
  readonly id: string;
  readonly kind: 'CATALOG_ITEM' | 'CUSTOM' | 'BUILDER';
  readonly catalogItemId: string | null;
  /** Dallo snapshot: per le righe BUILDER la disponibilità più critica fra i componenti. */
  readonly availability: Availability | null;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly saleUnit: SaleUnit | null;
  readonly recipe: readonly OrderRecipeLineSnapshot[] | null;
  /** Servizi (ADR-081): durata e raggio come concordati nella riga. */
  readonly service: LineServiceInfo | null;
  readonly bouquetConfigurationId: string | null;
  /**
   * Immagine del ramo dalla riga del preventivo: `photo` = foto vera caricata dalla fioreria
   * (ADR-052, ha la precedenza), `ai` = anteprima generata (ADR-035).
   */
  readonly image: {
    readonly source: 'photo' | 'ai';
    readonly verified: boolean;
    readonly simulated: boolean;
  } | null;
}

export interface OrderPaymentDto {
  readonly id: string;
  readonly kind: OrderPaymentKind;
  readonly method: PaymentMethod;
  readonly amountMinor: number;
  /** "AAAA-MM-GG". */
  readonly paidOn: string;
  readonly reference: string | null;
  readonly createdAt: Date;
  /** Un pagamento già stornato (o uno storno) non si storna più. */
  readonly reversed: boolean;
}

export interface OrderEventDto {
  readonly id: string;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface OrderDeliveryAddressDto {
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly neighborhood: string | null;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly countryCode: string;
  /** Google Places (ADR-059): presente se l'indirizzo è stato scelto fra i suggerimenti. */
  readonly placeId: string | null;
}

/**
 * Servizi della riga oltre il loro raggio (ADR-081): distanza in linea retta fra la fioreria e
 * l'indirizzo del pedido. Null se non si può misurare (ritiro, posizioni mancanti o scadute) o se
 * tutti i servizi arrivano fin lì.
 */
export interface OrderServiceZoneDto {
  readonly distanceKm: number;
  readonly lines: readonly { readonly description: string; readonly radiusKm: number }[];
}

export interface OrderDetailDto extends OrderSummaryDto {
  readonly quote: { readonly id: string; readonly numberLabel: string } | null;
  readonly serviceZone: OrderServiceZoneDto | null;
  readonly customer: {
    readonly id: string;
    readonly displayName: string;
    readonly phone: string | null;
    readonly email: string | null;
  };
  readonly customerAddressId: string | null;
  readonly deliveryAddress: OrderDeliveryAddressDto | null;
  readonly deliveryNotes: string | null;
  readonly recipientPhone: string | null;
  readonly cardMessage: string | null;
  readonly cardSignature: string | null;
  readonly cardAnonymous: boolean;
  readonly notes: string | null;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly deliveryFeeMinor: number;
  readonly balanceMinor: number;
  readonly acquisitionSource: AcquisitionSource;
  /** Fatto da chi compra dalla tienda en línea (ADR-067). */
  readonly placedOnline: boolean;
  /** Commenti di chi compra per la fioreria. */
  readonly buyerNotes: string | null;
  readonly cancelReason: string | null;
  readonly statusChangedAt: Date;
  /**
   * «Avvisa il cliente dei cambi» (M3): ordine online accettato e non ancora chiuso, con chi l'ha
   * fatto che ha ancora il conto, e chi guarda lo può cambiare.
   */
  readonly canNotifyCustomer: boolean;
  readonly lines: readonly OrderLineDto[];
  readonly payments: readonly OrderPaymentDto[];
  readonly events: readonly OrderEventDto[];
  /** Passi che chi guarda può fare adesso (il servizio li riverifica). */
  readonly nextSteps: readonly OrderStatus[];
  /** Consegna e tarjeta modificabili da chi guarda. */
  readonly editable: boolean;
  /** Righe e sconto modificabili da chi guarda (fino a "en preparación"). */
  readonly linesEditable: boolean;
  /** Repartidor (solo a domicilio). */
  readonly assignee: { readonly membershipId: string; readonly name: string } | null;
  /** Prova di consegna (ADR-058): chi ha ricevuto e foto del ramo finito. */
  readonly handover: {
    readonly receivedBy: string | null;
    readonly photo: { readonly id: string; readonly createdAt: Date } | null;
    /** Chi guarda può caricare la foto (da "pronto" in poi). */
    readonly canAddPhoto: boolean;
    /** Chi guarda può indicare chi ha ricevuto (dopo consegna o ritiro). */
    readonly canSetReceiver: boolean;
  };
  readonly canCancel: boolean;
  /** Ordine online "Por aceptar" che chi guarda può accettare (o rifiutare: `canCancel`). */
  readonly canAccept: boolean;
  /** Borrador che chi guarda può scartare. */
  readonly canDiscard: boolean;
  readonly canRecordPayments: boolean;
}

type OrderWithCustomer = Prisma.OrderGetPayload<{
  include: { customer: { select: { id: true; displayName: true; phone: true; email: true } } };
}>;

const orderInclude = {
  customer: { select: { id: true, displayName: true, phone: true, email: true } },
} satisfies Prisma.OrderInclude;

function dateString(date: Date): string {
  return formatDateParts(dateToParts(date)) ?? '';
}

function toSummary(
  order: OrderWithCustomer,
  timeZone: string,
  unreadMessages = 0,
): OrderSummaryDto {
  return {
    id: order.id,
    number: order.number,
    numberLabel: formatOrderNumber(order.number),
    status: order.status,
    fulfillmentMode: order.fulfillmentMode,
    scheduledDate: order.scheduledDate ? dateString(order.scheduledDate) : null,
    windowStart:
      order.windowStartMinutes === null ? null : formatTimeOfDay(order.windowStartMinutes),
    windowEnd: order.windowEndMinutes === null ? null : formatTimeOfDay(order.windowEndMinutes),
    customerId: order.customer.id,
    customerName: order.customer.displayName,
    recipientName: order.recipientName,
    totalMinor: order.totalMinor,
    paidMinor: order.paidMinor,
    paymentStatus: order.paymentStatus,
    currency: order.currency,
    createdAt: order.createdAt,
    placedOnline: order.placedOnline,
    unreadMessages,
    onlineDeadline:
      order.placedOnline && order.status === 'PENDING_ACCEPTANCE'
        ? pendingOrderDeadline(
            {
              createdAt: order.createdAt,
              scheduledDate: order.scheduledDate ? dateToParts(order.scheduledDate) : null,
            },
            timeZone,
          )
        : null,
  };
}

/** Quanti messaggi di chi compra restano da leggere, per ordine (solo quelli con almeno uno). */
async function unreadByOrderTx(
  tx: TransactionClient,
  tenantId: string,
  orderIds: readonly string[],
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const rows = await tx.orderMessage.groupBy({
    by: ['orderId'],
    where: { tenantId, orderId: { in: [...orderIds] }, authorKind: 'BUYER', readByShopAt: null },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.orderId, row._count._all]));
}

interface LineSnapshot {
  readonly item?: { readonly saleUnit: SaleUnit; readonly availability?: Availability };
  readonly recipe?: readonly OrderRecipeLineSnapshot[];
  readonly components?: readonly { readonly availability: Availability }[];
}

function readSnapshot(value: Prisma.JsonValue | null): LineSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as LineSnapshot;
}

// -----------------------------------------------------------------------------
// Lettura
// -----------------------------------------------------------------------------

export interface OrderListResult {
  readonly items: readonly OrderSummaryDto[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly when: OrderWhenFilter;
  readonly canWrite: boolean;
  /** Ordini online in attesa di risposta, con qualsiasi filtro (per l'avviso in cima). */
  readonly pendingCount: number;
  /** Ordini con messaggi di chi compra da leggere (filtro «Con messaggi da leggere», M3). */
  readonly unreadOrdersCount: number;
  readonly messagesFilter: boolean;
}

function whenWhere(when: OrderWhenFilter, today: DateParts): Prisma.OrderWhereInput {
  const day = (offset: number) => partsToDate(addDays(today, offset));
  switch (when) {
    case 'today':
      return { scheduledDate: day(0) };
    case 'tomorrow':
      return { scheduledDate: day(1) };
    case 'week':
      return { scheduledDate: { gte: day(0), lte: day(6) } };
    case 'upcoming':
      return { scheduledDate: { gte: day(0) } };
    case 'past':
      return { scheduledDate: { lt: day(0) } };
    case 'all':
      // Borradores (anche scartati) senza data: non sono ancora ordini.
      return { scheduledDate: { not: null } };
    case 'drafts':
      return { status: 'DRAFT' };
    case 'pending':
      return { status: 'PENDING_ACCEPTANCE' };
  }
}

export async function listOrders(
  ctx: TenantContext,
  rawFilters: unknown,
): Promise<OrderListResult> {
  requirePermission(ctx, 'orders:read');
  const filters = orderListFiltersSchema.parse(rawFilters ?? {});
  const numberMatch = /^(?:ped-?)?0*(\d{1,9})$/i.exec(filters.q);
  const today = todayInTimeZone(ctx.timezone);
  const where: Prisma.OrderWhereInput = {
    tenantId: ctx.tenantId,
    AND: [
      whenWhere(filters.when, today),
      filters.status ? { status: filters.status } : {},
      filters.unpaid
        ? { paymentStatus: { in: ['UNPAID', 'PARTIAL'] }, status: { not: 'CANCELLED' } }
        : {},
      filters.messages ? { messages: { some: { authorKind: 'BUYER', readByShopAt: null } } } : {},
      filters.q
        ? {
            OR: [
              { customer: { displayName: { contains: filters.q, mode: 'insensitive' } } },
              { recipientName: { contains: filters.q, mode: 'insensitive' } },
              ...(numberMatch ? [{ number: Number(numberMatch[1]) }] : []),
            ],
          }
        : {},
    ],
  };
  // Borradores: i più recenti prima. Dal passato si guarda all'indietro; altrimenti i più vicini
  // prima, per fascia.
  const backwards = filters.when === 'past' || filters.when === 'all';
  const orderBy: Prisma.OrderOrderByWithRelationInput[] =
    filters.when === 'drafts'
      ? [{ number: 'desc' }]
      : backwards
        ? [{ scheduledDate: 'desc' }, { number: 'desc' }]
        : [
            { scheduledDate: 'asc' },
            { windowStartMinutes: { sort: 'asc', nulls: 'last' } },
            { number: 'asc' },
          ];
  return withTenantContext(getDb(), ctx, async (tx) => {
    const [total, pendingCount, unreadOrdersCount] = await Promise.all([
      tx.order.count({ where }),
      tx.order.count({ where: { tenantId: ctx.tenantId, status: 'PENDING_ACCEPTANCE' } }),
      tx.order.count({
        where: {
          tenantId: ctx.tenantId,
          messages: { some: { authorKind: 'BUYER', readByShopAt: null } },
        },
      }),
    ]);
    const pageCount = Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const orders = await tx.order.findMany({
      where,
      include: orderInclude,
      orderBy,
      skip: (page - 1) * ORDER_PAGE_SIZE,
      take: ORDER_PAGE_SIZE,
    });
    const unread = await unreadByOrderTx(
      tx,
      ctx.tenantId,
      orders.filter((order) => order.placedOnline).map((order) => order.id),
    );
    return {
      items: orders.map((order) => toSummary(order, ctx.timezone, unread.get(order.id) ?? 0)),
      total,
      page,
      pageCount,
      when: filters.when,
      canWrite: hasPermission(ctx, 'orders:write'),
      pendingCount,
      unreadOrdersCount,
      messagesFilter: filters.messages,
    };
  });
}

/**
 * Ultimi ordini di un cliente per la sua scheda (borradores compresi, scartati esclusi), i più
 * recenti prima.
 */
export async function listCustomerOrders(
  ctx: TenantContext,
  customerId: string,
): Promise<readonly OrderSummaryDto[]> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(customerId)) return [];
  return withTenantContext(getDb(), ctx, async (tx) => {
    const orders = await tx.order.findMany({
      where: {
        tenantId: ctx.tenantId,
        customerId,
        OR: [{ status: 'DRAFT' }, { scheduledDate: { not: null } }],
      },
      include: orderInclude,
      orderBy: { number: 'desc' },
      take: 50,
    });
    return orders.map((order) => toSummary(order, ctx.timezone));
  });
}

/**
 * Passi del banco che il ruolo di chi guarda può fare (`orders:fulfill`). Accettare un ordine online
 * non è un passo: ha il suo pulsante e la sua email (`acceptOnlineOrder`).
 */
export function allowedOrderSteps(
  ctx: TenantContext,
  status: OrderStatus,
  mode: FulfillmentMode,
): OrderStatus[] {
  if (!hasPermission(ctx, 'orders:fulfill')) return [];
  return orderStepsFrom(status, mode).filter((to) => !isOrderAcceptance(status, to));
}

/** Stati di un ordine online accettato e non ancora consegnato: lì un cambio va detto a chi compra. */
const NOTIFIABLE_STATUSES: readonly OrderStatus[] = [
  'CONFIRMED',
  'IN_PREPARATION',
  'READY',
  'OUT_FOR_DELIVERY',
];

/** «Avvisa il cliente dei cambi» vale per un ordine online accettato, non chiuso, di un conto attivo. */
function customerCanBeNotified(order: {
  readonly placedOnline: boolean;
  readonly buyerUserId: string | null;
  readonly status: OrderStatus;
}): boolean {
  return (
    order.placedOnline && order.buyerUserId !== null && NOTIFIABLE_STATUSES.includes(order.status)
  );
}

export async function getOrder(ctx: TenantContext, orderId: string): Promise<OrderDetailDto> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId },
      include: {
        ...orderInclude,
        quote: { select: { id: true, number: true } },
        assignedTo: { select: { id: true, user: { select: { name: true } } } },
        photos: {
          where: { status: 'ACTIVE' },
          select: { id: true, createdAt: true },
          take: 1,
        },
      },
    });
    if (!order) return null;
    // In fila: una transazione usa una sola connessione (ADR-053).
    const lines = await tx.orderLine.findMany({
      where: { tenantId: ctx.tenantId, orderId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        previewJob: { select: { status: true, provider: true, output: true, outputKey: true } },
        bouquetPhoto: { select: { id: true } },
      },
    });
    const payments = await tx.orderPayment.findMany({
      where: { tenantId: ctx.tenantId, orderId },
      orderBy: [{ createdAt: 'asc' }],
      include: { reversal: { select: { id: true } } },
    });
    const events = await tx.orderStatusEvent.findMany({
      where: { tenantId: ctx.tenantId, orderId },
      orderBy: [{ createdAt: 'asc' }],
    });
    // Servizi con un raggio (ADR-081): la posizione della fioreria solo se serve.
    const withRadius = lines.filter(
      (line) => serviceForDisplay(readSnapshot(line.snapshot)?.item)?.radiusKm,
    );
    const shop =
      withRadius.length > 0 && order.fulfillmentMode === 'DELIVERY'
        ? await loadShopPlace(tx, ctx.tenantId)
        : null;
    // I messaggi di chi compra da leggere (M3): il segno in cima alla pagina dell'ordine.
    const unread = order.placedOnline
      ? ((await unreadByOrderTx(tx, ctx.tenantId, [order.id])).get(order.id) ?? 0)
      : 0;
    return { order, lines, payments, events, shopOrigin: shop?.origin ?? null, unread };
  });
  if (!result) return notFound(ctx, 'Order', orderId);
  const { order, lines, payments, events, shopOrigin, unread } = result;
  const site = shopOrigin
    ? freshCoordinates(
        {
          latitude: order.deliveryLatitude,
          longitude: order.deliveryLongitude,
          coordinatesAt: order.deliveryCoordinatesAt,
        },
        new Date(),
      )
    : null;
  const distanceKm = shopOrigin && site ? roundedDistanceKm(shopOrigin, site) : null;
  const beyond =
    distanceKm === null
      ? []
      : lines.flatMap((line) => {
          const radiusKm = serviceForDisplay(readSnapshot(line.snapshot)?.item)?.radiusKm ?? null;
          return radiusKm !== null && distanceKm > radiusKm
            ? [{ description: line.description, radiusKm }]
            : [];
        });
  const serviceZone =
    distanceKm !== null && beyond.length > 0 ? { distanceKm, lines: beyond } : null;
  const canWrite = hasPermission(ctx, 'orders:write');
  const delivery: OrderDeliveryAddressDto | null =
    order.fulfillmentMode === 'DELIVERY' &&
    order.deliveryAddressLine1 &&
    order.deliveryCity &&
    order.deliveryRegion &&
    order.deliveryPostalCode &&
    order.deliveryCountryCode
      ? {
          addressLine1: order.deliveryAddressLine1,
          addressLine2: order.deliveryAddressLine2,
          neighborhood: order.deliveryNeighborhood,
          city: order.deliveryCity,
          region: order.deliveryRegion,
          postalCode: order.deliveryPostalCode,
          countryCode: order.deliveryCountryCode,
          placeId: order.deliveryPlaceId,
        }
      : null;
  return {
    ...toSummary(order, ctx.timezone, unread),
    quote: order.quote
      ? { id: order.quote.id, numberLabel: formatQuoteNumber(order.quote.number) }
      : null,
    serviceZone,
    customer: order.customer,
    customerAddressId: order.customerAddressId,
    deliveryAddress: delivery,
    deliveryNotes: order.deliveryNotes,
    recipientPhone: order.recipientPhone,
    cardMessage: order.cardMessage,
    cardSignature: order.cardSignature,
    cardAnonymous: order.cardAnonymous,
    notes: order.notes,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    balanceMinor:
      order.status === 'CANCELLED' ? 0 : orderBalanceMinor(order.paidMinor, order.totalMinor),
    acquisitionSource: order.acquisitionSource,
    placedOnline: order.placedOnline,
    buyerNotes: order.buyerNotes,
    cancelReason: order.cancelReason,
    statusChangedAt: order.statusChangedAt,
    canNotifyCustomer: canWrite && customerCanBeNotified(order),
    lines: lines.map((line) => {
      const snapshot = readSnapshot(line.snapshot);
      return {
        id: line.id,
        kind: line.kind,
        catalogItemId: line.catalogItemId,
        availability:
          snapshot?.item?.availability ??
          worstAvailability((snapshot?.components ?? []).map((part) => part.availability)),
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineTotalMinor: line.lineTotalMinor,
        saleUnit: snapshot?.item?.saleUnit ?? null,
        recipe: recipeForDisplay(snapshot?.recipe),
        service: serviceForDisplay(snapshot?.item),
        bouquetConfigurationId: line.bouquetConfigurationId,
        // La foto vera del ramo (ADR-052) ha la precedenza sull'anteprima AI.
        image: line.bouquetPhoto
          ? { source: 'photo' as const, verified: false, simulated: false }
          : line.previewJob?.status === 'SUCCEEDED' && line.previewJob.outputKey
            ? {
                source: 'ai' as const,
                verified:
                  (line.previewJob.output as { verified?: unknown } | null)?.verified === true,
                simulated: line.previewJob.provider === 'simulated',
              }
            : null,
      };
    }),
    payments: payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind,
      method: payment.method,
      amountMinor: payment.amountMinor,
      paidOn: dateString(payment.paidOn),
      reference: payment.reference,
      createdAt: payment.createdAt,
      reversed: payment.kind === 'REVERSAL' || payment.reversal !== null,
    })),
    events: events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt,
    })),
    nextSteps: allowedOrderSteps(ctx, order.status, order.fulfillmentMode),
    editable: canWrite && isOrderEditable(order.status),
    linesEditable: canWrite && areOrderLinesEditable(order.status),
    assignee: order.assignedTo
      ? { membershipId: order.assignedTo.id, name: order.assignedTo.user.name }
      : null,
    handover: {
      receivedBy: order.handoverName,
      photo: order.photos[0] ?? null,
      canAddPhoto: hasPermission(ctx, 'orders:fulfill') && acceptsOrderPhoto(order.status),
      canSetReceiver: hasPermission(ctx, 'orders:fulfill') && isOrderHandedOver(order.status),
    },
    canCancel: canWrite && canCancelOrder(order.status),
    canAccept: canWrite && order.status === 'PENDING_ACCEPTANCE',
    canDiscard: canWrite && order.status === 'DRAFT',
    canRecordPayments: hasPermission(ctx, 'orders:payments') && acceptsOrderPayments(order.status),
  };
}

/** L'ordine nato da un preventivo, se c'è (per il collegamento dalla pagina del preventivo). */
export async function getQuoteOrder(
  ctx: TenantContext,
  quoteId: string,
): Promise<{ id: string; numberLabel: string } | null> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(quoteId)) return null;
  const order = await withTenantContext(getDb(), ctx, (tx) =>
    tx.order.findFirst({
      where: { tenantId: ctx.tenantId, quoteId },
      select: { id: true, number: true },
    }),
  );
  return order ? { id: order.id, numberLabel: formatOrderNumber(order.number) } : null;
}

// -----------------------------------------------------------------------------
// Dati di consegna (creazione e modifica)
// -----------------------------------------------------------------------------

interface ResolvedFulfillment {
  readonly data: {
    fulfillmentMode: FulfillmentMode;
    scheduledDate: Date;
    windowStartMinutes: number | null;
    windowEndMinutes: number | null;
    customerAddressId: string | null;
    deliveryAddressLine1: string | null;
    deliveryAddressLine2: string | null;
    deliveryNeighborhood: string | null;
    deliveryCity: string | null;
    deliveryRegion: string | null;
    deliveryPostalCode: string | null;
    deliveryCountryCode: string | null;
    deliveryPlaceId: string | null;
    deliveryLatitude: number | null;
    deliveryLongitude: number | null;
    deliveryCoordinatesAt: Date | null;
    deliveryNotes: string | null;
    recipientName: string | null;
    recipientPhone: string | null;
    cardMessage: string | null;
    cardSignature: string | null;
    cardAnonymous: boolean;
    notes: string | null;
  };
  readonly deliveryFeeMinor: number;
}

function parseFulfillment(ctx: TenantContext, rawInput: unknown): OrderFulfillmentInput {
  const parsed = orderFulfillmentSchema(ctx.country, ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  return parsed.data;
}

/**
 * Trasforma i dati del form in colonne dell'ordine, dentro la transazione: l'indirizzo scelto
 * dalla rubrica deve essere del cliente dell'ordine; un indirizzo nuovo segue le regole della
 * rubrica. `keepDate` consente di lasciare una data già passata a un ordine esistente.
 */
async function resolveFulfillment(
  tx: TransactionClient,
  ctx: TenantContext,
  customerId: string,
  input: OrderFulfillmentInput,
  rawInput: unknown,
  keepDate: Date | null,
  /** Luogo di Google Places già sull'ordine (modifica), per non allungare la cache. */
  existingPlace: StoredPlace | null = null,
): Promise<ResolvedFulfillment> {
  const today = todayInTimeZone(ctx.timezone);
  const scheduled = partsToDate(input.scheduledDate);
  const unchanged = keepDate !== null && keepDate.getTime() === scheduled.getTime();
  if (
    !unchanged &&
    (scheduled < partsToDate(today) ||
      scheduled > partsToDate(addDays(today, ORDER_LIMITS.scheduleDaysMax)))
  ) {
    throw new ValidationError({ scheduledDate: 'out_of_range' });
  }

  let address: Omit<OrderDeliveryAddressDto, 'countryCode' | 'placeId'> | null = null;
  let customerAddressId: string | null = null;
  // Google Places (ADR-059): place ID e coordinate (cache di 30 giorni) dell'indirizzo di consegna.
  let place: StoredPlace = EMPTY_PLACE;
  let recipientName = input.recipientName;
  let recipientPhone = input.recipientPhone;
  let deliveryNotes = input.deliveryNotes;
  if (input.fulfillmentMode === 'DELIVERY') {
    if (input.customerAddressId) {
      const saved = await tx.customerAddress.findFirst({
        where: {
          id: input.customerAddressId,
          tenantId: ctx.tenantId,
          customerId,
          status: 'ACTIVE',
        },
      });
      if (!saved) throw new ValidationError({ customerAddressId: 'invalid_option' });
      customerAddressId = saved.id;
      address = saved;
      place = {
        placeId: saved.placeId,
        latitude: saved.latitude,
        longitude: saved.longitude,
        coordinatesAt: saved.coordinatesAt,
      };
      // Dalla rubrica si prendono destinatario e referencias, se il form non li indica.
      recipientName ??= saved.recipientName;
      recipientPhone ??= saved.recipientPhone;
      deliveryNotes ??= saved.deliveryNotes;
    } else {
      const parsed = deliveryAddressSchema(ctx.country).safeParse(rawInput);
      if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
      address = parsed.data;
      place = nextStoredPlace(
        rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {},
        existingPlace,
        new Date(),
      );
    }
  }

  return {
    deliveryFeeMinor: input.fulfillmentMode === 'DELIVERY' ? input.deliveryFee : 0,
    data: {
      fulfillmentMode: input.fulfillmentMode,
      scheduledDate: scheduled,
      windowStartMinutes: input.windowStart,
      windowEndMinutes: input.windowEnd,
      customerAddressId,
      deliveryAddressLine1: address?.addressLine1 ?? null,
      deliveryAddressLine2: address?.addressLine2 ?? null,
      deliveryNeighborhood: address?.neighborhood ?? null,
      deliveryCity: address?.city ?? null,
      deliveryRegion: address?.region ?? null,
      deliveryPostalCode: address?.postalCode ?? null,
      deliveryCountryCode: address ? ctx.country : null,
      deliveryPlaceId: place.placeId,
      deliveryLatitude: place.latitude,
      deliveryLongitude: place.longitude,
      deliveryCoordinatesAt: place.coordinatesAt,
      deliveryNotes: input.fulfillmentMode === 'DELIVERY' ? deliveryNotes : null,
      recipientName,
      recipientPhone,
      cardMessage: input.cardMessage,
      cardSignature: input.cardAnonymous ? null : input.cardSignature,
      cardAnonymous: input.cardAnonymous,
      notes: input.notes,
    },
  };
}

async function lockOrder(tx: TransactionClient, ctx: TenantContext, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  return tx.order.findFirst({ where: { id: orderId, tenantId: ctx.tenantId } });
}

/** "Enviar la confirmación" spuntata nel form di conferma (ADR-072); assente = no. */
function confirmationRequested(rawInput: unknown): boolean {
  return orderConfirmationNoticeSchema.safeParse(rawInput).data?.notifyCustomer === true;
}

/**
 * A chi va la conferma per email di un ordine del banco (ADR-072), o null: la casella, la fioreria
 * LIVE (ADR-016) e l'email del cliente. Si legge prima dell'audit, che ricorda se è partita.
 */
async function confirmationRecipientTx(
  tx: TransactionClient,
  ctx: TenantContext,
  order: { readonly customerId: string; readonly placedOnline: boolean },
  requested: boolean,
): Promise<{ readonly email: string; readonly name: string } | null> {
  if (!requested || ctx.mode !== 'LIVE') return null;
  const customer = await tx.customer.findFirst({
    where: { id: order.customerId, tenantId: ctx.tenantId },
    select: { email: true, displayName: true },
  });
  const email = counterConfirmationRecipient({
    requested,
    tenantMode: ctx.mode,
    placedOnline: order.placedOnline,
    customerEmail: customer?.email ?? null,
  });
  return email && customer ? { email, name: customer.displayName } : null;
}

/** L'email di conferma con il link per seguire l'ordine (quello attivo o uno nuovo). */
async function confirmationMailTx(
  tx: TransactionClient,
  ctx: TenantContext,
  order: { readonly id: string; readonly number: number },
  recipient: { readonly email: string; readonly name: string },
  mail: OrderMailDeps,
): Promise<EmailMessage> {
  const linkId = await ensureOrderPublicLinkTx(tx, ctx, order);
  return counterOrderConfirmationMail(
    tx,
    ctx.tenantId,
    order.id,
    { to: recipient.email, name: recipient.name, linkId },
    mail,
  );
}

// -----------------------------------------------------------------------------
// Scrittura
// -----------------------------------------------------------------------------

/**
 * "Convertir en pedido": un preventivo ACCETTATO diventa un ordine confermato. Con "Enviar la
 * confirmación" il cliente riceve l'email con il link per seguirlo (`mail`, facoltativo nei test).
 */
export async function createOrderFromQuote(
  ctx: TenantContext,
  quoteId: string,
  rawInput: unknown,
  mail: OrderMailDeps | null = null,
): Promise<{ id: string; number: number; customerNotified: boolean }> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(quoteId)) throw new NotFoundError('Quote');
  const input = parseFulfillment(ctx, rawInput);
  const requested = confirmationRequested(rawInput);

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const quote = await lockQuote(tx, ctx, quoteId);
    if (!quote) return null;
    const status = effectiveQuoteStatus(
      quote.status,
      dateToParts(quote.validUntil),
      todayInTimeZone(ctx.timezone),
    );
    if (status !== 'ACCEPTED') throw new ConflictError('quote_not_accepted');
    const existing = await tx.order.findFirst({
      where: { tenantId: ctx.tenantId, quoteId },
      select: { id: true },
    });
    if (existing) throw new ConflictError('quote_already_ordered');

    const fulfillment = await resolveFulfillment(tx, ctx, quote.customerId, input, rawInput, null);
    const totals = priceOrder({
      subtotalMinor: quote.subtotalMinor,
      discountMinor: quote.discountMinor,
      deliveryFeeMinor: fulfillment.deliveryFeeMinor,
    });
    if (!totals.ok) throw new ValidationError({ deliveryFee: totals.error });

    const lines = await tx.quoteLine.findMany({
      where: { tenantId: ctx.tenantId, quoteId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (lines.length === 0) throw new ConflictError('quote_empty');

    const number = await nextTenantCounter(tx, ctx.tenantId, 'order');
    const order = await tx.order.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        customerId: quote.customerId,
        quoteId: quote.id,
        status: 'CONFIRMED',
        currency: quote.currency,
        ...fulfillment.data,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        deliveryFeeMinor: totals.deliveryFeeMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        paidMinor: 0,
        paymentStatus: orderPaymentStatus(0, totals.totalMinor),
        // L'origine del preventivo (e quindi del cliente) passa all'ordine: base delle fee (D-24).
        acquisitionSource: quote.acquisitionSource,
        createdById: ctx.userId,
      },
    });
    await tx.orderLine.createMany({
      data: lines.map((line) => ({
        tenantId: ctx.tenantId,
        orderId: order.id,
        kind: line.kind,
        catalogItemId: line.catalogItemId,
        bouquetConfigurationId: line.bouquetConfigurationId,
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        unitCostMinor: line.unitCostMinor,
        lineTotalMinor: line.lineTotalMinor,
        snapshot: (line.snapshot ?? undefined) as Prisma.InputJsonValue | undefined,
        previewJobId: line.previewJobId,
        bouquetPhotoId: line.bouquetPhotoId,
        sortOrder: line.sortOrder,
      })),
    });
    await tx.orderStatusEvent.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        fromStatus: null,
        toStatus: 'CONFIRMED',
        createdById: ctx.userId,
      },
    });
    // I materiali dell'ordine si mettono da parte (ADR-072).
    await syncOrderReservationTx(tx, ctx, order.id);
    const recipient = mail
      ? await confirmationRecipientTx(
          tx,
          ctx,
          { customerId: quote.customerId, placedOnline: false },
          requested,
        )
      : null;
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderCreated,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(number),
        quoteNumber: formatQuoteNumber(quote.number),
        mode: input.fulfillmentMode,
        ...(recipient ? { customerNotified: true } : {}),
      },
    });
    const message =
      recipient && mail ? await confirmationMailTx(tx, ctx, order, recipient, mail) : null;
    return { id: order.id, number, message };
  });
  if (!result) return notFound(ctx, 'Quote', quoteId);
  if (mail && result.message) await sendOrderMails(mail.mailer, [result.message]);
  return { id: result.id, number: result.number, customerNotified: result.message !== null };
}

/** Campi della consegna che vede chi compra: se ne cambia uno, «Avvisa il cliente» ha senso. */
const BUYER_VISIBLE_FULFILLMENT_FIELDS = [
  'fulfillmentMode',
  'scheduledDate',
  'windowStartMinutes',
  'windowEndMinutes',
  'deliveryAddressLine1',
  'deliveryAddressLine2',
  'deliveryNeighborhood',
  'deliveryCity',
  'deliveryRegion',
  'deliveryPostalCode',
  'deliveryNotes',
  'recipientName',
  'recipientPhone',
  'cardMessage',
  'cardSignature',
  'cardAnonymous',
  'deliveryFeeMinor',
  'totalMinor',
] as const;

/**
 * Cambia consegna, destinatario, tarjeta e costo di consegna finché l'ordine non è uscito. Su un
 * ordine online già accettato, con «Avvisa il cliente per email» (`notifyCustomer`) e un cambio che
 * chi compra vede, parte una sola email «Tu pedido cambió» con il riepilogo nuovo (M3).
 */
export async function updateOrderFulfillment(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
  mail: OrderMailDeps | null = null,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const input = parseFulfillment(ctx, rawInput);
  const notifyCustomer =
    checkboxField().safeParse((rawInput as Record<string, unknown> | null)?.notifyCustomer).data ===
    true;

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return null;
    if (!isOrderEditable(order.status)) throw new ConflictError('order_not_editable');
    const fulfillment = await resolveFulfillment(
      tx,
      ctx,
      order.customerId,
      input,
      rawInput,
      order.scheduledDate,
      {
        placeId: order.deliveryPlaceId,
        latitude: order.deliveryLatitude,
        longitude: order.deliveryLongitude,
        coordinatesAt: order.deliveryCoordinatesAt,
      },
    );

    const totals = priceOrder({
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      deliveryFeeMinor: fulfillment.deliveryFeeMinor,
    });
    if (!totals.ok) throw new ValidationError({ deliveryFee: totals.error });
    assertTotalCoversPaid(order.paidMinor, totals.totalMinor);
    const changes = {
      ...fulfillment.data,
      // Un ritiro non ha repartidor (CHECK nel database).
      ...(input.fulfillmentMode === 'PICKUP' ? { assignedMembershipId: null } : {}),
      deliveryFeeMinor: totals.deliveryFeeMinor,
      totalMinor: totals.totalMinor,
      paymentStatus: orderPaymentStatus(order.paidMinor, totals.totalMinor),
    };
    await tx.order.update({ where: { id: order.id }, data: changes });
    // Nuovo giorno: l'apartado dei materiali lo segue (ADR-072), e il link per seguire l'ordine
    // vale fino a 30 giorni dopo la nuova consegna (M0).
    await syncOrderReservationTx(tx, ctx, order.id);
    await extendOrderPublicLinkTx(tx, ctx, order.id, changes.scheduledDate ?? null);
    const visibleChange =
      Object.keys(
        diffFields(order, changes, [...BUYER_VISIBLE_FULFILLMENT_FIELDS] as (keyof typeof order &
          keyof typeof changes)[]),
      ).length > 0;
    const notify = notifyCustomer && visibleChange && customerCanBeNotified(order);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderUpdated,
      entityType: 'Order',
      entityId: order.id,
      // Solo campi non personali: niente indirizzo, destinatario o testo della tarjeta.
      metadata: {
        number: formatOrderNumber(order.number),
        changes: diffFields(order, changes, [
          'fulfillmentMode',
          'scheduledDate',
          'windowStartMinutes',
          'windowEndMinutes',
          'deliveryFeeMinor',
          'totalMinor',
        ]),
        ...(notify ? { customerNotified: true } : {}),
      } as unknown as Prisma.InputJsonValue,
    });
    return {
      message:
        notify && mail ? await buyerOrderMail(tx, ctx.tenantId, order.id, 'changed', mail) : null,
    };
  });
  if (!found) return notFound(ctx, 'Order', orderId);
  if (mail && found.message) await sendOrderMails(mail.mailer, [found.message]);
}

/**
 * «Avvisa il cliente dei cambi» (M3): dopo aver cambiato prodotti o sconto di un ordine online
 * accettato (una riga alla volta), un'email sola a chi l'ha fatto con il riepilogo di adesso.
 */
export async function notifyOrderCustomer(
  ctx: TenantContext,
  orderId: string,
  mail: OrderMailDeps | null,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return null;
    if (!customerCanBeNotified(order)) throw new ConflictError('order_not_notifiable');
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderCustomerNotified,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number) },
    });
    return {
      message: mail ? await buyerOrderMail(tx, ctx.tenantId, order.id, 'changed', mail) : null,
    };
  });
  if (!found) return notFound(ctx, 'Order', orderId);
  if (mail && found.message) await sendOrderMails(mail.mailer, [found.message]);
}

/**
 * Un passo del banco. Quando l'ordine diventa "Listo" per la prima volta, i suoi materiali escono
 * dall'inventario (ADR-071) nella stessa transazione: se la merce non basta serve
 * `confirmShortage` (`order_inventory_shortage`), come per gli usi dell'inventario (ADR-060).
 */
export async function changeOrderStatus(
  ctx: TenantContext,
  orderId: string,
  rawStatus: unknown,
  options: { readonly confirmShortage?: boolean; readonly mail?: OrderMailDeps | null } = {},
): Promise<OrderStatus> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const target = ORDER_STATUSES.find((status) => status === rawStatus);
  if (!target || target === 'CANCELLED' || target === 'PENDING_ACCEPTANCE' || target === 'DRAFT') {
    throw new ValidationError({ status: 'invalid_option' });
  }

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return null;
    // L'ordine online si accetta con "Aceptar pedido", che avvisa chi compra.
    if (isOrderAcceptance(order.status, target)) throw new ConflictError('order_needs_acceptance');
    requirePermission(ctx, 'orders:fulfill');
    if (!canStepOrder(order.status, target, order.fulfillmentMode)) {
      throw new ConflictError('invalid_status_transition');
    }
    // Il ramo è fatto: i materiali escono dall'inventario, una volta sola per ordine.
    let inventoryEntryId: string | null = null;
    if (target === 'READY' && order.inventoryEntryId === null) {
      inventoryEntryId = await consumeOrderMaterials(
        tx,
        ctx,
        order,
        options.confirmShortage === true,
      );
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: target,
        statusChangedAt: new Date(),
        ...(inventoryEntryId ? { inventoryEntryId } : {}),
      },
    });
    await tx.orderStatusEvent.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus: target,
        createdById: ctx.userId,
      },
    });
    // L'apartado segue lo stato (ADR-072): un ordine confermato prima di questa versione lo prende
    // qui, uno tornato indietro da "Listo" senza scarico lo riprende.
    await syncOrderReservationTx(tx, ctx, order.id);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderStatusChanged,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number), from: order.status, to: target },
    });
    // M3: a chi ha fatto l'ordine online un'email per il passo, solo la prima volta che ci arriva.
    const step =
      order.placedOnline && order.buyerUserId
        ? orderStepNotice(target, order.fulfillmentMode)
        : null;
    const mail = options.mail ?? null;
    const message =
      step &&
      mail &&
      (await claimOnceNoticeTx(tx, { tenantId: ctx.tenantId, orderId: order.id, kind: step }))
        ? await buyerOrderMail(tx, ctx.tenantId, order.id, STEP_MAIL_KINDS[step], mail)
        : null;
    return { status: target, message };
  });
  if (!result) return notFound(ctx, 'Order', orderId);
  if (options.mail && result.message) await sendOrderMails(options.mail.mailer, [result.message]);
  return result.status;
}

/** L'email di ogni passo che avvisa chi compra (`orderStepNotice`). */
const STEP_MAIL_KINDS = {
  STEP_IN_PREPARATION: 'step_preparing',
  STEP_READY_PICKUP: 'step_ready_pickup',
  STEP_OUT_FOR_DELIVERY: 'step_on_the_way',
  STEP_DELIVERED: 'step_delivered',
} as const;

/**
 * Scarica i materiali dell'ordine (prodotti, ricette dei ramos, componenti dei disegni) con un registro
 * di uso che porta il numero dell'ordine. Con l'apartado dell'ordine (ADR-072) si usa quello: la sua
 * merce è dell'ordine e l'apartado si chiude; le quantità sono comunque quelle attuali dell'ordine.
 * Restituisce il registro, o null se niente si controlla.
 */
async function consumeOrderMaterials(
  tx: TransactionClient,
  ctx: TenantContext,
  order: { readonly id: string; readonly number: number },
  confirmShortage: boolean,
): Promise<string | null> {
  const lines = await orderStockRequest(tx, ctx.tenantId, order.id);
  const reservationId = await activeOrderReservationId(tx, ctx, order.id);
  if (lines.length === 0) {
    if (reservationId) await releaseReservationTx(tx, ctx, reservationId);
    return null;
  }
  try {
    const result = reservationId
      ? await consumeReservationTx(tx, ctx, reservationId, { lines, confirmShortage })
      : await consumeStockTx(tx, ctx, {
          lines,
          note: formatOrderNumber(order.number),
          confirmShortage,
        });
    return result.entryId;
  } catch (error) {
    if (error instanceof ConflictError && error.reason === 'inventory_insufficient_stock') {
      throw new ConflictError('order_inventory_shortage');
    }
    // Quantità fuori dai limiti dell'inventario (un ordine enorme): l'ordine va avanti lo stesso e
    // il materiale si registra a mano. Non deve mai bloccare il lavoro del banco. L'errore nasce
    // prima di scrivere: l'apartado, se c'era, si libera.
    if (error instanceof ValidationError) {
      logger.warn({ orderId: order.id }, "materiali dell'ordine non scaricati: fuori dai limiti");
      if (reservationId) await releaseReservationTx(tx, ctx, reservationId);
      return null;
    }
    throw error;
  }
}

/**
 * "Cancelar pedido" (o "Rechazar" per un ordine online ancora da accettare). Se l'ordine è stato
 * fatto online, chi compra riceve un'email con il motivo (`mail`, facoltativo nei test).
 */
export async function cancelOrder(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
  mail: OrderMailDeps | null = null,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  // «Rifiuta» di un ordine online (M3): un motivo pronto e un dettaglio; altrimenti il motivo scritto.
  const withCode = rawInput !== null && typeof rawInput === 'object' && 'reasonCode' in rawInput;
  let reason: string;
  let reasonCode: string | null = null;
  if (withCode) {
    const parsed = onlineOrderRejectSchema.safeParse(rawInput);
    if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
    reason = onlineRejectReasonText(parsed.data.reasonCode, parsed.data.detail);
    reasonCode = parsed.data.reasonCode;
  } else {
    const parsed = orderCancelSchema.safeParse(rawInput);
    if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
    reason = parsed.data.reason;
  }

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return null;
    if (!canCancelOrder(order.status)) throw new ConflictError('invalid_status_transition');
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', statusChangedAt: new Date(), cancelReason: reason },
    });
    // La merce messa da parte per l'ordine torna disponibile (ADR-072).
    await syncOrderReservationTx(tx, ctx, order.id);
    await tx.orderStatusEvent.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'CANCELLED',
        note: reason,
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderCancelled,
      entityType: 'Order',
      entityId: order.id,
      // Il tipo del motivo pronto (per i report di M8), mai il testo.
      metadata: {
        number: formatOrderNumber(order.number),
        from: order.status,
        ...(reasonCode ? { reasonCode } : {}),
      },
    });
    const kind = order.status === 'PENDING_ACCEPTANCE' ? 'rejected' : 'cancelled';
    return { message: mail ? await buyerOrderMail(tx, ctx.tenantId, order.id, kind, mail) : null };
  });
  if (!found) return notFound(ctx, 'Order', orderId);
  if (mail && found.message) await sendOrderMails(mail.mailer, [found.message]);
}

/**
 * "Aceptar pedido": un ordine della tienda en línea diventa confermato e chi compra riceve
 * un'email con il totale e come pagare. Il giorno non deve essere già passato (prima si cambia).
 */
export async function acceptOnlineOrder(
  ctx: TenantContext,
  orderId: string,
  mail: OrderMailDeps | null = null,
  rawInput: unknown = {},
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const freeDeliveryConfirmed =
    onlineOrderAcceptSchema.safeParse(rawInput ?? {}).data?.freeDeliveryConfirmed === true;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return null;
    if (order.status !== 'PENDING_ACCEPTANCE') throw new ConflictError('order_not_pending');
    const today = partsToDate(todayInTimeZone(ctx.timezone));
    if (!order.scheduledDate || order.scheduledDate < today) {
      throw new ConflictError('order_date_passed');
    }
    // A domicilio con la consegna a 0: si accetta solo confermando che è gratis (M0).
    const freeDelivery = onlineOrderNeedsFreeDeliveryConfirmation(order);
    if (freeDelivery && !freeDeliveryConfirmed) {
      throw new ConflictError('order_free_delivery_unconfirmed');
    }
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CONFIRMED', statusChangedAt: new Date() },
    });
    await syncOrderReservationTx(tx, ctx, order.id);
    await tx.orderStatusEvent.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'CONFIRMED',
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderAccepted,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number), freeDelivery },
    });
    return {
      message: mail ? await buyerOrderMail(tx, ctx.tenantId, order.id, 'accepted', mail) : null,
    };
  });
  if (!found) return notFound(ctx, 'Order', orderId);
  if (mail && found.message) await sendOrderMails(mail.mailer, [found.message]);
}

/**
 * Il totale non scende sotto quanto il cliente ha già pagato: la differenza da restituire non
 * resterebbe scritta da nessuna parte. Prima si storna il pagamento, poi si cambia l'ordine.
 */
function assertTotalCoversPaid(paidMinor: number, totalMinor: number): void {
  if (totalMinor < paidMinor) throw new ConflictError('order_total_below_paid');
}

async function applyPaidAmount(
  tx: TransactionClient,
  order: { id: string; totalMinor: number },
  paidMinor: number,
) {
  await tx.order.update({
    where: { id: order.id },
    data: { paidMinor, paymentStatus: orderPaymentStatus(paidMinor, order.totalMinor) },
  });
}

/** Acconto o saldo ricevuto dalla fioreria (contanti, trasferimento, terminale, link…). */
export async function recordOrderPayment(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:payments');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = orderPaymentSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  const paidOn = input.paidOn ?? today;
  if (partsToDate(paidOn) > partsToDate(today))
    throw new ValidationError({ paidOn: 'out_of_range' });

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return false;
    if (order.status === 'DRAFT') throw new ConflictError('order_not_confirmed');
    if (!acceptsOrderPayments(order.status)) throw new ConflictError('order_closed');
    if (input.amount > orderBalanceMinor(order.paidMinor, order.totalMinor)) {
      throw new ValidationError({ amount: 'payment_exceeds_balance' });
    }
    await tx.orderPayment.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        kind: input.kind,
        method: input.method,
        amountMinor: input.amount,
        paidOn: partsToDate(paidOn),
        reference: input.reference,
        createdById: ctx.userId,
      },
    });
    await applyPaidAmount(tx, order, order.paidMinor + input.amount);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderPaymentRecorded,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(order.number),
        kind: input.kind,
        method: input.method,
        amountMinor: input.amount,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}

/** Storna un pagamento registrato per errore: resta nello storico, con il suo storno. */
export async function reverseOrderPayment(
  ctx: TenantContext,
  orderId: string,
  paymentId: string,
): Promise<void> {
  requirePermission(ctx, 'orders:payments');
  if (!isUuid(orderId) || !isUuid(paymentId)) throw new NotFoundError('OrderPayment');

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return false;
    const payment = await tx.orderPayment.findFirst({
      where: { id: paymentId, tenantId: ctx.tenantId, orderId: order.id },
      include: { reversal: { select: { id: true } } },
    });
    if (!payment) return false;
    if (payment.kind === 'REVERSAL' || payment.reversal) {
      throw new ConflictError('payment_already_reversed');
    }
    await tx.orderPayment.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        kind: 'REVERSAL',
        method: payment.method,
        amountMinor: -payment.amountMinor,
        paidOn: partsToDate(todayInTimeZone(ctx.timezone)),
        reversedPaymentId: payment.id,
        createdById: ctx.userId,
      },
    });
    await applyPaidAmount(tx, order, order.paidMinor - payment.amountMinor);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderPaymentReversed,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number), amountMinor: payment.amountMinor },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'OrderPayment', paymentId);
}

/**
 * Immagine del ramo di una riga dell'ordine (la stessa della riga del preventivo, ADR-035): serve
 * a chi prepara il ramo. La vede chi vede l'ordine.
 */
export async function getOrderLineImage(
  ctx: TenantContext,
  orderId: string,
  lineId: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(orderId) || !isUuid(lineId)) throw new NotFoundError('Order');
  const line = await withTenantContext(getDb(), ctx, (tx) =>
    tx.orderLine.findFirst({
      where: { id: lineId, orderId, tenantId: ctx.tenantId },
      select: {
        previewJob: { select: { status: true, outputKey: true, outputContentType: true } },
        bouquetPhoto: { select: { storageKey: true, contentType: true } },
      },
    }),
  );
  if (!line) return notFound(ctx, 'Order', orderId);
  // La foto vera resta all'ordine anche se nel disegno viene sostituita o archiviata.
  if (line.bouquetPhoto) {
    return readStoredImage(line.bouquetPhoto.storageKey, line.bouquetPhoto.contentType, 'Order');
  }
  const job = line.previewJob;
  if (job?.status !== 'SUCCEEDED' || !job.outputKey) throw new NotFoundError('Order');
  return readStoredImage(job.outputKey, job.outputContentType ?? 'image/png', 'Order');
}

// -----------------------------------------------------------------------------
// Ordine diretto: borrador, righe e conferma (blocco A1b)
// -----------------------------------------------------------------------------

/**
 * Totali dalle righe, con lo sconto richiesto (ridotto al subtotale se le righe calano) e il costo
 * di consegna già fissato; lo stato del pagamento segue il nuovo totale.
 */
async function recalculateOrderTotals(
  tx: TransactionClient,
  ctx: TenantContext,
  order: { id: string; discountMinor: number; deliveryFeeMinor: number; paidMinor: number },
  discountMinor?: number,
): Promise<void> {
  const lines = await tx.orderLine.findMany({
    where: { tenantId: ctx.tenantId, orderId: order.id },
    select: { lineTotalMinor: true },
  });
  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const requested = discountMinor ?? order.discountMinor;
  const totals = priceOrder({
    subtotalMinor,
    discountMinor: Math.min(requested, subtotalMinor),
    deliveryFeeMinor: order.deliveryFeeMinor,
  });
  if (!totals.ok) throw new ValidationError({ discount: totals.error });
  assertTotalCoversPaid(order.paidMinor, totals.totalMinor);
  await tx.order.update({
    where: { id: order.id },
    data: {
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      paymentStatus: orderPaymentStatus(order.paidMinor, totals.totalMinor),
    },
  });
}

/** Blocca un ordine le cui righe si possono ancora cambiare. */
async function lockOrderForLines(tx: TransactionClient, ctx: TenantContext, orderId: string) {
  const order = await lockOrder(tx, ctx, orderId);
  if (!order) return null;
  if (!areOrderLinesEditable(order.status)) throw new ConflictError('order_lines_locked');
  return order;
}

/**
 * "Nuevo pedido": borrador per un cliente ATTIVO, eventualmente già con il ramo di un disegno del
 * Diseñador. Righe, consegna e tarjeta si completano nella scheda, poi si conferma.
 */
export async function createDraftOrder(
  ctx: TenantContext,
  input: { readonly customerId: unknown; readonly configurationId?: unknown },
): Promise<{ id: string; number: number }> {
  requirePermission(ctx, 'orders:write');
  const customerId = typeof input.customerId === 'string' ? input.customerId.trim() : '';
  if (!isUuid(customerId)) throw new ValidationError({ customerId: 'required' });
  const configurationId =
    typeof input.configurationId === 'string' ? input.configurationId.trim() : '';
  if (configurationId !== '') {
    requirePermission(ctx, 'builder:use');
    if (!isUuid(configurationId)) throw new NotFoundError('BouquetConfiguration');
  }

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    let draft: LineDraft | null = null;
    if (configurationId !== '') {
      await requireEntitlement(ctx, 'bouquetBuilder', tx);
      draft = await configurationLineDraft(tx, ctx, configurationId);
      if (!draft) return { missing: 'BouquetConfiguration' as const };
    }
    const customer = await tx.customer.findFirst({
      where: { id: customerId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true, acquisitionSource: true },
    });
    if (!customer) return { missing: 'Customer' as const };

    const number = await nextTenantCounter(tx, ctx.tenantId, 'order');
    const subtotalMinor = draft ? draft.unitPriceMinor : 0;
    const order = await tx.order.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        customerId: customer.id,
        status: 'DRAFT',
        currency: ctx.currency,
        // Il modo e la data si scelgono alla conferma; finché è borrador non c'è consegna.
        fulfillmentMode: 'PICKUP',
        scheduledDate: null,
        subtotalMinor,
        totalMinor: subtotalMinor,
        paymentStatus: orderPaymentStatus(0, subtotalMinor),
        acquisitionSource: customer.acquisitionSource,
        createdById: ctx.userId,
      },
    });
    if (draft) {
      await tx.orderLine.create({
        data: { tenantId: ctx.tenantId, orderId: order.id, ...lineRowData(draft, 1, 0) },
      });
    }
    await tx.orderStatusEvent.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        fromStatus: null,
        toStatus: 'DRAFT',
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderCreated,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(number),
        customerId: customer.id,
        ...(draft ? { configurationId: draft.bouquetConfigurationId } : {}),
      },
    });
    return { order: { id: order.id, number } };
  });
  if ('missing' in result) {
    return result.missing === 'Customer'
      ? notFound(ctx, 'Customer', customerId)
      : notFound(ctx, 'BouquetConfiguration', configurationId);
  }
  return result.order;
}

async function insertOrderLine(
  tx: TransactionClient,
  ctx: TenantContext,
  order: {
    id: string;
    number: number;
    discountMinor: number;
    deliveryFeeMinor: number;
    paidMinor: number;
  },
  draft: LineDraft,
  quantity: number,
): Promise<void> {
  const existing =
    draft.kind === 'CATALOG_ITEM'
      ? await tx.orderLine.findFirst({
          where: {
            tenantId: ctx.tenantId,
            orderId: order.id,
            kind: 'CATALOG_ITEM',
            catalogItemId: draft.catalogItemId,
          },
        })
      : null;
  if (existing) {
    // Stesso articolo: si somma la quantità mantenendo lo snapshot originale del prezzo.
    const total = existing.quantity + quantity;
    if (total > ORDER_LIMITS.quantityMax) throw new ValidationError({ quantity: 'out_of_range' });
    await tx.orderLine.update({
      where: { id: existing.id },
      data: { quantity: total, lineTotalMinor: total * existing.unitPriceMinor },
    });
  } else {
    const count = await tx.orderLine.count({
      where: { tenantId: ctx.tenantId, orderId: order.id },
    });
    if (count >= ORDER_LIMITS.lines) throw new ConflictError('order_line_limit');
    await tx.orderLine.create({
      data: { tenantId: ctx.tenantId, orderId: order.id, ...lineRowData(draft, quantity, count) },
    });
  }
  await recalculateOrderTotals(tx, ctx, order);
  await syncOrderReservationTx(tx, ctx, order.id);
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.orderLineAdded,
    entityType: 'Order',
    entityId: order.id,
    metadata: { number: formatOrderNumber(order.number), itemName: draft.itemName, quantity },
  });
}

/** Articolo del catalogo: prezzo, costo e distinta SEMPRE dal catalogo del tenant. */
export async function addCatalogItemToOrder(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = catalogQuoteLineSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrderForLines(tx, ctx, orderId);
    if (!order) return false;
    await insertOrderLine(
      tx,
      ctx,
      order,
      await catalogLineDraft(tx, ctx, input.catalogItemId),
      input.quantity,
    );
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}

/** Riga libera con il prezzo del fiorista. */
export async function addCustomLineToOrder(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = customQuoteLineSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrderForLines(tx, ctx, orderId);
    if (!order) return false;
    await insertOrderLine(tx, ctx, order, customLineDraft(input), input.quantity);
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}

export async function updateOrderLineQuantity(
  ctx: TenantContext,
  orderId: string,
  lineId: string,
  rawQuantity: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId) || !isUuid(lineId)) throw new NotFoundError('Order');
  const parsed = quoteLineQuantitySchema.safeParse(rawQuantity);
  if (!parsed.success) {
    throw new ValidationError({ quantity: parsed.error.issues[0]?.message ?? 'invalid' });
  }
  const quantity = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrderForLines(tx, ctx, orderId);
    if (!order) return false;
    const line = await tx.orderLine.findFirst({
      where: { id: lineId, tenantId: ctx.tenantId, orderId },
    });
    if (!line) return false;
    if (line.quantity === quantity) return true;
    await tx.orderLine.update({
      where: { id: line.id },
      data: { quantity, lineTotalMinor: quantity * line.unitPriceMinor },
    });
    await recalculateOrderTotals(tx, ctx, order);
    await syncOrderReservationTx(tx, ctx, order.id);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderLineUpdated,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number), from: line.quantity, to: quantity },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}

/** Toglie una riga; un ordine confermato non resta mai vuoto. */
export async function removeOrderLine(
  ctx: TenantContext,
  orderId: string,
  lineId: string,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId) || !isUuid(lineId)) throw new NotFoundError('Order');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrderForLines(tx, ctx, orderId);
    if (!order) return false;
    const line = await tx.orderLine.findFirst({
      where: { id: lineId, tenantId: ctx.tenantId, orderId },
    });
    if (!line) return false;
    if (order.status !== 'DRAFT') {
      const count = await tx.orderLine.count({ where: { tenantId: ctx.tenantId, orderId } });
      if (count <= 1) throw new ConflictError('order_empty');
    }
    await tx.orderLine.delete({ where: { id: line.id } });
    await recalculateOrderTotals(tx, ctx, order);
    await syncOrderReservationTx(tx, ctx, order.id);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderLineRemoved,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number), itemName: line.description },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}

export async function updateOrderDiscount(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = orderDiscountSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { discount } = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrderForLines(tx, ctx, orderId);
    if (!order) return false;
    if (discount > order.subtotalMinor) {
      throw new ValidationError({ discount: 'discount_exceeds_subtotal' });
    }
    if (discount === order.discountMinor) return true;
    await recalculateOrderTotals(tx, ctx, order, discount);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderDiscountChanged,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(order.number),
        changes: { discountMinor: { from: order.discountMinor, to: discount } },
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}

/**
 * Il borrador diventa un ordine confermato con i dati di consegna e la tarjeta. Con "Enviar la
 * confirmación" il cliente riceve l'email con il link per seguirlo (`mail`, facoltativo nei test).
 */
export async function confirmDraftOrder(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
  mail: OrderMailDeps | null = null,
): Promise<{ customerNotified: boolean }> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const input = parseFulfillment(ctx, rawInput);
  const requested = confirmationRequested(rawInput);
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return null;
    if (order.status !== 'DRAFT') throw new ConflictError('invalid_status_transition');
    const lines = await tx.orderLine.count({ where: { tenantId: ctx.tenantId, orderId } });
    if (lines === 0) throw new ConflictError('order_empty');
    const fulfillment = await resolveFulfillment(tx, ctx, order.customerId, input, rawInput, null);
    const totals = priceOrder({
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      deliveryFeeMinor: fulfillment.deliveryFeeMinor,
    });
    if (!totals.ok) throw new ValidationError({ deliveryFee: totals.error });
    await tx.order.update({
      where: { id: order.id },
      data: {
        ...fulfillment.data,
        status: 'CONFIRMED',
        statusChangedAt: new Date(),
        deliveryFeeMinor: totals.deliveryFeeMinor,
        totalMinor: totals.totalMinor,
        paymentStatus: orderPaymentStatus(order.paidMinor, totals.totalMinor),
      },
    });
    await tx.orderStatusEvent.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        fromStatus: 'DRAFT',
        toStatus: 'CONFIRMED',
        createdById: ctx.userId,
      },
    });
    await syncOrderReservationTx(tx, ctx, order.id);
    const recipient = mail ? await confirmationRecipientTx(tx, ctx, order, requested) : null;
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderConfirmed,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(order.number),
        mode: input.fulfillmentMode,
        ...(recipient ? { customerNotified: true } : {}),
      },
    });
    const message =
      recipient && mail ? await confirmationMailTx(tx, ctx, order, recipient, mail) : null;
    return { message };
  });
  if (!found) return notFound(ctx, 'Order', orderId);
  if (mail && found.message) await sendOrderMails(mail.mailer, [found.message]);
  return { customerNotified: found.message !== null };
}

/**
 * Scarta un borrador che non serve più: non diventa mai un ordine (resta nella cronologia e
 * nell'audit, nessuna cancellazione fisica) e sparisce dagli elenchi. Non chiede un motivo.
 */
export async function discardDraftOrder(ctx: TenantContext, orderId: string): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return false;
    if (order.status !== 'DRAFT') throw new ConflictError('invalid_status_transition');
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', statusChangedAt: new Date() },
    });
    await tx.orderStatusEvent.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        fromStatus: 'DRAFT',
        toStatus: 'CANCELLED',
        createdById: ctx.userId,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderDiscarded,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number) },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}
