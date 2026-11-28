/**
 * Marketplace M3-3 «Soldi e squadra» (ADR-088), regole pure:
 *  - le prove di pagamento che chi compra carica dopo l'accettazione («Ya pagué»), che la fioreria
 *    conferma (diventano un pagamento) o rifiuta con un motivo;
 *  - il rimborso su un ordine annullato (negativo, non si storna);
 *  - i contanti che chi consegna segna («Ho incassato») e che proprietario o gerente confermano;
 *  - i dati per pagare solo a ordine accettato e non annullato;
 *  - lo staff che accetta gli ordini online se la fioreria lo permette.
 * Il server rivalida tutto: qui solo schemi, limiti e problemi con i loro codici.
 */
import { z } from 'zod';
import type { CurrencyCode } from './money';
import {
  acceptsOrderPayments,
  ORDER_LIMITS,
  paymentDateField,
  paymentMethodField,
  type OrderPaymentKind,
  type OrderStatus,
} from './order';
import type { MembershipRole } from './permissions';
import { moneyField, optionalText, requiredText, toTrimmedString } from './validation';

export const ORDER_MONEY_LIMITS = {
  /** La nota di chi compra su una prova di pagamento. */
  proofNote: 300,
  /** Prove in attesa per ordine: oltre, chi compra aspetta la risposta della fioreria. */
  proofsPending: 3,
  /** Il motivo di «Non lo trovo» o del rifiuto dei contanti, che l'altra parte legge. */
  rejectReason: 300,
  /** La nota di chi consegna sui contanti. */
  cashNote: 300,
} as const;

/** Stato di una prova o dei contanti: in attesa, confermati (un pagamento) o rifiutati. */
export const MONEY_REVIEW_STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED'] as const;
export type MoneyReviewStatus = (typeof MONEY_REVIEW_STATUSES)[number];

const submitKeyField = z.preprocess(toTrimmedString, z.uuid({ error: 'required' }));

// -----------------------------------------------------------------------------
// Prova di pagamento (chi compra)
// -----------------------------------------------------------------------------

/** «Ya pagué: sube tu comprobante»: importo, nota facoltativa; la foto arriva a parte. */
export function paymentProofSchema(currency: CurrencyCode) {
  return z.object({
    amount: moneyField(currency),
    note: optionalText(ORDER_MONEY_LIMITS.proofNote),
    submitKey: submitKeyField,
  });
}
export type PaymentProofInput = z.infer<ReturnType<typeof paymentProofSchema>>;

export type OrderPayableProblem = 'order_not_payable' | 'order_nothing_to_pay';

/**
 * Si paga (prova o contanti) un ordine accettato e non annullato con qualcosa da pagare. Le prove
 * le carica solo chi ha fatto un ordine online.
 */
export function orderPayableProblem(order: {
  readonly status: OrderStatus;
  readonly balanceMinor: number;
}): OrderPayableProblem | null {
  if (order.status === 'PENDING_ACCEPTANCE' || !acceptsOrderPayments(order.status)) {
    return 'order_not_payable';
  }
  return order.balanceMinor > 0 ? null : 'order_nothing_to_pay';
}

export type PaymentProofProblem =
  OrderPayableProblem | 'payment_proofs_pending_limit' | 'payment_exceeds_balance';

/** Chi compra carica una prova: ordine pagabile, non troppe in attesa, non più di quanto manca. */
export function paymentProofProblem(input: {
  readonly status: OrderStatus;
  readonly balanceMinor: number;
  readonly pendingProofs: number;
  readonly amountMinor: number;
}): PaymentProofProblem | null {
  const payable = orderPayableProblem(input);
  if (payable) return payable;
  if (input.pendingProofs >= ORDER_MONEY_LIMITS.proofsPending) {
    return 'payment_proofs_pending_limit';
  }
  return input.amountMinor > input.balanceMinor ? 'payment_exceeds_balance' : null;
}

/** «Non lo trovo» (prova) o il rifiuto dei contanti: il motivo è obbligatorio. */
export const moneyRejectSchema = z.object({
  reason: requiredText(ORDER_MONEY_LIMITS.rejectReason),
});
export type MoneyRejectInput = z.infer<typeof moneyRejectSchema>;

/** Una prova o dei contanti si decidono una volta sola. */
export function moneyReviewProblem(status: MoneyReviewStatus): 'money_already_reviewed' | null {
  return status === 'PENDING' ? null : 'money_already_reviewed';
}

// -----------------------------------------------------------------------------
// Rimborso e storno
// -----------------------------------------------------------------------------

/** «Registra rimborso» su un ordine annullato: importo, metodo, giorno, riferimento. */
export function orderRefundSchema(currency: CurrencyCode) {
  return z.object({
    amount: moneyField(currency),
    method: paymentMethodField(),
    paidOn: paymentDateField(),
    reference: optionalText(ORDER_LIMITS.paymentReference),
  });
}
export type OrderRefundInput = z.infer<ReturnType<typeof orderRefundSchema>>;

/** Si rimborsa solo un ordine annullato, e non più di quanto è stato pagato (al netto). */
export function refundProblem(input: {
  readonly status: OrderStatus;
  readonly paidMinor: number;
  readonly amountMinor: number;
}): 'refund_not_cancelled' | 'refund_nothing_paid' | 'refund_exceeds_paid' | null {
  if (input.status !== 'CANCELLED') return 'refund_not_cancelled';
  if (input.paidMinor <= 0) return 'refund_nothing_paid';
  return input.amountMinor > input.paidMinor ? 'refund_exceeds_paid' : null;
}

/**
 * Uno storno («Anular») vale per un acconto o un saldo, una volta, e non può portare il pagato sotto
 * zero (succederebbe stornando un pagamento già rimborsato). Un rimborso non si storna.
 */
export function reversalProblem(input: {
  readonly kind: OrderPaymentKind;
  readonly alreadyReversed: boolean;
  readonly paidMinor: number;
  readonly amountMinor: number;
}): 'payment_not_reversible' | 'payment_already_reversed' | 'reversal_below_zero' | null {
  if (input.kind !== 'DEPOSIT' && input.kind !== 'BALANCE') return 'payment_not_reversible';
  if (input.alreadyReversed) return 'payment_already_reversed';
  return input.paidMinor - input.amountMinor < 0 ? 'reversal_below_zero' : null;
}

// -----------------------------------------------------------------------------
// Contanti di chi consegna
// -----------------------------------------------------------------------------

/** «Ho incassato $X in contanti»: importo e nota facoltativa. */
export function cashCollectionSchema(currency: CurrencyCode) {
  return z.object({
    amount: moneyField(currency),
    note: optionalText(ORDER_MONEY_LIMITS.cashNote),
    submitKey: submitKeyField,
  });
}
export type CashCollectionInput = z.infer<ReturnType<typeof cashCollectionSchema>>;

/** Contanti segnati: ordine pagabile, uno in attesa alla volta, non più di quanto manca. */
export function cashCollectionProblem(input: {
  readonly status: OrderStatus;
  readonly balanceMinor: number;
  readonly pending: boolean;
  readonly amountMinor: number;
}): OrderPayableProblem | 'cash_collection_pending' | 'payment_exceeds_balance' | null {
  const payable = orderPayableProblem(input);
  if (payable) return payable;
  if (input.pending) return 'cash_collection_pending';
  return input.amountMinor > input.balanceMinor ? 'payment_exceeds_balance' : null;
}

/** La conferma dei contanti: l'importo (fino a quello segnato) e un riferimento facoltativo. */
export function cashConfirmSchema(currency: CurrencyCode) {
  return z.object({
    amount: moneyField(currency),
    reference: optionalText(ORDER_LIMITS.paymentReference),
  });
}
export type CashConfirmInput = z.infer<ReturnType<typeof cashConfirmSchema>>;

/** Si conferma al massimo quanto segnato e quanto manca adesso. */
export function cashConfirmProblem(input: {
  readonly collectedMinor: number;
  readonly balanceMinor: number;
  readonly amountMinor: number;
}): 'cash_exceeds_collected' | 'payment_exceeds_balance' | null {
  if (input.amountMinor > input.collectedMinor) return 'cash_exceeds_collected';
  return input.amountMinor > input.balanceMinor ? 'payment_exceeds_balance' : null;
}

// -----------------------------------------------------------------------------
// Dati per pagare e staff
// -----------------------------------------------------------------------------

/**
 * I dati per pagare (CLABE, conto…) si mostrano solo per un ordine online accettato e non
 * annullato: mai nella vetrina, nel modulo d'ordine o prima dell'accettazione (M3-3).
 */
export function paymentInstructionsVisible(order: {
  readonly placedOnline: boolean;
  readonly status: OrderStatus;
}): boolean {
  return (
    order.placedOnline &&
    order.status !== 'PENDING_ACCEPTANCE' &&
    acceptsOrderPayments(order.status)
  );
}

/**
 * Chi può accettare, rifiutare, chiedere conferma, proporre una data e cambiare un ordine online
 * da accettare: proprietario e gerente sempre, lo staff solo se la fioreria lo permette
 * (Impostazioni → Negozio online, spento di default).
 */
export function canHandlePendingOnlineOrders(input: {
  readonly role: MembershipRole;
  readonly staffCanAccept: boolean;
}): boolean {
  return input.role === 'OWNER' || input.role === 'MANAGER' || input.staffCanAccept;
}
