/**
 * "Cobré en la visita" (ADR-082, blocco 3b): chi fa la visita segna quanto gli ha dato il cliente,
 * come e una nota. Resta "Por registrar" (PENDING), visibile nell'estado de cuenta così nessuno lo
 * registra due volte, e non tocca i cargos. Chi gestisce i soldi lo conferma, anche per meno di
 * quanto segnato (diventa un pagamento distribuito sui cargos più vecchi del cliente), o lo rifiuta
 * dicendo perché (decisione del founder del 24/11).
 *
 * Ordine dei blocchi: l'incasso blocca solo la visita, come i passi della visita in corso; la
 * conferma blocca prima il movimento e poi i cargos in ordine di id, come uno storno. Mai contratti:
 * non si incrocia con l'emissione dei cargos. Nel registro importi e forma, mai la nota o il motivo
 * del rifiuto. Come gli altri pagamenti, non chiede il piano.
 */
import { getDb, withTenantContext, type Prisma } from '@floral/db';
import {
  AUDIT_ACTIONS,
  careCollectionConfirmSchema,
  careCollectionRejectSchema,
  careVisitCollectionSchema,
  formatCareChargeNumber,
  formatSubscriptionNumber,
  isUuid,
  toFieldErrors,
  todayInTimeZone,
  type CarePaymentStatus,
  type PaymentMethod,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { memberNamesTx } from './care-charges';
import { dbDate, isoOf } from './care-internals';
import { alreadySubmitted, allocatePaymentTx, planOldestFirstTx } from './care-payments';
import { lockCareVisit } from './care-visit-internals';

/** Quanti incassi "por registrar" mostra Cobros (sono pochi: si confermano ogni giorno). */
const PENDING_LIST_LIMIT = 100;

export interface CareCollectionDto {
  readonly id: string;
  readonly status: CarePaymentStatus;
  /** Quanto ha segnato chi ha fatto la visita. */
  readonly collectedMinor: number;
  /** Quanto è entrato: uguale finché è "por registrar", forse meno dopo la conferma. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly method: PaymentMethod;
  readonly paidOn: string;
  readonly note: string | null;
  readonly rejectReason: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly visitId: string;
  readonly visitDate: string | null;
}

export interface CarePendingCollectionDto extends CareCollectionDto {
  readonly customerId: string;
  readonly customerName: string;
  readonly subscriptionId: string;
  readonly contractLabel: string;
}

const collectionSelect = {
  id: true,
  status: true,
  collectedMinor: true,
  amountMinor: true,
  currency: true,
  method: true,
  paidOn: true,
  note: true,
  rejectReason: true,
  createdById: true,
  createdAt: true,
  visitId: true,
  visit: {
    select: {
      scheduledDate: true,
      originalDate: true,
      subscriptionId: true,
      subscription: { select: { number: true } },
    },
  },
  customer: { select: { id: true, displayName: true } },
} satisfies Prisma.CarePaymentSelect;

type CollectionRow = Prisma.CarePaymentGetPayload<{ select: typeof collectionSelect }>;

function toCollection(row: CollectionRow, names: ReadonlyMap<string, string>): CareCollectionDto {
  return {
    id: row.id,
    status: row.status,
    collectedMinor: row.collectedMinor ?? row.amountMinor,
    amountMinor: row.amountMinor,
    currency: row.currency,
    method: row.method,
    paidOn: isoOf(row.paidOn) ?? '',
    note: row.note,
    rejectReason: row.rejectReason,
    createdByName: row.createdById ? (names.get(row.createdById) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    visitId: row.visitId ?? '',
    visitDate: isoOf(row.visit?.scheduledDate ?? row.visit?.originalDate ?? null),
  };
}

/**
 * "Cobré en la visita": l'incasso resta "por registrar". Solo su una visita in corso o fatta, uno
 * alla volta per visita; lo stesso modulo inviato due volte (chiave) non ne crea due.
 */
export async function submitCareVisitCollection(
  ctx: TenantContext,
  visitId: string,
  rawInput: unknown,
): Promise<{ readonly paymentId: string }> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const parsed = careVisitCollectionSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const today = todayInTimeZone(ctx.timezone);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const visit = await lockCareVisit(tx, ctx, visitId);
    if (!visit) return null;
    const repeated = await alreadySubmitted(tx, ctx.tenantId, input.submitKey);
    if (repeated) return { paymentId: repeated };
    if (visit.status !== 'IN_PROGRESS' && visit.status !== 'DONE') {
      throw new ConflictError('care_collection_not_open');
    }
    const pending = await tx.carePayment.findFirst({
      where: { tenantId: ctx.tenantId, visitId: visit.id, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) throw new ConflictError('care_collection_pending');
    const payment = await tx.carePayment.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: visit.subscription.customerId,
        kind: 'PAYMENT',
        status: 'PENDING',
        amountMinor: input.amount,
        collectedMinor: input.amount,
        currency: ctx.currency,
        method: input.method,
        paidOn: dbDate(today),
        note: input.note,
        visitId: visit.id,
        submitKey: input.submitKey,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePaymentSubmitted,
      entityType: 'CarePayment',
      entityId: payment.id,
      metadata: {
        number: formatSubscriptionNumber(visit.subscription.number),
        method: input.method,
        amountMinor: input.amount,
      },
    });
    return { paymentId: payment.id };
  });
  if (!result) return notFound(ctx, 'CareVisit', visitId);
  return result;
}

/**
 * Gli incassi segnati in una visita. Chi gestisce i soldi li vede tutti; gli altri solo i propri
 * (lo staff non vede i soldi della fioreria, PROPOSTO in ADR-082).
 */
export async function listCareVisitCollections(
  ctx: TenantContext,
  visitId: string,
): Promise<readonly CareCollectionDto[]> {
  requirePermission(ctx, 'care:visit');
  if (!isUuid(visitId)) throw new NotFoundError('CareVisit');
  const manages = hasPermission(ctx, 'subscriptions:payments');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const visit = await tx.careVisit.findFirst({
      where: { tenantId: ctx.tenantId, id: visitId },
      select: { id: true },
    });
    if (!visit) return null;
    const rows = await tx.carePayment.findMany({
      where: {
        tenantId: ctx.tenantId,
        visitId,
        kind: 'PAYMENT',
        ...(manages ? {} : { createdById: ctx.userId }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: collectionSelect,
    });
    const names = await memberNamesTx(
      tx,
      ctx.tenantId,
      rows.flatMap((row) => (row.createdById ? [row.createdById] : [])),
    );
    return { rows, names };
  });
  if (!result) return notFound(ctx, 'CareVisit', visitId);
  return result.rows.map((row) => toCollection(row, result.names));
}

/** "Por registrar" in Cobros: gli incassi alla visita che aspettano chi gestisce, i più vecchi prima. */
export async function listPendingCareCollections(
  ctx: TenantContext,
): Promise<{ readonly items: readonly CarePendingCollectionDto[]; readonly total: number }> {
  requirePermission(ctx, 'subscriptions:payments');
  const where = { tenantId: ctx.tenantId, status: 'PENDING' as const };
  const { rows, total, names } = await withTenantContext(getDb(), ctx, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.carePayment.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: PENDING_LIST_LIMIT,
        select: collectionSelect,
      }),
      tx.carePayment.count({ where }),
    ]);
    const names = await memberNamesTx(
      tx,
      ctx.tenantId,
      rows.flatMap((row) => (row.createdById ? [row.createdById] : [])),
    );
    return { rows, total, names };
  });
  return {
    total,
    items: rows.map((row) => ({
      ...toCollection(row, names),
      customerId: row.customer.id,
      customerName: row.customer.displayName,
      subscriptionId: row.visit?.subscriptionId ?? '',
      contractLabel: row.visit ? formatSubscriptionNumber(row.visit.subscription.number) : '',
    })),
  };
}

/**
 * "Confirmar": l'incasso diventa un pagamento registrato, per l'importo che entra davvero (non più
 * di quanto segnato), distribuito sui cargos aperti più vecchi del cliente. Se il cliente non ha
 * ancora cargos da pagare per quell'importo si rifiuta: l'incasso resta "por registrar" finché
 * nasce il cargo (per esempio un anticipo del mese dopo).
 */
export async function confirmCarePayment(
  ctx: TenantContext,
  paymentId: string,
  rawInput: unknown,
): Promise<{ readonly charges: number }> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(paymentId)) throw new NotFoundError('CarePayment');
  const parsed = careCollectionConfirmSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CarePayment"
      WHERE "id" = ${paymentId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid
      FOR UPDATE`;
    if (locked.length === 0) return null;
    const payment = await tx.carePayment.findFirst({
      where: { tenantId: ctx.tenantId, id: paymentId },
      select: { id: true, status: true, customerId: true, method: true, collectedMinor: true },
    });
    if (!payment) return null;
    if (payment.status !== 'PENDING') throw new ConflictError('care_payment_not_pending');
    if (payment.collectedMinor === null || input.amount > payment.collectedMinor) {
      throw new ValidationError({ amount: 'care_confirm_exceeds_collected' });
    }
    const allocations = await planOldestFirstTx(tx, ctx.tenantId, payment.customerId, input.amount);
    await tx.carePayment.update({
      where: { id: payment.id, tenantId: ctx.tenantId },
      data: {
        status: 'RECORDED',
        amountMinor: input.amount,
        reference: input.reference,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
      },
    });
    await allocatePaymentTx(tx, ctx.tenantId, {
      paymentId: payment.id,
      customerId: payment.customerId,
      allocations,
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePaymentConfirmed,
      entityType: 'CarePayment',
      entityId: payment.id,
      metadata: {
        number: allocations
          .map((allocation) => formatCareChargeNumber(allocation.charge.number))
          .join(', '),
        method: payment.method,
        amountMinor: input.amount,
        collectedMinor: payment.collectedMinor,
        charges: allocations.length,
      },
    });
    return { charges: allocations.length };
  });
  if (!result) return notFound(ctx, 'CarePayment', paymentId);
  return result;
}

/** "Rechazar": l'incasso non entra; il motivo lo vede chi l'aveva segnato. Una volta sola. */
export async function rejectCarePayment(
  ctx: TenantContext,
  paymentId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(paymentId)) throw new NotFoundError('CarePayment');
  const parsed = careCollectionRejectSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const { reason } = parsed.data;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const updated = await tx.carePayment.updateMany({
      where: { tenantId: ctx.tenantId, id: paymentId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        rejectReason: reason,
        reviewedById: ctx.userId,
        reviewedAt: new Date(),
      },
    });
    const payment = await tx.carePayment.findFirst({
      where: { tenantId: ctx.tenantId, id: paymentId },
      select: {
        method: true,
        collectedMinor: true,
        visit: { select: { subscription: { select: { number: true } } } },
      },
    });
    if (!payment) return false;
    if (updated.count === 0) throw new ConflictError('care_payment_not_pending');
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePaymentRejected,
      entityType: 'CarePayment',
      entityId: paymentId,
      metadata: {
        ...(payment.visit
          ? { number: formatSubscriptionNumber(payment.visit.subscription.number) }
          : {}),
        method: payment.method,
        amountMinor: payment.collectedMinor,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CarePayment', paymentId);
}
