/**
 * Pagamenti dei contratti di Floral Care (ADR-082, blocco 3a), registrati a mano (D-26):
 *  - su un cargo ("Registrar pago" nella pagina del cargo), mai oltre il suo saldo;
 *  - sull'estado de cuenta del cliente: un solo pagamento per tutte le sedi, distribuito da solo
 *    sui cargos più vecchi (decisione del founder del 24/11);
 *  - "Anular": uno storno di segno opposto, che resta nello storico (niente si cancella);
 *  - "Registrar devolución": chiude il saldo a favore del cargo finale di un contratto finito.
 *
 * Vuole `subscriptions:payments` (proprietario e gerente) e non il piano: la fioreria deve poter
 * cobrar i contratti già firmati. Ordine dei blocchi: i cargos toccati FOR UPDATE in ordine di id
 * (uno storno blocca prima il suo movimento); mai contratti o visite, così i pagamenti non si
 * incrociano con l'emissione dei cargos. Nel registro numeri e importi, mai referencia o nota.
 */
import { getDb, Prisma, withTenantContext, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CARE_CHARGE_LIMITS,
  allocateCarePayment,
  carePaymentSchema,
  compareDates,
  formatCareChargeNumber,
  isUuid,
  toFieldErrors,
  todayInTimeZone,
  type CalendarDate,
  type CarePaymentInput,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { dbDate, requiredParts } from './care-internals';

export interface LockedCharge {
  readonly id: string;
  readonly number: number;
  readonly customerId: string;
  readonly subscriptionId: string;
  readonly period: Date;
  readonly currency: string;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly balanceMinor: number;
}

const lockedSelect = {
  id: true,
  number: true,
  customerId: true,
  subscriptionId: true,
  period: true,
  currency: true,
  totalMinor: true,
  paidMinor: true,
  balanceMinor: true,
} satisfies Prisma.CareChargeSelect;

/** Blocca i cargos indicati (in ordine di id) e li rilegge dopo il blocco. Solo della fioreria. */
export async function lockCharges(
  tx: TransactionClient,
  tenantId: string,
  ids: readonly string[],
): Promise<LockedCharge[]> {
  if (ids.length === 0) return [];
  const list = Prisma.join([...new Set(ids)].map((id) => Prisma.sql`${id}::uuid`));
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CareCharge"
    WHERE "tenantId" = ${tenantId}::uuid AND "id" IN (${list})
    ORDER BY "id"
    FOR UPDATE`;
  if (locked.length === 0) return [];
  return tx.careCharge.findMany({
    where: { tenantId, id: { in: locked.map((row) => row.id) } },
    select: lockedSelect,
  });
}

/** Il nuovo pagato di un cargo (il database ricontrolla che resti fra 0 e il totale). */
async function applyToCharge(
  tx: TransactionClient,
  tenantId: string,
  charge: LockedCharge,
  amountMinor: number,
): Promise<void> {
  const paidMinor = charge.paidMinor + amountMinor;
  await tx.careCharge.update({
    where: { id: charge.id, tenantId },
    data: { paidMinor, balanceMinor: charge.totalMinor - paidMinor },
  });
}

function parsePayment(
  ctx: TenantContext,
  rawInput: unknown,
): CarePaymentInput & { day: CalendarDate } {
  const parsed = carePaymentSchema(ctx.currency).safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const today = todayInTimeZone(ctx.timezone);
  const day = parsed.data.paidOn ?? today;
  if (compareDates(day, today) > 0) throw new ValidationError({ paidOn: 'care_paid_on_future' });
  return { ...parsed.data, day };
}

/**
 * I cargos aperti più vecchi del cliente su cui va un pagamento, bloccati e riletti (un altro
 * pagamento può averli appena cambiati). Più di quanto manca in tutto si rifiuta.
 */
export async function planOldestFirstTx(
  tx: TransactionClient,
  tenantId: string,
  customerId: string,
  amountMinor: number,
): Promise<{ readonly charge: LockedCharge; readonly amountMinor: number }[]> {
  const open = await tx.careCharge.findMany({
    where: { tenantId, customerId, balanceMinor: { gt: 0 } },
    orderBy: [{ period: 'asc' }, { number: 'asc' }],
    take: CARE_CHARGE_LIMITS.allocationCharges,
    select: { id: true },
  });
  const charges = await lockCharges(
    tx,
    tenantId,
    open.map((charge) => charge.id),
  );
  const plan = allocateCarePayment(
    amountMinor,
    charges.map((charge) => ({
      id: charge.id,
      period: requiredParts(charge.period),
      number: charge.number,
      balanceMinor: charge.balanceMinor,
    })),
  );
  if (!plan.ok) throw new ValidationError({ amount: plan.error });
  const byId = new Map(charges.map((charge) => [charge.id, charge]));
  return plan.allocations.map((allocation) => {
    const charge = byId.get(allocation.chargeId);
    if (!charge) throw new Error('Cargo bloccato mancante');
    return { charge, amountMinor: allocation.amountMinor };
  });
}

/** Le distribuzioni di un movimento e il nuovo pagato dei cargos (già bloccati). */
export async function allocatePaymentTx(
  tx: TransactionClient,
  tenantId: string,
  input: {
    readonly paymentId: string;
    readonly customerId: string;
    readonly allocations: readonly {
      readonly charge: LockedCharge;
      readonly amountMinor: number;
    }[];
  },
): Promise<void> {
  await tx.carePaymentAllocation.createMany({
    data: input.allocations.map((allocation) => ({
      tenantId,
      paymentId: input.paymentId,
      chargeId: allocation.charge.id,
      customerId: input.customerId,
      amountMinor: allocation.amountMinor,
    })),
  });
  for (const allocation of input.allocations) {
    await applyToCharge(tx, tenantId, allocation.charge, allocation.amountMinor);
  }
}

/** Lo stesso modulo inviato due volte: il pagamento c'è già (stessa chiave). */
export async function alreadySubmitted(
  tx: TransactionClient,
  tenantId: string,
  submitKey: string | null,
): Promise<string | null> {
  if (!submitKey) return null;
  const existing = await tx.carePayment.findFirst({
    where: { tenantId, submitKey },
    select: { id: true },
  });
  return existing?.id ?? null;
}

async function createPayment(
  tx: TransactionClient,
  ctx: TenantContext,
  input: {
    readonly customerId: string;
    readonly kind: 'PAYMENT' | 'REFUND';
    readonly amountMinor: number;
    readonly payment: CarePaymentInput & { day: CalendarDate };
    readonly allocations: readonly {
      readonly charge: LockedCharge;
      readonly amountMinor: number;
    }[];
  },
): Promise<string> {
  const payment = await tx.carePayment.create({
    data: {
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency: ctx.currency,
      method: input.payment.method,
      paidOn: dbDate(input.payment.day),
      reference: input.payment.reference,
      note: input.payment.note,
      submitKey: input.payment.submitKey,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await allocatePaymentTx(tx, ctx.tenantId, {
    paymentId: payment.id,
    customerId: input.customerId,
    allocations: input.allocations,
  });
  return payment.id;
}

/** "Registrar pago" su un cargo: non oltre quanto manca da pagare. */
export async function recordCareChargePayment(
  ctx: TenantContext,
  subscriptionId: string,
  chargeId: string,
  rawInput: unknown,
): Promise<{ readonly paymentId: string }> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(subscriptionId) || !isUuid(chargeId)) throw new NotFoundError('CareCharge');
  const payment = parsePayment(ctx, rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const [charge] = await lockCharges(tx, ctx.tenantId, [chargeId]);
    if (!charge || charge.subscriptionId !== subscriptionId) return null;
    const repeated = await alreadySubmitted(tx, ctx.tenantId, payment.submitKey);
    if (repeated) return { paymentId: repeated };
    if (payment.amount > charge.balanceMinor) {
      throw new ValidationError({ amount: 'payment_exceeds_balance' });
    }
    const paymentId = await createPayment(tx, ctx, {
      customerId: charge.customerId,
      kind: 'PAYMENT',
      amountMinor: payment.amount,
      payment,
      allocations: [{ charge, amountMinor: payment.amount }],
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePaymentRecorded,
      entityType: 'CarePayment',
      entityId: paymentId,
      metadata: {
        number: formatCareChargeNumber(charge.number),
        method: payment.method,
        amountMinor: payment.amount,
      },
    });
    return { paymentId };
  });
  if (!result) return notFound(ctx, 'CareCharge', chargeId);
  return result;
}

/**
 * "Registrar pago" sull'estado de cuenta: un pagamento del cliente per tutte le sue sedi, che va ai
 * cargos più vecchi con saldo. Più di quanto manca in tutto si rifiuta.
 */
export async function recordCustomerCarePayment(
  ctx: TenantContext,
  customerId: string,
  rawInput: unknown,
): Promise<{ readonly paymentId: string; readonly charges: number }> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(customerId)) throw new NotFoundError('Customer');
  const payment = parsePayment(ctx, rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { tenantId: ctx.tenantId, id: customerId },
      select: { id: true },
    });
    if (!customer) return null;
    const repeated = await alreadySubmitted(tx, ctx.tenantId, payment.submitKey);
    if (repeated) {
      const charges = await tx.carePaymentAllocation.count({
        where: { tenantId: ctx.tenantId, paymentId: repeated },
      });
      return { paymentId: repeated, charges };
    }
    const allocations = await planOldestFirstTx(tx, ctx.tenantId, customerId, payment.amount);
    const paymentId = await createPayment(tx, ctx, {
      customerId,
      kind: 'PAYMENT',
      amountMinor: payment.amount,
      payment,
      allocations,
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePaymentRecorded,
      entityType: 'CarePayment',
      entityId: paymentId,
      metadata: {
        number: allocations
          .map((allocation) => formatCareChargeNumber(allocation.charge.number))
          .join(', '),
        method: payment.method,
        amountMinor: payment.amount,
        charges: allocations.length,
      },
    });
    return { paymentId, charges: allocations.length };
  });
  if (!result) return notFound(ctx, 'Customer', customerId);
  return result;
}

/**
 * "Anular": storna un movimento registrato per errore (un pagamento o una devolución) su tutti i
 * cargos su cui era andato. Il movimento resta nello storico con il suo storno; una volta sola.
 */
export async function reverseCarePayment(ctx: TenantContext, paymentId: string): Promise<void> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(paymentId)) throw new NotFoundError('CarePayment');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CarePayment"
      WHERE "id" = ${paymentId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid
      FOR UPDATE`;
    if (locked.length === 0) return false;
    const payment = await tx.carePayment.findFirst({
      where: { tenantId: ctx.tenantId, id: paymentId },
      select: {
        id: true,
        kind: true,
        status: true,
        customerId: true,
        method: true,
        amountMinor: true,
        reversal: { select: { id: true } },
        allocations: { select: { chargeId: true, amountMinor: true } },
      },
    });
    if (!payment) return false;
    if (payment.reversal) throw new ConflictError('payment_already_reversed');
    if (payment.kind === 'REVERSAL' || payment.status !== 'RECORDED') {
      throw new ConflictError('care_payment_not_reversible');
    }
    const charges = await lockCharges(
      tx,
      ctx.tenantId,
      payment.allocations.map((allocation) => allocation.chargeId),
    );
    const byId = new Map(charges.map((charge) => [charge.id, charge]));
    try {
      const reversal = await tx.carePayment.create({
        data: {
          tenantId: ctx.tenantId,
          customerId: payment.customerId,
          kind: 'REVERSAL',
          amountMinor: -payment.amountMinor,
          currency: ctx.currency,
          method: payment.method,
          paidOn: dbDate(todayInTimeZone(ctx.timezone)),
          reversedPaymentId: payment.id,
          createdById: ctx.userId,
        },
        select: { id: true },
      });
      await tx.carePaymentAllocation.createMany({
        data: payment.allocations.map((allocation) => ({
          tenantId: ctx.tenantId,
          paymentId: reversal.id,
          chargeId: allocation.chargeId,
          customerId: payment.customerId,
          amountMinor: -allocation.amountMinor,
        })),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('payment_already_reversed');
      }
      throw error;
    }
    for (const allocation of payment.allocations) {
      const charge = byId.get(allocation.chargeId);
      if (!charge) throw new Error('Cargo bloccato mancante');
      await applyToCharge(tx, ctx.tenantId, charge, -allocation.amountMinor);
    }
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePaymentReversed,
      entityType: 'CarePayment',
      entityId: payment.id,
      metadata: {
        number: charges.map((charge) => formatCareChargeNumber(charge.number)).join(', '),
        kind: payment.kind,
        amountMinor: payment.amountMinor,
      },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CarePayment', paymentId);
}

/**
 * "Registrar devolución": la fioreria restituisce al cliente il saldo a favore del cargo finale
 * di un contratto finito (anche in più volte), mai oltre quanto gli deve.
 */
export async function refundCareCharge(
  ctx: TenantContext,
  subscriptionId: string,
  chargeId: string,
  rawInput: unknown,
): Promise<{ readonly paymentId: string }> {
  requirePermission(ctx, 'subscriptions:payments');
  if (!isUuid(subscriptionId) || !isUuid(chargeId)) throw new NotFoundError('CareCharge');
  const payment = parsePayment(ctx, rawInput);
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const [charge] = await lockCharges(tx, ctx.tenantId, [chargeId]);
    if (!charge || charge.subscriptionId !== subscriptionId) return null;
    const repeated = await alreadySubmitted(tx, ctx.tenantId, payment.submitKey);
    if (repeated) return { paymentId: repeated };
    if (charge.balanceMinor >= 0) throw new ConflictError('care_charge_not_in_favor');
    if (payment.amount > -charge.balanceMinor) {
      throw new ValidationError({ amount: 'care_refund_exceeds_credit' });
    }
    const paymentId = await createPayment(tx, ctx, {
      customerId: charge.customerId,
      kind: 'REFUND',
      amountMinor: -payment.amount,
      payment,
      allocations: [{ charge, amountMinor: -payment.amount }],
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.carePaymentRefunded,
      entityType: 'CarePayment',
      entityId: paymentId,
      metadata: {
        number: formatCareChargeNumber(charge.number),
        method: payment.method,
        amountMinor: payment.amount,
      },
    });
    return { paymentId };
  });
  if (!result) return notFound(ctx, 'CareCharge', chargeId);
  return result;
}
