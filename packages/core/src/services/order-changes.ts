/**
 * Marketplace M3-2 «Cambi da confermare» (ADR-088) — il lato della fioreria.
 *
 *  - Il primo cambio di un ordine online da accettare salva l'ordine com'era
 *    (`capturePendingOrderTx`, prima di scrivere); dopo ogni cambio una richiesta già fatta si
 *    ritira da sola se l'ordine non è più quello chiesto (`settlePendingOrderEditTx`), così chi
 *    compra non conferma mai una versione vecchia.
 *  - «Chiedi conferma al cliente» (`askOrderChange`) e «Proponi un'altra data»
 *    (`proposeOrderDate`): la richiesta parte con la fotografia di adesso e un numero (`round`).
 *  - Lo stato dei cambi per la pagina dell'ordine (`orderChangeDtoTx`).
 *
 * La conferma e il «No, gracias» di chi compra stanno in `buyer-order-changes.ts`, dall'ingresso
 * unico `withBuyerOrder`. Prima e dopo si calcolano solo qui, dal database.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  ORDER_CHANGE_STATUSES,
  ORDER_LIMITS,
  askOrderChangeSchema,
  compareDates,
  diffFields,
  diffOrderChanges,
  formatOrderNumber,
  hasOrderChanges,
  isUuid,
  onlineOrderNeedsFreeDeliveryConfirmation,
  orderChangeFields,
  orderChangeSnapshot,
  parseOrderChangeSnapshot,
  proposeOrderDateSchema,
  todayInTimeZone,
  toFieldErrors,
  type AskOrderChangeInput,
  type OrderChangeDiff,
  type OrderChangeSnapshot,
  type OrderChangeStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import type { EmailMessage } from '../mailer';
import { changeAskedMailTx, sendOrderMails, type OrderMailDeps } from '../order-mail';
import { assertCanHandlePendingOnlineTx } from './order-payment-internals';
import { extendOrderPublicLinkTx } from './public-links';
import { addDays, dateToParts, partsToDate } from './quote-internals';

/** I campi dell'ordine che entrano nella fotografia. */
export const orderSnapshotSelect = {
  id: true,
  fulfillmentMode: true,
  scheduledDate: true,
  windowStartMinutes: true,
  windowEndMinutes: true,
  deliveryAddressLine1: true,
  deliveryAddressLine2: true,
  deliveryNeighborhood: true,
  deliveryCity: true,
  deliveryRegion: true,
  deliveryPostalCode: true,
  subtotalMinor: true,
  discountMinor: true,
  deliveryFeeMinor: true,
  totalMinor: true,
} as const;

type SnapshotOrder = Prisma.OrderGetPayload<{ select: typeof orderSnapshotSelect }>;

/** La fotografia dell'ordine com'è adesso (nella transazione che l'ha bloccato). */
export async function orderSnapshotTx(
  tx: TransactionClient,
  tenantId: string,
  order: SnapshotOrder,
): Promise<OrderChangeSnapshot> {
  const lines = await tx.orderLine.findMany({
    where: { tenantId, orderId: order.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      catalogItemId: true,
      description: true,
      quantity: true,
      unitPriceMinor: true,
      lineTotalMinor: true,
    },
  });
  return orderChangeSnapshot({
    fulfillmentMode: order.fulfillmentMode,
    scheduledDate: order.scheduledDate ? dateToParts(order.scheduledDate) : null,
    windowStartMinutes: order.windowStartMinutes,
    windowEndMinutes: order.windowEndMinutes,
    address: order.deliveryAddressLine1
      ? {
          line1: order.deliveryAddressLine1,
          line2: order.deliveryAddressLine2,
          neighborhood: order.deliveryNeighborhood,
          city: order.deliveryCity,
          region: order.deliveryRegion,
          postalCode: order.deliveryPostalCode,
        }
      : null,
    lines,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    totalMinor: order.totalMinor,
  });
}

/** La richiesta di un ordine, con le fotografie già rilette (null se non valide). */
export interface OrderChangeRow {
  readonly id: string;
  readonly status: OrderChangeStatus;
  readonly before: OrderChangeSnapshot | null;
  readonly after: OrderChangeSnapshot | null;
  readonly round: number;
  readonly message: string | null;
  readonly askedAt: Date | null;
  readonly answeredAt: Date | null;
  readonly declineReason: string | null;
}

function asStatus(value: string): OrderChangeStatus {
  return (ORDER_CHANGE_STATUSES as readonly string[]).includes(value)
    ? (value as OrderChangeStatus)
    : 'EDITING';
}

export async function orderChangeRowTx(
  tx: TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<OrderChangeRow | null> {
  const row = await tx.orderChangeRequest.findUnique({
    where: { tenantId_orderId: { tenantId, orderId } },
  });
  if (!row) return null;
  return {
    id: row.id,
    status: asStatus(row.status),
    before: parseOrderChangeSnapshot(row.before),
    after: row.after === null ? null : parseOrderChangeSnapshot(row.after),
    round: row.round,
    message: row.message,
    askedAt: row.askedAt,
    answeredAt: row.answeredAt,
    declineReason: row.declineReason,
  };
}

/**
 * Prima di cambiare un ordine online ancora da accettare: salva com'era, una volta sola (il primo
 * cambio). Per gli altri ordini non fa niente. Da chiamare sotto il lock dell'ordine.
 */
export async function capturePendingOrderTx(
  tx: TransactionClient,
  ctx: TenantContext,
  order: SnapshotOrder & { readonly status: string; readonly placedOnline: boolean },
): Promise<void> {
  if (order.status !== 'PENDING_ACCEPTANCE' || !order.placedOnline) return;
  const existing = await tx.orderChangeRequest.findUnique({
    where: { tenantId_orderId: { tenantId: ctx.tenantId, orderId: order.id } },
    select: { id: true },
  });
  if (existing) return;
  const before = await orderSnapshotTx(tx, ctx.tenantId, order);
  await tx.orderChangeRequest.create({
    data: {
      tenantId: ctx.tenantId,
      orderId: order.id,
      before: before as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Dopo un cambio: una richiesta già fatta si ritira da sola (torna «in modifica») se l'ordine non è
 * più quello chiesto. Un cambio che non tocca quello che chi compra vede (biglietto, note) la
 * lascia com'è. Restituisce true se l'ha ritirata.
 */
export async function settlePendingOrderEditTx(
  tx: TransactionClient,
  ctx: TenantContext,
  orderId: string,
): Promise<boolean> {
  const row = await orderChangeRowTx(tx, ctx.tenantId, orderId);
  if (!row || row.status !== 'ASKED') return false;
  const order = await tx.order.findFirstOrThrow({
    where: { tenantId: ctx.tenantId, id: orderId },
    select: orderSnapshotSelect,
  });
  const now = await orderSnapshotTx(tx, ctx.tenantId, order);
  if (row.after && !hasOrderChanges(diffOrderChanges(row.after, now))) return false;
  await tx.orderChangeRequest.update({ where: { id: row.id }, data: { status: 'EDITING' } });
  return true;
}

/** Lo stato dei cambi di un ordine online da accettare, per la sua pagina nella fioreria. */
export interface OrderChangeDto {
  readonly status: OrderChangeStatus;
  /** Cosa è cambiato rispetto a com'era, adesso; null se la fotografia di prima non si legge. */
  readonly diff: OrderChangeDiff | null;
  /** C'è qualcosa da far confermare: al posto di «Accetta l'ordine», «Chiedi conferma». */
  readonly hasChanges: boolean;
  readonly round: number;
  readonly askedAt: Date | null;
  readonly answeredAt: Date | null;
  readonly message: string | null;
  /** Il motivo dell'ultimo «No, gracias», se chi compra l'ha scritto. */
  readonly declineReason: string | null;
  /** La richiesta c'era, ma un cambio dopo l'ha ritirata: va chiesta di nuovo. */
  readonly withdrawn: boolean;
}

export async function orderChangeDtoTx(
  tx: TransactionClient,
  tenantId: string,
  order: SnapshotOrder,
): Promise<OrderChangeDto | null> {
  const row = await orderChangeRowTx(tx, tenantId, order.id);
  if (!row) return null;
  const diff = row.before
    ? diffOrderChanges(row.before, await orderSnapshotTx(tx, tenantId, order))
    : null;
  return {
    status: row.status,
    diff,
    hasChanges: diff !== null && hasOrderChanges(diff),
    round: row.round,
    askedAt: row.askedAt,
    answeredAt: row.answeredAt,
    message: row.message,
    declineReason: row.declineReason,
    withdrawn: row.status === 'EDITING' && row.askedAt !== null,
  };
}

/**
 * Con dei cambi da far confermare «Accetta l'ordine» non vale (`order_change_needs_confirmation`),
 * e nemmeno mentre si aspetta la risposta (`order_change_waiting`). Se chi compra ha eliminato il
 * conto non può rispondere: allora si accetta come prima.
 */
export async function assertAcceptableWithoutChangesTx(
  tx: TransactionClient,
  tenantId: string,
  order: SnapshotOrder & { readonly buyerUserId: string | null },
): Promise<void> {
  if (!order.buyerUserId) return;
  const row = await orderChangeRowTx(tx, tenantId, order.id);
  if (!row) return;
  if (row.status === 'ASKED') throw new ConflictError('order_change_waiting');
  if (!row.before) return;
  const now = await orderSnapshotTx(tx, tenantId, order);
  if (hasOrderChanges(diffOrderChanges(row.before, now))) {
    throw new ConflictError('order_change_needs_confirmation');
  }
}

// -----------------------------------------------------------------------------
// «Chiedi conferma al cliente» e «Proponi un'altra data»
// -----------------------------------------------------------------------------

async function lockPendingOrderTx(tx: TransactionClient, ctx: TenantContext, orderId: string) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  return tx.order.findFirst({ where: { id: orderId, tenantId: ctx.tenantId } });
}

type LockedOrder = NonNullable<Awaited<ReturnType<typeof lockPendingOrderTx>>>;

/** Solo un ordine online da accettare, di un conto che c'è ancora, col giorno non passato. */
function assertCanAsk(ctx: TenantContext, order: LockedOrder): void {
  if (order.status !== 'PENDING_ACCEPTANCE' || !order.placedOnline) {
    throw new ConflictError('order_not_pending');
  }
  if (!order.buyerUserId) throw new ConflictError('order_change_no_buyer');
  const today = partsToDate(todayInTimeZone(ctx.timezone));
  if (!order.scheduledDate || order.scheduledDate < today) {
    throw new ConflictError('order_date_passed');
  }
}

/** Fa partire la richiesta (nella transazione che ha bloccato l'ordine); l'email dopo il commit. */
async function askTx(
  tx: TransactionClient,
  ctx: TenantContext,
  order: LockedOrder,
  input: AskOrderChangeInput,
  mail: OrderMailDeps | null,
): Promise<EmailMessage | null> {
  assertCanAsk(ctx, order);
  const row = await orderChangeRowTx(tx, ctx.tenantId, order.id);
  if (!row?.before) throw new ConflictError('order_change_nothing');
  if (row.status === 'ASKED') throw new ConflictError('order_change_waiting');
  const now = await orderSnapshotTx(tx, ctx.tenantId, order);
  const diff = diffOrderChanges(row.before, now);
  if (!hasOrderChanges(diff)) throw new ConflictError('order_change_nothing');
  // A domicilio con la consegna a 0: si chiede solo confermando che è gratis, come «Accetta» (M0).
  const freeDelivery = onlineOrderNeedsFreeDeliveryConfirmation(order);
  if (freeDelivery && !input.freeDeliveryConfirmed) {
    throw new ConflictError('order_free_delivery_unconfirmed');
  }
  const round = row.round + 1;
  await tx.orderChangeRequest.update({
    where: { id: row.id },
    data: {
      status: 'ASKED',
      after: now as unknown as Prisma.InputJsonValue,
      round,
      message: input.message,
      askedAt: new Date(),
      // Il motivo di un «No, gracias» di prima vale per la richiesta di prima.
      declineReason: null,
    },
  });
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.orderChangeAsked,
    entityType: 'Order',
    entityId: order.id,
    // Quali parti, mai i valori né il messaggio.
    metadata: {
      number: formatOrderNumber(order.number),
      round,
      fields: orderChangeFields(diff),
      ...(freeDelivery ? { freeDelivery: true } : {}),
    },
  });
  return mail ? changeAskedMailTx(tx, ctx.tenantId, order.id, diff, mail) : null;
}

/**
 * «Chiedi conferma al cliente»: chi compra riceve la lista dei cambi (nella pagina dell'ordine e per
 * email) e conferma o dice «No, gracias». Proprietario e gerente; lo staff se la fioreria lo
 * permette (M3-3, `assertCanHandlePendingOnlineTx`).
 */
export async function askOrderChange(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
  mail: OrderMailDeps | null = null,
): Promise<void> {
  requirePermission(ctx, 'orders:accept');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = askOrderChangeSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockPendingOrderTx(tx, ctx, orderId);
    if (!order) return null;
    await assertCanHandlePendingOnlineTx(tx, ctx);
    return { message: await askTx(tx, ctx, order, parsed.data, mail) };
  });
  if (!found) return notFound(ctx, 'Order', orderId);
  if (mail && found.message) await sendOrderMails(mail.mailer, [found.message]);
}

/**
 * «Proponi un'altra data» invece di rifiutare: cambia solo giorno e fascia e chiede la conferma, in
 * un passo solo. Una richiesta già fatta si ritira e riparte con la data nuova.
 */
export async function proposeOrderDate(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
  mail: OrderMailDeps | null = null,
): Promise<void> {
  requirePermission(ctx, 'orders:accept');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = proposeOrderDateSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  // Da oggi al massimo del modulo della consegna (`resolveFulfillment`).
  const today = todayInTimeZone(ctx.timezone);
  if (
    compareDates(input.scheduledDate, today) < 0 ||
    compareDates(input.scheduledDate, addDays(today, ORDER_LIMITS.scheduleDaysMax)) > 0
  ) {
    throw new ValidationError({ scheduledDate: 'out_of_range' });
  }
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockPendingOrderTx(tx, ctx, orderId);
    if (!order) return null;
    await assertCanHandlePendingOnlineTx(tx, ctx);
    if (order.status !== 'PENDING_ACCEPTANCE' || !order.placedOnline) {
      throw new ConflictError('order_not_pending');
    }
    if (!order.buyerUserId) throw new ConflictError('order_change_no_buyer');
    await capturePendingOrderTx(tx, ctx, order);
    const changes = {
      scheduledDate: partsToDate(input.scheduledDate),
      windowStartMinutes: input.windowStart,
      windowEndMinutes: input.windowEnd,
    };
    await tx.order.update({ where: { id: order.id }, data: changes });
    // Il link per seguire l'ordine vale fino a 30 giorni dopo la consegna nuova (M0).
    await extendOrderPublicLinkTx(tx, ctx, order.id, changes.scheduledDate);
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderUpdated,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(order.number),
        changes: diffFields(order, changes, [
          'scheduledDate',
          'windowStartMinutes',
          'windowEndMinutes',
        ]),
      } as unknown as Prisma.InputJsonValue,
    });
    await settlePendingOrderEditTx(tx, ctx, order.id);
    const updated = await tx.order.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, id: order.id },
    });
    return {
      message: await askTx(
        tx,
        ctx,
        updated,
        { message: input.message, freeDeliveryConfirmed: input.freeDeliveryConfirmed },
        mail,
      ),
    };
  });
  if (!found) return notFound(ctx, 'Order', orderId);
  if (mail && found.message) await sendOrderMails(mail.mailer, [found.message]);
}
