import { describe, expect, it } from 'vitest';
import {
  canCancelOrder,
  canStepOrder,
  deliveryAddressSchema,
  formatOrderNumber,
  formatTimeOfDay,
  isOrderAcceptance,
  isOrderEditable,
  orderFulfillmentSchema,
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

  it('filtri dell’elenco tolleranti', () => {
    expect(orderListFiltersSchema.parse({ when: 'today', unpaid: '1', page: '2' })).toEqual({
      q: '',
      status: null,
      when: 'today',
      unpaid: true,
      page: 2,
    });
    expect(orderListFiltersSchema.parse({ when: 'yesterday', status: 'LOST' })).toMatchObject({
      when: 'upcoming',
      status: null,
      unpaid: false,
    });
  });
});
