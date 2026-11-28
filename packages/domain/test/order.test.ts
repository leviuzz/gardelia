import { describe, expect, it } from 'vitest';
import {
  acceptsOrderPayments,
  areOrderLinesEditable,
  canCancelOrder,
  canStepOrder,
  counterConfirmationRecipient,
  deliveryAddressSchema,
  formatOrderNumber,
  formatTimeOfDay,
  isOrderAcceptance,
  isOrderEditable,
  orderDiscountSchema,
  orderFulfillmentSchema,
  orderConfirmationNoticeSchema,
  orderListFiltersSchema,
  orderPaymentSchema,
  orderPaymentStatus,
  orderStepsFrom,
  parseTimeInput,
  priceOrder,
  toFieldErrors,
} from '../src/index';

describe('numero e stati dell’ordine', () => {
  it('numera come PED-0001', () => {
    expect(formatOrderNumber(1)).toBe('PED-0001');
    expect(formatOrderNumber(12345)).toBe('PED-12345');
  });

  it('a domicilio: si consegna, non si ritira', () => {
    expect(orderStepsFrom('READY', 'DELIVERY')).toEqual(['OUT_FOR_DELIVERY', 'IN_PREPARATION']);
    expect(canStepOrder('OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY')).toBe(true);
    expect(canStepOrder('READY', 'PICKED_UP', 'DELIVERY')).toBe(false);
  });

  it('al ritiro: si ritira, non si consegna', () => {
    expect(orderStepsFrom('READY', 'PICKUP')).toEqual(['PICKED_UP', 'IN_PREPARATION']);
    expect(canStepOrder('READY', 'OUT_FOR_DELIVERY', 'PICKUP')).toBe(false);
  });

  it('un passo indietro per correggere, nessun passo dagli stati finali', () => {
    expect(canStepOrder('IN_PREPARATION', 'CONFIRMED', 'PICKUP')).toBe(true);
    expect(canStepOrder('CONFIRMED', 'DELIVERED', 'DELIVERY')).toBe(false);
    expect(orderStepsFrom('DELIVERED', 'DELIVERY')).toEqual([]);
    expect(orderStepsFrom('CANCELLED', 'PICKUP')).toEqual([]);
  });

  it('annulla e modifica solo ordini ancora aperti', () => {
    expect(canCancelOrder('READY')).toBe(true);
    expect(canCancelOrder('DELIVERED')).toBe(false);
    expect(canCancelOrder('CANCELLED')).toBe(false);
    expect(isOrderEditable('READY')).toBe(true);
    expect(isOrderEditable('OUT_FOR_DELIVERY')).toBe(false);
  });

  it('il borrador si conferma, si scarta e non riceve pagamenti', () => {
    expect(orderStepsFrom('DRAFT', 'DELIVERY')).toEqual([]);
    expect(canStepOrder('DRAFT', 'CONFIRMED', 'PICKUP')).toBe(false);
    // Si scarta senza motivo, non si annulla; consegna e tarjeta si compilano alla conferma.
    expect(canCancelOrder('DRAFT')).toBe(false);
    expect(isOrderEditable('DRAFT')).toBe(false);
    expect(areOrderLinesEditable('DRAFT')).toBe(true);
    expect(acceptsOrderPayments('DRAFT')).toBe(false);
    expect(acceptsOrderPayments('CONFIRMED')).toBe(true);
    expect(acceptsOrderPayments('CANCELLED')).toBe(false);
  });

  it('righe e sconto si cambiano finché il ramo non è pronto', () => {
    expect(areOrderLinesEditable('CONFIRMED')).toBe(true);
    expect(areOrderLinesEditable('IN_PREPARATION')).toBe(true);
    expect(areOrderLinesEditable('READY')).toBe(false);
    // Quello del marketplace da accettare sì (M3-2): poi chi compra conferma i cambi.
    expect(areOrderLinesEditable('PENDING_ACCEPTANCE')).toBe(true);
    expect(areOrderLinesEditable('CANCELLED')).toBe(false);
  });

  it('riconosce l’accettazione di un ordine del marketplace', () => {
    expect(isOrderAcceptance('PENDING_ACCEPTANCE', 'CONFIRMED')).toBe(true);
    expect(isOrderAcceptance('IN_PREPARATION', 'CONFIRMED')).toBe(false);
  });
});

describe('totali e pagamenti', () => {
  it('totale = subtotale − sconto + consegna', () => {
    expect(
      priceOrder({ subtotalMinor: 69000, discountMinor: 4000, deliveryFeeMinor: 8000 }),
    ).toEqual({
      ok: true,
      subtotalMinor: 69000,
      discountMinor: 4000,
      deliveryFeeMinor: 8000,
      taxMinor: 0,
      totalMinor: 73000,
    });
  });

  it('rifiuta sconti oltre il subtotale', () => {
    expect(priceOrder({ subtotalMinor: 1000, discountMinor: 1001, deliveryFeeMinor: 0 })).toEqual({
      ok: false,
      error: 'discount_exceeds_subtotal',
    });
  });

  it('stato del pagamento come il CHECK del database', () => {
    expect(orderPaymentStatus(0, 50000)).toBe('UNPAID');
    expect(orderPaymentStatus(20000, 50000)).toBe('PARTIAL');
    expect(orderPaymentStatus(50000, 50000)).toBe('PAID');
    expect(orderPaymentStatus(0, 0)).toBe('PAID');
  });
});

describe('fascia oraria', () => {
  it('legge e scrive HH:MM', () => {
    expect(parseTimeInput('09:30')).toBe(570);
    expect(parseTimeInput('24:00')).toBeNull();
    expect(parseTimeInput('9:30')).toBeNull();
    expect(formatTimeOfDay(570)).toBe('09:30');
  });
});

describe('dati di consegna', () => {
  const schema = orderFulfillmentSchema('MX', 'MXN');
  const base = {
    fulfillmentMode: 'DELIVERY',
    scheduledDate: '2026-12-12',
    windowStart: '10:00',
    windowEnd: '13:00',
    customerAddressId: '',
    recipientName: 'Lucía',
    recipientPhone: '449 555 0142',
    cardMessage: '¡Feliz cumpleaños!',
    cardAnonymous: 'on',
    deliveryFee: '80',
  };

  it('accetta una consegna completa', () => {
    const parsed = schema.parse(base);
    expect(parsed.scheduledDate).toEqual({ year: 2026, month: 12, day: 12 });
    expect(parsed.windowStart).toBe(600);
    expect(parsed.windowEnd).toBe(780);
    expect(parsed.recipientPhone).toBe('+524495550142');
    expect(parsed.cardAnonymous).toBe(true);
    expect(parsed.deliveryFee).toBe(8000);
    expect(parsed.customerAddressId).toBeNull();
  });

  it('vuole la fascia completa e in ordine', () => {
    const missing = schema.safeParse({ ...base, windowEnd: '' });
    expect(missing.success).toBe(false);
    if (!missing.success)
      expect(toFieldErrors(missing.error)).toMatchObject({ windowEnd: 'invalid_time_window' });
    const reversed = schema.safeParse({ ...base, windowStart: '14:00', windowEnd: '12:00' });
    expect(reversed.success).toBe(false);
  });

  it('il ritiro non ha costo di consegna', () => {
    const result = schema.safeParse({ ...base, fulfillmentMode: 'PICKUP' });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(toFieldErrors(result.error)).toMatchObject({ deliveryFee: 'out_of_range' });
  });

  it('chiede la data e un modo valido', () => {
    const result = schema.safeParse({ ...base, scheduledDate: '', fulfillmentMode: 'DRONE' });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(toFieldErrors(result.error)).toMatchObject({
        scheduledDate: 'required',
        fulfillmentMode: 'required',
      });
  });

  it('valida un indirizzo nuovo con le regole della rubrica', () => {
    const address = deliveryAddressSchema('MX').safeParse({
      addressLine1: 'Av. Madero 120',
      city: 'Aguascalientes',
      region: 'AGU',
      postalCode: '200',
    });
    expect(address.success).toBe(false);
    if (!address.success)
      expect(toFieldErrors(address.error)).toMatchObject({ postalCode: 'invalid_postal_code' });
  });
});

describe('pagamenti e filtri', () => {
  it('registra un acconto in contanti', () => {
    const parsed = orderPaymentSchema('MXN').parse({
      amount: '350.50',
      method: 'CASH',
      kind: 'DEPOSIT',
      paidOn: '',
      reference: '',
    });
    expect(parsed).toEqual({
      amount: 35050,
      method: 'CASH',
      kind: 'DEPOSIT',
      paidOn: null,
      reference: null,
    });
  });

  it('non accetta lo storno come pagamento inserito a mano', () => {
    const result = orderPaymentSchema('MXN').safeParse({
      amount: '10',
      method: 'CASH',
      kind: 'REVERSAL',
    });
    expect(result.success).toBe(false);
  });

  it('sconto: vuoto vale zero, importi in unità minime', () => {
    expect(orderDiscountSchema('MXN').parse({ discount: '' })).toEqual({ discount: 0 });
    expect(orderDiscountSchema('MXN').parse({ discount: '50.5' })).toEqual({ discount: 5050 });
    expect(orderDiscountSchema('MXN').safeParse({ discount: '-3' }).success).toBe(false);
  });

  it('i borradores hanno il loro filtro', () => {
    expect(orderListFiltersSchema.parse({ when: 'drafts' }).when).toBe('drafts');
  });

  it('filtri dell’elenco tolleranti', () => {
    expect(orderListFiltersSchema.parse({ when: 'today', unpaid: '1', page: '2' })).toEqual({
      q: '',
      status: null,
      when: 'today',
      unpaid: true,
      messages: false,
      changes: false,
      money: null,
      page: 2,
    });
    expect(orderListFiltersSchema.parse({ when: 'yesterday', status: 'LOST' })).toMatchObject({
      when: 'upcoming',
      status: null,
      unpaid: false,
      messages: false,
    });
    // M3-3: «Prove da controllare» e «Contanti da confermare»; il resto non filtra.
    expect(orderListFiltersSchema.parse({ money: 'proofs' }).money).toBe('proofs');
    expect(orderListFiltersSchema.parse({ money: 'cash' }).money).toBe('cash');
    expect(orderListFiltersSchema.parse({ money: 'todo' }).money).toBeNull();
  });

  it('«Con messaggi da leggere» (M3) solo con `messages=unread`', () => {
    expect(orderListFiltersSchema.parse({ messages: 'unread' }).messages).toBe(true);
    expect(orderListFiltersSchema.parse({ messages: '1' }).messages).toBe(false);
    expect(orderListFiltersSchema.parse({}).messages).toBe(false);
  });

  it('«No ai cambi» (M3-2) solo con `changes=declined`', () => {
    expect(orderListFiltersSchema.parse({ changes: 'declined' }).changes).toBe(true);
    expect(orderListFiltersSchema.parse({ changes: 'asked' }).changes).toBe(false);
    expect(orderListFiltersSchema.parse({}).changes).toBe(false);
  });
});

describe('conferma al cliente di un ordine del banco (ADR-072)', () => {
  const base = {
    requested: true,
    tenantMode: 'LIVE' as const,
    placedOnline: false,
    customerEmail: ' ana@example.com ',
  };

  it('va all’email del cliente quando chi conferma la chiede', () => {
    expect(counterConfirmationRecipient(base)).toBe('ana@example.com');
  });

  it('non parte senza la casella, dalle demo, per gli ordini online o senza email', () => {
    expect(counterConfirmationRecipient({ ...base, requested: false })).toBeNull();
    expect(counterConfirmationRecipient({ ...base, tenantMode: 'DEMO' })).toBeNull();
    expect(counterConfirmationRecipient({ ...base, placedOnline: true })).toBeNull();
    expect(counterConfirmationRecipient({ ...base, customerEmail: null })).toBeNull();
    expect(counterConfirmationRecipient({ ...base, customerEmail: '  ' })).toBeNull();
  });

  it('la casella vale solo se spuntata', () => {
    expect(orderConfirmationNoticeSchema.parse({ notifyCustomer: 'on' }).notifyCustomer).toBe(true);
    expect(orderConfirmationNoticeSchema.parse({}).notifyCustomer).toBe(false);
    expect(orderConfirmationNoticeSchema.parse({ notifyCustomer: '' }).notifyCustomer).toBe(false);
  });
});
