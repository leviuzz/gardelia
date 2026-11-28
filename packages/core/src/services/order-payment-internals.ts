/**
 * Pezzi comuni dei pagamenti di un ordine e di chi gestisce gli ordini online da accettare
 * (M3-3, ADR-088). Li usano i servizi degli ordini, delle prove di pagamento, dei contanti e dei
 * cambi da confermare; mai le pagine.
 */
import type { Prisma, TransactionClient } from '@floral/db';
import {
  canHandlePendingOnlineOrders,
  orderPaymentStatus,
  todayInTimeZone,
  type OrderPaymentKind,
  type OrderStatus,
  type PaymentMethod,
} from '@floral/domain';
import { hasPermission } from '../authorization';
import type { TenantContext } from '../context';
import { ForbiddenError, ValidationError } from '../errors';
import { partsToDate, type DateParts } from './quote-internals';

/** Il giorno di un pagamento o di un rimborso: oggi se non detto, mai dopo oggi (ora della fioreria). */
export function paymentDayOf(ctx: TenantContext, paidOn: DateParts | null): Date {
  const today = todayInTimeZone(ctx.timezone);
  const day = partsToDate(paidOn ?? today);
  if (day > partsToDate(today)) throw new ValidationError({ paidOn: 'out_of_range' });
  return day;
}

/** L'ordine bloccato (`FOR UPDATE`) nel contesto della fioreria, o null se non è suo. */
export async function lockTenantOrderTx(
  tx: TransactionClient,
  ctx: TenantContext,
  orderId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  return tx.order.findFirst({ where: { id: orderId, tenantId: ctx.tenantId } });
}

/**
 * Un movimento di pagamento e il pagato aggiornato, nella stessa transazione (ordine già bloccato).
 * `amountMinor` col segno: positivo per acconti e saldi, negativo per storni e rimborsi.
 */
export async function insertOrderPaymentTx(
  tx: TransactionClient,
  ctx: TenantContext,
  order: { readonly id: string; readonly totalMinor: number; readonly paidMinor: number },
  input: {
    readonly kind: OrderPaymentKind;
    readonly method: PaymentMethod;
    readonly amountMinor: number;
    readonly paidOn: Date;
    readonly reference: string | null;
    readonly reversedPaymentId?: string;
    /** La chiave del modulo (`alreadySubmittedPaymentTx` prima, sotto lo stesso lock). */
    readonly submitKey?: string | null;
  },
): Promise<{ readonly paymentId: string; readonly paidMinor: number }> {
  const payment = await tx.orderPayment.create({
    data: {
      tenantId: ctx.tenantId,
      orderId: order.id,
      kind: input.kind,
      method: input.method,
      amountMinor: input.amountMinor,
      paidOn: input.paidOn,
      reference: input.reference,
      reversedPaymentId: input.reversedPaymentId ?? null,
      submitKey: input.submitKey ?? null,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  const paidMinor = order.paidMinor + input.amountMinor;
  await tx.order.update({
    where: { id: order.id },
    data: { paidMinor, paymentStatus: orderPaymentStatus(paidMinor, order.totalMinor) },
  });
  return { paymentId: payment.id, paidMinor };
}

/**
 * Lo stesso modulo «Registra pagamento» / «Registra rimborso» è già arrivato (rete lenta, due
 * schede): con l'ordine bloccato, il pagamento che ha scritto, o null. Senza chiave sempre null.
 */
export async function alreadySubmittedPaymentTx(
  tx: TransactionClient,
  tenantId: string,
  submitKey: string | null,
): Promise<{ readonly id: string } | null> {
  if (!submitKey) return null;
  return tx.orderPayment.findFirst({ where: { tenantId, submitKey }, select: { id: true } });
}

/** L'impostazione della fioreria «Anche lo staff può accettare e rifiutare gli ordini online». */
export async function staffCanAcceptTx(tx: TransactionClient, tenantId: string): Promise<boolean> {
  const store = await tx.onlineStore.findUnique({
    where: { tenantId },
    select: { staffCanAccept: true },
  });
  return store?.staffCanAccept === true;
}

/**
 * Chi gestisce un ordine online da accettare (accettare, rifiutare, chiedere conferma, proporre una
 * data): proprietario e gerente sempre, lo staff solo con l'impostazione accesa. I servizi aprono
 * con `requirePermission(ctx, 'orders:accept')` e chiamano questo controllo sull'ordine bloccato.
 */
export async function assertCanHandlePendingOnlineTx(
  tx: TransactionClient,
  ctx: TenantContext,
): Promise<void> {
  if (hasPermission(ctx, 'orders:write')) return;
  const staffCanAccept = hasPermission(ctx, 'orders:accept')
    ? await staffCanAcceptTx(tx, ctx.tenantId)
    : false;
  if (!canHandlePendingOnlineOrders({ role: ctx.role, staffCanAccept })) {
    throw new ForbiddenError('orders:write');
  }
}

/**
 * Cambiare un ordine (consegna, prodotti, sconto): `orders:write`, oppure lo staff su un ordine
 * online ancora da accettare quando la fioreria glielo permette (M3-3).
 */
export async function assertOrderEditableTx(
  tx: TransactionClient,
  ctx: TenantContext,
  order: { readonly placedOnline: boolean; readonly status: OrderStatus },
): Promise<void> {
  if (hasPermission(ctx, 'orders:write')) return;
  if (!order.placedOnline || order.status !== 'PENDING_ACCEPTANCE') {
    throw new ForbiddenError('orders:write');
  }
  await assertCanHandlePendingOnlineTx(tx, ctx);
}

/**
 * Gli ordini online da accettare che aspettano la fioreria: mai quelli in attesa della conferma di
 * chi compra (M3-2, `ASKED`); con `DECLINED` in `excluded` nemmeno quelli tornati dopo un «No,
 * gracias» (che «Da gestire» conta a parte). Una regola sola per il numero del menu, «Da gestire»,
 * «Por aceptar» dell'elenco e Impostazioni → Negozio online. Senza `tenantId`: lo mette chi chiama.
 */
export function awaitingShopWhere(
  excluded: readonly ('ASKED' | 'DECLINED')[] = ['ASKED'],
): Prisma.OrderWhereInput {
  return {
    status: 'PENDING_ACCEPTANCE',
    placedOnline: true,
    OR: [
      { changeRequest: { is: null } },
      { changeRequest: { is: { status: { notIn: [...excluded] } } } },
    ],
  };
}

/** Ordini online da accettare che aspettano la conferma di chi compra (M3-2, filtro dell'elenco). */
export const WAITING_FOR_BUYER_WHERE = {
  status: 'PENDING_ACCEPTANCE',
  placedOnline: true,
  changeRequest: { is: { status: 'ASKED' } },
} satisfies Prisma.OrderWhereInput;

/** Ordini online da accettare tornati alla fioreria dopo un «No, gracias» ai cambi (M3-2). */
export const DECLINED_CHANGES_WHERE = {
  status: 'PENDING_ACCEPTANCE',
  placedOnline: true,
  changeRequest: { is: { status: 'DECLINED' } },
} satisfies Prisma.OrderWhereInput;
