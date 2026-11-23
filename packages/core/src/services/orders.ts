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
  ORDER_LIMITS,
  ORDER_PAGE_SIZE,
  ORDER_STATUSES,
  canCancelOrder,
  canStepOrder,
  deliveryAddressSchema,
  diffFields,
  effectiveQuoteStatus,
  formatOrderNumber,
  formatQuoteNumber,
  formatTimeOfDay,
  isOrderAcceptance,
  isOrderEditable,
  isUuid,
  orderBalanceMinor,
  orderCancelSchema,
  orderFulfillmentSchema,
  orderListFiltersSchema,
  orderPaymentSchema,
  orderPaymentStatus,
  orderStepsFrom,
  priceOrder,
  toFieldErrors,
  todayInTimeZone,
  type AcquisitionSource,
  type FulfillmentMode,
  type OrderFulfillmentInput,
  type OrderPaymentKind,
  type OrderPaymentStatus,
  type OrderStatus,
  type OrderWhenFilter,
  type PaymentMethod,
  type SaleUnit,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { readStoredImage } from '../media/stored-files';
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
  /** "AAAA-MM-GG" nel calendario del tenant. */
  readonly scheduledDate: string;
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
}

export interface OrderRecipeLineSnapshot {
  readonly name: string;
  readonly variety: string | null;
  readonly quantity: number;
  readonly saleUnit: SaleUnit;
  readonly color?: string | null;
}

export interface OrderLineDto {
  readonly id: string;
  readonly kind: 'CATALOG_ITEM' | 'CUSTOM' | 'BUILDER';
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly saleUnit: SaleUnit | null;
  readonly recipe: readonly OrderRecipeLineSnapshot[] | null;
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
}

export interface OrderDetailDto extends OrderSummaryDto {
  readonly quote: { readonly id: string; readonly numberLabel: string } | null;
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
  readonly cancelReason: string | null;
  readonly statusChangedAt: Date;
  readonly lines: readonly OrderLineDto[];
  readonly payments: readonly OrderPaymentDto[];
  readonly events: readonly OrderEventDto[];
  /** Passi che chi guarda può fare adesso (il servizio li riverifica). */
  readonly nextSteps: readonly OrderStatus[];
  readonly editable: boolean;
  readonly canCancel: boolean;
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

function toSummary(order: OrderWithCustomer): OrderSummaryDto {
  return {
    id: order.id,
    number: order.number,
    numberLabel: formatOrderNumber(order.number),
    status: order.status,
    fulfillmentMode: order.fulfillmentMode,
    scheduledDate: dateString(order.scheduledDate),
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
  };
}

interface LineSnapshot {
  readonly item?: { readonly saleUnit: SaleUnit };
  readonly recipe?: readonly OrderRecipeLineSnapshot[];
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
      return {};
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
  // Dal passato si guarda all'indietro; altrimenti i più vicini prima, per fascia.
  const backwards = filters.when === 'past' || filters.when === 'all';
  const orderBy: Prisma.OrderOrderByWithRelationInput[] = backwards
    ? [{ scheduledDate: 'desc' }, { number: 'desc' }]
    : [
        { scheduledDate: 'asc' },
        { windowStartMinutes: { sort: 'asc', nulls: 'last' } },
        { number: 'asc' },
      ];
  return withTenantContext(getDb(), ctx, async (tx) => {
    const total = await tx.order.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / ORDER_PAGE_SIZE));
    const page = Math.min(filters.page, pageCount);
    const orders = await tx.order.findMany({
      where,
      include: orderInclude,
      orderBy,
      skip: (page - 1) * ORDER_PAGE_SIZE,
      take: ORDER_PAGE_SIZE,
    });
    return {
      items: orders.map(toSummary),
      total,
      page,
      pageCount,
      when: filters.when,
      canWrite: hasPermission(ctx, 'orders:write'),
    };
  });
}

/** Passi che il ruolo di chi guarda può fare (accettare vuole `orders:write`, il resto `orders:fulfill`). */
function stepsFor(ctx: TenantContext, status: OrderStatus, mode: FulfillmentMode): OrderStatus[] {
  return orderStepsFrom(status, mode).filter((to) =>
    hasPermission(ctx, isOrderAcceptance(status, to) ? 'orders:write' : 'orders:fulfill'),
  );
}

export async function getOrder(ctx: TenantContext, orderId: string): Promise<OrderDetailDto> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId },
      include: { ...orderInclude, quote: { select: { id: true, number: true } } },
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
    return { order, lines, payments, events };
  });
  if (!result) return notFound(ctx, 'Order', orderId);
  const { order, lines, payments, events } = result;
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
        }
      : null;
  return {
    ...toSummary(order),
    quote: order.quote
      ? { id: order.quote.id, numberLabel: formatQuoteNumber(order.quote.number) }
      : null,
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
    cancelReason: order.cancelReason,
    statusChangedAt: order.statusChangedAt,
    lines: lines.map((line) => {
      const snapshot = readSnapshot(line.snapshot);
      return {
        id: line.id,
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineTotalMinor: line.lineTotalMinor,
        saleUnit: snapshot?.item?.saleUnit ?? null,
        recipe: snapshot?.recipe ?? null,
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
    nextSteps: stepsFor(ctx, order.status, order.fulfillmentMode),
    editable: canWrite && isOrderEditable(order.status),
    canCancel: canWrite && canCancelOrder(order.status),
    canRecordPayments: hasPermission(ctx, 'orders:payments') && order.status !== 'CANCELLED',
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

  let address: Omit<OrderDeliveryAddressDto, 'countryCode'> | null = null;
  let customerAddressId: string | null = null;
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
      // Dalla rubrica si prendono destinatario e referencias, se il form non li indica.
      recipientName ??= saved.recipientName;
      recipientPhone ??= saved.recipientPhone;
      deliveryNotes ??= saved.deliveryNotes;
    } else {
      const parsed = deliveryAddressSchema(ctx.country).safeParse(rawInput);
      if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
      address = parsed.data;
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

// -----------------------------------------------------------------------------
// Scrittura
// -----------------------------------------------------------------------------

/** "Convertir en pedido": un preventivo ACCETTATO diventa un ordine confermato. */
export async function createOrderFromQuote(
  ctx: TenantContext,
  quoteId: string,
  rawInput: unknown,
): Promise<{ id: string; number: number }> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(quoteId)) throw new NotFoundError('Quote');
  const input = parseFulfillment(ctx, rawInput);

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
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderCreated,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(number),
        quoteNumber: formatQuoteNumber(quote.number),
        mode: input.fulfillmentMode,
      },
    });
    return { id: order.id, number };
  });
  if (!result) return notFound(ctx, 'Quote', quoteId);
  return result;
}

/** Cambia consegna, destinatario, tarjeta e costo di consegna finché l'ordine non è uscito. */
export async function updateOrderFulfillment(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const input = parseFulfillment(ctx, rawInput);

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return false;
    if (!isOrderEditable(order.status)) throw new ConflictError('order_not_editable');
    const fulfillment = await resolveFulfillment(
      tx,
      ctx,
      order.customerId,
      input,
      rawInput,
      order.scheduledDate,
    );
    const totals = priceOrder({
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      deliveryFeeMinor: fulfillment.deliveryFeeMinor,
    });
    if (!totals.ok) throw new ValidationError({ deliveryFee: totals.error });
    const changes = {
      ...fulfillment.data,
      deliveryFeeMinor: totals.deliveryFeeMinor,
      totalMinor: totals.totalMinor,
      paymentStatus: orderPaymentStatus(order.paidMinor, totals.totalMinor),
    };
    await tx.order.update({ where: { id: order.id }, data: changes });
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
      } as unknown as Prisma.InputJsonValue,
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
}

export async function changeOrderStatus(
  ctx: TenantContext,
  orderId: string,
  rawStatus: unknown,
): Promise<OrderStatus> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const target = ORDER_STATUSES.find((status) => status === rawStatus);
  if (!target || target === 'CANCELLED' || target === 'PENDING_ACCEPTANCE') {
    throw new ValidationError({ status: 'invalid_option' });
  }

  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return null;
    requirePermission(
      ctx,
      isOrderAcceptance(order.status, target) ? 'orders:write' : 'orders:fulfill',
    );
    if (!canStepOrder(order.status, target, order.fulfillmentMode)) {
      throw new ConflictError('invalid_status_transition');
    }
    await tx.order.update({
      where: { id: order.id },
      data: { status: target, statusChangedAt: new Date() },
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
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderStatusChanged,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number), from: order.status, to: target },
    });
    return target;
  });
  if (!result) return notFound(ctx, 'Order', orderId);
  return result;
}

export async function cancelOrder(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:write');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = orderCancelSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { reason } = parsed.data;

  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    if (!order) return false;
    if (!canCancelOrder(order.status)) throw new ConflictError('invalid_status_transition');
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', statusChangedAt: new Date(), cancelReason: reason },
    });
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
      metadata: { number: formatOrderNumber(order.number), from: order.status },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'Order', orderId);
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
    if (order.status === 'CANCELLED') throw new ConflictError('order_closed');
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
