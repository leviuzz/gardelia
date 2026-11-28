import { describe, expect, it } from 'vitest';
import {
  can,
  canHandlePendingOnlineOrders,
  cashCollectionProblem,
  cashCollectionSchema,
  cashConfirmProblem,
  moneyRejectSchema,
  moneyReviewProblem,
  ORDER_MONEY_LIMITS,
  orderPayableProblem,
  orderRefundSchema,
  paymentInstructionsVisible,
  paymentProofProblem,
  paymentProofSchema,
  refundProblem,
  reversalProblem,
} from '../src';

const submitKey = '6f1c1d7e-8a4b-4c2e-9d3f-1a2b3c4d5e6f';

describe('prova di pagamento (M3-3)', () => {
  it('importo in unità minime, nota facoltativa, chiave del doppio invio', () => {
    expect(paymentProofSchema('MXN').parse({ amount: '690', note: '', submitKey })).toEqual({
      amount: 69000,
      note: null,
      submitKey,
    });
    const tooLong = paymentProofSchema('MXN').safeParse({
      amount: '1',
      note: 'x'.repeat(ORDER_MONEY_LIMITS.proofNote + 1),
      submitKey,
    });
    expect(tooLong.success).toBe(false);
    expect(paymentProofSchema('MXN').safeParse({ amount: 'abc', submitKey }).success).toBe(false);
    expect(paymentProofSchema('MXN').safeParse({ amount: '10', submitKey: '' }).success).toBe(
      false,
    );
  });

  it('solo dopo l’accettazione, con qualcosa da pagare, fino a 3 in attesa', () => {
    const base = { balanceMinor: 69000, pendingProofs: 0, amountMinor: 69000 };
    expect(paymentProofProblem({ ...base, status: 'PENDING_ACCEPTANCE' })).toBe(
      'order_not_payable',
    );
    expect(paymentProofProblem({ ...base, status: 'CANCELLED' })).toBe('order_not_payable');
    expect(paymentProofProblem({ ...base, status: 'DRAFT' })).toBe('order_not_payable');
    expect(paymentProofProblem({ ...base, status: 'CONFIRMED', balanceMinor: 0 })).toBe(
      'order_nothing_to_pay',
    );
    expect(
      paymentProofProblem({
        ...base,
        status: 'CONFIRMED',
        pendingProofs: ORDER_MONEY_LIMITS.proofsPending,
      }),
    ).toBe('payment_proofs_pending_limit');
    expect(paymentProofProblem({ ...base, status: 'CONFIRMED', amountMinor: 69001 })).toBe(
      'payment_exceeds_balance',
    );
    expect(paymentProofProblem({ ...base, status: 'CONFIRMED' })).toBeNull();
    // Anche dopo la consegna, se manca ancora qualcosa.
    expect(paymentProofProblem({ ...base, status: 'DELIVERED', amountMinor: 100 })).toBeNull();
  });

  it('«Non lo trovo» vuole un motivo; si decide una volta sola', () => {
    expect(moneyRejectSchema.safeParse({ reason: ' ' }).success).toBe(false);
    expect(moneyRejectSchema.parse({ reason: 'No aparece en el banco' })).toEqual({
      reason: 'No aparece en el banco',
    });
    expect(moneyReviewProblem('PENDING')).toBeNull();
    expect(moneyReviewProblem('CONFIRMED')).toBe('money_already_reviewed');
    expect(moneyReviewProblem('REJECTED')).toBe('money_already_reviewed');
  });
});

describe('rimborso e storno (M3-3)', () => {
  it('rimborso solo su un ordine annullato e fino al pagato', () => {
    expect(refundProblem({ status: 'CONFIRMED', paidMinor: 50000, amountMinor: 100 })).toBe(
      'refund_not_cancelled',
    );
    expect(refundProblem({ status: 'CANCELLED', paidMinor: 0, amountMinor: 100 })).toBe(
      'refund_nothing_paid',
    );
    expect(refundProblem({ status: 'CANCELLED', paidMinor: 50000, amountMinor: 50001 })).toBe(
      'refund_exceeds_paid',
    );
    expect(refundProblem({ status: 'CANCELLED', paidMinor: 50000, amountMinor: 20000 })).toBeNull();
    expect(
      orderRefundSchema('MXN').parse({
        amount: '200',
        method: 'TRANSFER',
        paidOn: '',
        reference: 'SPEI 123',
      }),
    ).toEqual({
      amount: 20000,
      method: 'TRANSFER',
      paidOn: null,
      reference: 'SPEI 123',
      submitKey: null,
    });
    // La chiave del modulo (doppi invii): un UUID o niente.
    const submitKey = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
    expect(
      orderRefundSchema('MXN').parse({ amount: '1', method: 'CASH', paidOn: '', submitKey })
        .submitKey,
    ).toBe(submitKey);
    expect(
      orderRefundSchema('MXN').safeParse({
        amount: '1',
        method: 'CASH',
        paidOn: '',
        submitKey: 'no-es-uuid',
      }).success,
    ).toBe(false);
    expect(
      orderRefundSchema('MXN').safeParse({ amount: '200', method: 'GIFT', paidOn: '' }).success,
    ).toBe(false);
  });

  it('lo storno vale per acconti e saldi, una volta, senza portare il pagato sotto zero', () => {
    const ok = { alreadyReversed: false, paidMinor: 50000, amountMinor: 50000 };
    expect(reversalProblem({ ...ok, kind: 'DEPOSIT' })).toBeNull();
    expect(reversalProblem({ ...ok, kind: 'BALANCE' })).toBeNull();
    expect(reversalProblem({ ...ok, kind: 'REFUND' })).toBe('payment_not_reversible');
    expect(reversalProblem({ ...ok, kind: 'REVERSAL' })).toBe('payment_not_reversible');
    expect(reversalProblem({ ...ok, kind: 'BALANCE', alreadyReversed: true })).toBe(
      'payment_already_reversed',
    );
    // Pagamento già rimborsato: il pagato netto è 0, lo storno lo porterebbe sotto zero.
    expect(reversalProblem({ ...ok, kind: 'BALANCE', paidMinor: 0 })).toBe('reversal_below_zero');
  });
});

describe('contanti di chi consegna (M3-3)', () => {
  it('ordine pagabile, uno in attesa, non più di quanto manca', () => {
    const base = { balanceMinor: 69000, pending: false, amountMinor: 69000 };
    expect(cashCollectionProblem({ ...base, status: 'PENDING_ACCEPTANCE' })).toBe(
      'order_not_payable',
    );
    expect(cashCollectionProblem({ ...base, status: 'OUT_FOR_DELIVERY', pending: true })).toBe(
      'cash_collection_pending',
    );
    expect(cashCollectionProblem({ ...base, status: 'DELIVERED', amountMinor: 70000 })).toBe(
      'payment_exceeds_balance',
    );
    expect(cashCollectionProblem({ ...base, status: 'DELIVERED' })).toBeNull();
    expect(cashCollectionSchema('MXN').parse({ amount: '690', note: '', submitKey })).toEqual({
      amount: 69000,
      note: null,
      submitKey,
    });
  });

  it('si conferma fino a quanto segnato e a quanto manca adesso', () => {
    expect(
      cashConfirmProblem({ collectedMinor: 50000, balanceMinor: 69000, amountMinor: 50001 }),
    ).toBe('cash_exceeds_collected');
    expect(
      cashConfirmProblem({ collectedMinor: 69000, balanceMinor: 20000, amountMinor: 30000 }),
    ).toBe('payment_exceeds_balance');
    expect(
      cashConfirmProblem({ collectedMinor: 69000, balanceMinor: 69000, amountMinor: 69000 }),
    ).toBeNull();
  });

  it('chi paga: anche dopo la consegna, mai su un ordine annullato', () => {
    expect(orderPayableProblem({ status: 'PICKED_UP', balanceMinor: 100 })).toBeNull();
    expect(orderPayableProblem({ status: 'CANCELLED', balanceMinor: 100 })).toBe(
      'order_not_payable',
    );
  });
});

describe('dati per pagare e staff (M3-3)', () => {
  it('i dati per pagare solo a ordine online accettato e non annullato', () => {
    expect(paymentInstructionsVisible({ placedOnline: true, status: 'PENDING_ACCEPTANCE' })).toBe(
      false,
    );
    expect(paymentInstructionsVisible({ placedOnline: true, status: 'CONFIRMED' })).toBe(true);
    expect(paymentInstructionsVisible({ placedOnline: true, status: 'DELIVERED' })).toBe(true);
    expect(paymentInstructionsVisible({ placedOnline: true, status: 'CANCELLED' })).toBe(false);
    expect(paymentInstructionsVisible({ placedOnline: false, status: 'CONFIRMED' })).toBe(false);
  });

  it('lo staff gestisce gli ordini online da accettare solo se la fioreria lo permette', () => {
    expect(can('STAFF', 'orders:accept')).toBe(true);
    expect(can('STAFF', 'orders:write')).toBe(false);
    expect(canHandlePendingOnlineOrders({ role: 'OWNER', staffCanAccept: false })).toBe(true);
    expect(canHandlePendingOnlineOrders({ role: 'MANAGER', staffCanAccept: false })).toBe(true);
    expect(canHandlePendingOnlineOrders({ role: 'STAFF', staffCanAccept: false })).toBe(false);
    expect(canHandlePendingOnlineOrders({ role: 'STAFF', staffCanAccept: true })).toBe(true);
  });
});
