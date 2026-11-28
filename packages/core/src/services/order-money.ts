/**
 * Marketplace M3-3 «Soldi e squadra» (ADR-088), il lato della fioreria:
 *
 *  - le prove di pagamento che carica chi ha fatto l'ordine online («Ya pagué»): «Confermo» le
 *    trasforma in un pagamento, «Non lo trovo» le rifiuta con un motivo che chi compra legge. Le
 *    vedono solo proprietario e gerente (`orders:payments`): la foto contiene dati bancari;
 *  - i contanti che segna chi consegna («Ho incassato», `orders:fulfill`), che proprietario o
 *    gerente confermano (un pagamento in Contanti, fino a quanto segnato) o rifiutano con un motivo.
 *    È lo stesso giro di «Cobré en la visita» di Floral Care (ADR-082).
 *
 * Ogni decisione blocca prima l'ordine, poi scrive il pagamento e chiude la prova (o i contanti)
 * nella stessa transazione: una prova non diventa mai due pagamenti, nemmeno con due clic insieme.
 * Chi compra carica le prove da `buyer-order-money.ts`, che blocca lo stesso ordine. Nel registro
 * importi e forme di pagamento, mai la nota, il motivo o i dati della foto.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  ORDER_MESSAGE_LIMITS,
  acceptsOrderPayments,
  cashCollectionProblem,
  cashCollectionSchema,
  cashConfirmProblem,
  cashConfirmSchema,
  formatOrderNumber,
  isUuid,
  moneyRejectSchema,
  moneyReviewProblem,
  orderBalanceMinor,
  orderPaymentSchema,
  toFieldErrors,
  todayInTimeZone,
  type MoneyReviewStatus,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { getObjectStorage } from '../ai/storage';
import { logger } from '../logger';
import { readStoredImage, type StoredImage } from '../media/stored-files';
import {
  paymentProofRejectedMailTx,
  paymentRecordedMailTx,
  sendOrderMails,
  type OrderMailDeps,
} from '../order-mail';
import { insertOrderPaymentTx, lockTenantOrderTx, paymentDayOf } from './order-payment-internals';
import { partsToDate } from './quote-internals';

/** Quante prove e quanti contanti mostra l'ordine (i più recenti): sono pochi per ordine. */
const MONEY_LIST_LIMIT = 20;

export interface OrderPaymentProofDto {
  readonly id: string;
  readonly status: MoneyReviewStatus;
  /** Quanto dice di aver pagato chi compra. */
  readonly amountMinor: number;
  readonly note: string | null;
  /** Il motivo di «Non lo trovo», che chi compra legge. */
  readonly rejectReason: string | null;
  readonly createdAt: Date;
  readonly reviewedAt: Date | null;
  /** La foto, finché c'è: si cancella 30 giorni dopo la chiusura dell'ordine. */
  readonly photo: { readonly width: number; readonly height: number } | null;
  /** Il nome del conto di chi l'ha caricata; null se l'ha eliminato. */
  readonly buyerName: string | null;
}

export interface OrderCashCollectionDto {
  readonly id: string;
  readonly status: MoneyReviewStatus;
  /** Quanto ha segnato chi consegna. */
  readonly amountMinor: number;
  /** Quanto è entrato davvero (il pagamento della conferma), o null. */
  readonly confirmedMinor: number | null;
  readonly note: string | null;
  /** Il motivo del rifiuto, che legge chi li aveva segnati. */
  readonly rejectReason: string | null;
  readonly collectedByName: string;
  /** Li ha segnati chi guarda. */
  readonly mine: boolean;
  readonly createdAt: Date;
  readonly reviewedAt: Date | null;
}

/** Le schede «Prove di pagamento» e «Contanti» dell'ordine. */
export interface OrderMoneyDto {
  readonly orderId: string;
  readonly currency: string;
  /** Quanto manca da pagare adesso (0 per un ordine annullato). */
  readonly balanceMinor: number;
  /** Solo per chi gestisce i soldi (`orders:payments`); vuoto per gli altri. */
  readonly proofs: readonly OrderPaymentProofDto[];
  readonly cash: readonly OrderCashCollectionDto[];
  /** Confermare o rifiutare prove e contanti (proprietario e gerente). */
  readonly canReview: boolean;
  /** Si può confermare adesso: l'ordine accetta pagamenti (non annullato). */
  readonly canConfirm: boolean;
  /**
   * «Ho incassato»: ordine accettato e non annullato, con qualcosa da pagare e nessun contante già
   * in attesa (`orders:fulfill`).
   */
  readonly canCollectCash: boolean;
}

const proofSelect = {
  id: true,
  status: true,
  amountMinor: true,
  note: true,
  rejectReason: true,
  createdAt: true,
  reviewedAt: true,
  photoWidth: true,
  photoHeight: true,
  photoDeletedAt: true,
  buyer: { select: { name: true } },
} as const;

const cashSelect = {
  id: true,
  status: true,
  amountMinor: true,
  note: true,
  rejectReason: true,
  createdAt: true,
  reviewedAt: true,
  collectedByMembershipId: true,
  collectedBy: { select: { user: { select: { name: true } } } },
  payment: { select: { amountMinor: true } },
} as const;

/** Le prove e i contanti di un ordine, con quello che chi guarda può fare. */
export async function getOrderMoney(ctx: TenantContext, orderId: string): Promise<OrderMoneyDto> {
  requirePermission(ctx, 'orders:read');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const reviews = hasPermission(ctx, 'orders:payments');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await tx.order.findFirst({
      where: { tenantId: ctx.tenantId, id: orderId },
      select: { id: true, status: true, paidMinor: true, totalMinor: true, currency: true },
    });
    if (!order) return null;
    const proofs = reviews
      ? await tx.orderPaymentProof.findMany({
          where: { tenantId: ctx.tenantId, orderId: order.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MONEY_LIST_LIMIT,
          select: proofSelect,
        })
      : [];
    const cash = await tx.orderCashCollection.findMany({
      where: { tenantId: ctx.tenantId, orderId: order.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MONEY_LIST_LIMIT,
      select: cashSelect,
    });
    return { order, proofs, cash };
  });
  if (!found) return notFound(ctx, 'Order', orderId);
  const { order, proofs, cash } = found;
  const balanceMinor =
    order.status === 'CANCELLED' ? 0 : orderBalanceMinor(order.paidMinor, order.totalMinor);
  const pendingCash = cash.some((row) => row.status === 'PENDING');
  return {
    orderId: order.id,
    currency: order.currency,
    balanceMinor,
    proofs: proofs.map((row) => ({
      id: row.id,
      status: row.status as MoneyReviewStatus,
      amountMinor: row.amountMinor,
      note: row.note,
      rejectReason: row.rejectReason,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      photo: row.photoDeletedAt ? null : { width: row.photoWidth, height: row.photoHeight },
      buyerName: row.buyer?.name ?? null,
    })),
    cash: cash.map((row) => ({
      id: row.id,
      status: row.status as MoneyReviewStatus,
      amountMinor: row.amountMinor,
      confirmedMinor: row.payment?.amountMinor ?? null,
      note: row.note,
      rejectReason: row.rejectReason,
      collectedByName: row.collectedBy.user.name,
      mine: row.collectedByMembershipId === ctx.membershipId,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
    })),
    canReview: reviews,
    canConfirm: reviews && acceptsOrderPayments(order.status),
    canCollectCash:
      hasPermission(ctx, 'orders:fulfill') &&
      !pendingCash &&
      cashCollectionProblem({
        status: order.status,
        balanceMinor,
        pending: false,
        amountMinor: 1,
      }) === null,
  };
}

// -----------------------------------------------------------------------------
// Prove di pagamento
// -----------------------------------------------------------------------------

/** Un ID che non c'è nella fioreria: si risponde 404 fuori dalla transazione (con la sonda). */
interface Missing {
  readonly kind: 'missing';
  readonly entity: 'Order' | 'OrderPaymentProof' | 'OrderCashCollection';
}

function missing(entity: Missing['entity']): Missing {
  return { kind: 'missing', entity };
}

function answerMissing(
  ctx: TenantContext,
  result: Missing,
  orderId: string,
  rowId: string,
): Promise<never> {
  return result.entity === 'Order'
    ? notFound(ctx, 'Order', orderId)
    : notFound(ctx, result.entity, rowId);
}

/** L'ordine bloccato e una sua prova ancora da decidere; `missing` se uno dei due non c'è. */
async function lockProofTx(
  tx: TransactionClient,
  ctx: TenantContext,
  orderId: string,
  proofId: string,
) {
  const order = await lockTenantOrderTx(tx, ctx, orderId);
  if (!order) return missing('Order');
  const proof = await tx.orderPaymentProof.findFirst({
    where: { tenantId: ctx.tenantId, id: proofId, orderId: order.id },
    select: { id: true, status: true, amountMinor: true },
  });
  if (!proof) return missing('OrderPaymentProof');
  const problem = moneyReviewProblem(proof.status as MoneyReviewStatus);
  if (problem) throw new ConflictError(problem);
  return { kind: 'ok' as const, order, proof };
}

/**
 * «Confermo»: la prova diventa un pagamento con i dati del modulo «Registra pagamento» (già
 * compilato con l'importo della prova, Bonifico e «Comprobante del cliente»), fino a quanto manca.
 * Chi compra riceve «Registramos tu pago» dopo il commit.
 */
export async function confirmPaymentProof(
  ctx: TenantContext,
  orderId: string,
  proofId: string,
  rawInput: unknown,
  mail: OrderMailDeps | null = null,
): Promise<{ readonly paymentId: string }> {
  requirePermission(ctx, 'orders:payments');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  if (!isUuid(proofId)) throw new NotFoundError('OrderPaymentProof');
  const parsed = orderPaymentSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const paidOn = paymentDayOf(ctx, input.paidOn);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const locked = await lockProofTx(tx, ctx, orderId, proofId);
    if (locked.kind === 'missing') return locked;
    const { order, proof } = locked;
    if (!acceptsOrderPayments(order.status)) throw new ConflictError('order_closed');
    if (input.amount > orderBalanceMinor(order.paidMinor, order.totalMinor)) {
      throw new ValidationError({ amount: 'payment_exceeds_balance' });
    }
    const { paymentId } = await insertOrderPaymentTx(tx, ctx, order, {
      kind: input.kind,
      method: input.method,
      amountMinor: input.amount,
      paidOn,
      reference: input.reference,
    });
    await tx.orderPaymentProof.update({
      where: { id: proof.id },
      data: { status: 'CONFIRMED', paymentId, reviewedById: ctx.userId, reviewedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderPaymentProofConfirmed,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(order.number),
        kind: input.kind,
        method: input.method,
        amountMinor: input.amount,
        proofAmountMinor: proof.amountMinor,
      },
    });
    const message = mail
      ? await paymentRecordedMailTx(
          tx,
          ctx.tenantId,
          order.id,
          { amountMinor: input.amount, refund: false },
          mail,
        )
      : null;
    return { kind: 'ok' as const, paymentId, message };
  });
  if (result.kind === 'missing') return answerMissing(ctx, result, orderId, proofId);
  if (mail && result.message) await sendOrderMails(mail.mailer, [result.message]);
  return { paymentId: result.paymentId };
}

/** «Non lo trovo»: la prova resta nello storico con il motivo; chi compra riceve l'email. */
export async function rejectPaymentProof(
  ctx: TenantContext,
  orderId: string,
  proofId: string,
  rawInput: unknown,
  mail: OrderMailDeps | null = null,
): Promise<void> {
  requirePermission(ctx, 'orders:payments');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  if (!isUuid(proofId)) throw new NotFoundError('OrderPaymentProof');
  const parsed = moneyRejectSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { reason } = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const locked = await lockProofTx(tx, ctx, orderId, proofId);
    if (locked.kind === 'missing') return locked;
    const { order, proof } = locked;
    await tx.orderPaymentProof.update({
      where: { id: proof.id },
      data: {
        status: 'REJECTED',
        rejectReason: reason,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderPaymentProofRejected,
      entityType: 'Order',
      entityId: order.id,
      // Mai il motivo: lo legge chi compra, nel registro basta sapere che c'è.
      metadata: {
        number: formatOrderNumber(order.number),
        amountMinor: proof.amountMinor,
        withReason: true,
      },
    });
    const message = mail
      ? await paymentProofRejectedMailTx(
          tx,
          ctx.tenantId,
          order.id,
          { amountMinor: proof.amountMinor, reason },
          mail,
        )
      : null;
    return { kind: 'ok' as const, message };
  });
  if (result.kind === 'missing') return answerMissing(ctx, result, orderId, proofId);
  if (mail && result.message) await sendOrderMails(mail.mailer, [result.message]);
}

/** La foto di una prova (`thumb` = miniatura), finché c'è. Solo chi gestisce i soldi. */
export async function getPaymentProofImage(
  ctx: TenantContext,
  orderId: string,
  proofId: string,
  variant: 'thumb' | 'full',
): Promise<StoredImage> {
  requirePermission(ctx, 'orders:payments');
  if (!isUuid(orderId) || !isUuid(proofId)) throw new NotFoundError('OrderPaymentProof');
  const proof = await withTenantContext(getDb(), ctx, (tx) =>
    tx.orderPaymentProof.findFirst({
      where: { tenantId: ctx.tenantId, id: proofId, orderId, photoDeletedAt: null },
      select: { photoKey: true, photoThumbKey: true },
    }),
  );
  if (!proof) return notFound(ctx, 'OrderPaymentProof', proofId);
  return readStoredImage(
    variant === 'thumb' ? proof.photoThumbKey : proof.photoKey,
    'image/jpeg',
    'OrderPaymentProof',
  );
}

// -----------------------------------------------------------------------------
// Contanti di chi consegna
// -----------------------------------------------------------------------------

/**
 * «Ho incassato $X in contanti»: chi prepara o consegna (`orders:fulfill`, non solo la persona
 * assegnata) li segna; restano in attesa finché proprietario o gerente li confermano. Uno in attesa
 * per ordine (indice nel database); lo stesso modulo inviato due volte (chiave) non ne crea due.
 */
export async function submitOrderCashCollection(
  ctx: TenantContext,
  orderId: string,
  rawInput: unknown,
): Promise<{ readonly id: string; readonly duplicate: boolean }> {
  requirePermission(ctx, 'orders:fulfill');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  const parsed = cashCollectionSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const order = await lockTenantOrderTx(tx, ctx, orderId);
    if (!order) return null;
    const repeated = await tx.orderCashCollection.findFirst({
      where: { tenantId: ctx.tenantId, orderId: order.id, submitKey: input.submitKey },
      select: { id: true },
    });
    if (repeated) return { id: repeated.id, duplicate: true };
    const pending = await tx.orderCashCollection.findFirst({
      where: { tenantId: ctx.tenantId, orderId: order.id, status: 'PENDING' },
      select: { id: true },
    });
    const problem = cashCollectionProblem({
      status: order.status,
      balanceMinor: orderBalanceMinor(order.paidMinor, order.totalMinor),
      pending: pending !== null,
      amountMinor: input.amount,
    });
    if (problem === 'payment_exceeds_balance') throw new ValidationError({ amount: problem });
    if (problem) throw new ConflictError(problem);
    const created = await tx.orderCashCollection.create({
      data: {
        tenantId: ctx.tenantId,
        orderId: order.id,
        collectedByMembershipId: ctx.membershipId,
        amountMinor: input.amount,
        note: input.note,
        submitKey: input.submitKey,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderCashCollected,
      entityType: 'Order',
      entityId: order.id,
      metadata: { number: formatOrderNumber(order.number), amountMinor: input.amount },
    });
    return { id: created.id, duplicate: false };
  });
  if (!result) return notFound(ctx, 'Order', orderId);
  return result;
}

/** L'ordine bloccato e i suoi contanti ancora da decidere; `missing` se uno dei due non c'è. */
async function lockCashTx(
  tx: TransactionClient,
  ctx: TenantContext,
  orderId: string,
  collectionId: string,
) {
  const order = await lockTenantOrderTx(tx, ctx, orderId);
  if (!order) return missing('Order');
  const collection = await tx.orderCashCollection.findFirst({
    where: { tenantId: ctx.tenantId, id: collectionId, orderId: order.id },
    select: { id: true, status: true, amountMinor: true, createdAt: true },
  });
  if (!collection) return missing('OrderCashCollection');
  const problem = moneyReviewProblem(collection.status as MoneyReviewStatus);
  if (problem) throw new ConflictError(problem);
  return { kind: 'ok' as const, order, collection };
}

/**
 * «Confermo i contanti»: diventano un saldo in Contanti, del giorno in cui sono stati segnati, per
 * l'importo che entra davvero (non più di quanto segnato né di quanto manca adesso). Chi ha fatto
 * l'ordine online riceve «Registramos tu pago» dopo il commit.
 */
export async function confirmOrderCashCollection(
  ctx: TenantContext,
  orderId: string,
  collectionId: string,
  rawInput: unknown,
  mail: OrderMailDeps | null = null,
): Promise<{ readonly paymentId: string }> {
  requirePermission(ctx, 'orders:payments');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  if (!isUuid(collectionId)) throw new NotFoundError('OrderCashCollection');
  const parsed = cashConfirmSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const locked = await lockCashTx(tx, ctx, orderId, collectionId);
    if (locked.kind === 'missing') return locked;
    const { order, collection } = locked;
    if (!acceptsOrderPayments(order.status)) throw new ConflictError('order_closed');
    const problem = cashConfirmProblem({
      collectedMinor: collection.amountMinor,
      balanceMinor: orderBalanceMinor(order.paidMinor, order.totalMinor),
      amountMinor: input.amount,
    });
    if (problem) throw new ValidationError({ amount: problem });
    const { paymentId } = await insertOrderPaymentTx(tx, ctx, order, {
      kind: 'BALANCE',
      method: 'CASH',
      amountMinor: input.amount,
      // Il giorno in cui sono stati incassati, nel calendario della fioreria.
      paidOn: partsToDate(todayInTimeZone(ctx.timezone, collection.createdAt)),
      reference: input.reference,
    });
    await tx.orderCashCollection.update({
      where: { id: collection.id },
      data: { status: 'CONFIRMED', paymentId, reviewedById: ctx.userId, reviewedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderCashConfirmed,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(order.number),
        amountMinor: input.amount,
        collectedMinor: collection.amountMinor,
      },
    });
    const message = mail
      ? await paymentRecordedMailTx(
          tx,
          ctx.tenantId,
          order.id,
          { amountMinor: input.amount, refund: false },
          mail,
        )
      : null;
    return { kind: 'ok' as const, paymentId, message };
  });
  if (result.kind === 'missing') return answerMissing(ctx, result, orderId, collectionId);
  if (mail && result.message) await sendOrderMails(mail.mailer, [result.message]);
  return { paymentId: result.paymentId };
}

/** I contanti non entrano: il motivo lo legge chi li aveva segnati. Una volta sola. */
export async function rejectOrderCashCollection(
  ctx: TenantContext,
  orderId: string,
  collectionId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'orders:payments');
  if (!isUuid(orderId)) throw new NotFoundError('Order');
  if (!isUuid(collectionId)) throw new NotFoundError('OrderCashCollection');
  const parsed = moneyRejectSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { reason } = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const locked = await lockCashTx(tx, ctx, orderId, collectionId);
    if (locked.kind === 'missing') return locked;
    const { order, collection } = locked;
    await tx.orderCashCollection.update({
      where: { id: collection.id },
      data: {
        status: 'REJECTED',
        rejectReason: reason,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.orderCashRejected,
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        number: formatOrderNumber(order.number),
        amountMinor: collection.amountMinor,
        withReason: true,
      },
    });
    return { kind: 'ok' as const };
  });
  if (result.kind === 'missing') await answerMissing(ctx, result, orderId, collectionId);
}

// -----------------------------------------------------------------------------
// Lavoro giornaliero
// -----------------------------------------------------------------------------

/** Foto per giro del lavoro giornaliero (il resto al giro dopo). */
const PURGE_BATCH = 200;

/**
 * Lavoro giornaliero (M3-3): cancella i file delle foto delle prove di pagamento 30 giorni dopo la
 * chiusura dell'ordine (o dopo il suo giorno, se è rimasto aperto), come le foto dei messaggi. La
 * prova, il suo stato e il pagamento restano; `photoDeletedAt` dice che i file non ci sono più. La
 * funzione SQL dà solo gli ID; ogni prova si ricontrolla nella sua fioreria.
 */
export async function purgeOrderPaymentProofPhotos(): Promise<number> {
  const candidates = await getDb().$queryRaw<{ tenant_id: string; proof_id: string }[]>`
    SELECT tenant_id, proof_id
    FROM app_order_payment_proof_photos_to_purge(
      ${ORDER_MESSAGE_LIMITS.photoRetentionDays}::int,
      ${PURGE_BATCH}::int
    )`;
  const storage = getObjectStorage();
  let deleted = 0;
  for (const candidate of candidates) {
    try {
      const scope = { tenantId: candidate.tenant_id, userId: null };
      const proof = await withTenantContext(getDb(), scope, (tx) =>
        tx.orderPaymentProof.findFirst({
          where: { tenantId: candidate.tenant_id, id: candidate.proof_id, photoDeletedAt: null },
          select: { id: true, photoKey: true, photoThumbKey: true },
        }),
      );
      if (!proof) continue;
      await storage.delete(proof.photoKey);
      await storage.delete(proof.photoThumbKey);
      await withTenantContext(getDb(), scope, (tx) =>
        tx.orderPaymentProof.updateMany({
          where: { tenantId: candidate.tenant_id, id: proof.id, photoDeletedAt: null },
          data: { photoDeletedAt: new Date() },
        }),
      );
      deleted += 1;
    } catch (error) {
      logger.error(
        { err: error, proofId: candidate.proof_id },
        'foto di una prova di pagamento non cancellata',
      );
    }
  }
  return deleted;
}
