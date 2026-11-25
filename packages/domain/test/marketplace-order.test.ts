import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_DATE_ERRORS,
  earliestMarketplaceDate,
  marketplaceDateProblem,
  marketplaceLinesFromForm,
  marketplaceOrderSchema,
  onlineOrderAcceptSchema,
  onlineOrderNeedsFreeDeliveryConfirmation,
} from '../src/index';

/** Ordine del cliente online (ADR-067). */
const today = { year: 2026, month: 11, day: 23 }; // lunedì

describe('righe dal modulo', () => {
  it('solo i campi qty.<id> con una quantità maggiore di zero', () => {
    expect(
      marketplaceLinesFromForm({
        'qty.a1': '2',
        'qty.b2': '0',
        'qty.c3': '',
        other: '5',
      }),
    ).toEqual([{ itemId: 'a1', quantity: 2 }]);
    // Forma annidata di formDataToObject.
    expect(marketplaceLinesFromForm({ qty: { a1: '3', b2: '0' } })).toEqual([
      { itemId: 'a1', quantity: 3 },
    ]);
  });

  it('quantità strane non spariscono: le rifiuta lo schema', () => {
    const lines = marketplaceLinesFromForm({ qty: { a1: '1.5', b2: 'abc', c3: '-1' } });
    expect(lines).toHaveLength(3);
    const parsed = marketplaceOrderSchema('MX').safeParse({
      lines: lines.map((line) => ({ ...line, itemId: '0192f5c1-6b2f-7000-8000-000000000001' })),
      fulfillmentMode: 'PICKUP',
      scheduledDate: '2026-11-25',
      contactPhone: '449 555 0101',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('modulo', () => {
  const valid = {
    lines: [{ itemId: '0192f5c1-6b2f-7000-8000-000000000001', quantity: 1 }],
    fulfillmentMode: 'DELIVERY',
    scheduledDate: '2026-11-25',
    window: '09:00-12:00',
    buyerAddressId: '',
    contactPhone: '449 555 0101',
  };

  it('fascia, telefono e righe; il costo di consegna non esiste nel modulo', () => {
    const parsed = marketplaceOrderSchema('MX').parse({ ...valid, deliveryFee: '0' });
    expect(parsed.window).toEqual({ start: 540, end: 720 });
    expect(parsed.contactPhone).toBe('+524495550101');
    expect(parsed.buyerAddressId).toBeNull();
    expect('deliveryFee' in parsed).toBe(false);
  });

  it('senza prodotti, senza telefono o con una fascia sbagliata non va', () => {
    const errors = marketplaceOrderSchema('MX').safeParse({
      ...valid,
      lines: [],
      contactPhone: '',
      window: '12:00-09:00',
    });
    expect(errors.success).toBe(false);
    const paths = errors.error!.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['lines', 'contactPhone', 'window']));
    // Testi nel modulo della compra (`checkout.validation.no_items`).
    expect(errors.error!.issues.find((issue) => issue.path[0] === 'lines')!.message).toBe(
      'checkout_no_items',
    );
    expect(
      marketplaceOrderSchema('MX').safeParse({
        ...valid,
        lines: [{ itemId: valid.lines[0]!.itemId, quantity: 51 }],
      }).success,
    ).toBe(false);
  });
});

describe('giorno della consegna', () => {
  const rules = { today, minLeadDays: 1, closedWeekdays: [0] };

  it("rispetta l'anticipo, il limite e i giorni di chiusura", () => {
    expect(earliestMarketplaceDate(today, 1)).toEqual({ year: 2026, month: 11, day: 24 });
    expect(marketplaceDateProblem(today, rules)).toBe('too_soon');
    expect(marketplaceDateProblem({ year: 2026, month: 11, day: 24 }, rules)).toBeNull();
    // Domenica 29: chiuso.
    expect(marketplaceDateProblem({ year: 2026, month: 11, day: 29 }, rules)).toBe('closed_day');
    expect(marketplaceDateProblem({ year: 2027, month: 2, day: 1 }, rules)).toBe('too_far');
    // Anticipo 0: anche oggi.
    expect(marketplaceDateProblem(today, { ...rules, minLeadDays: 0 })).toBeNull();
    expect(MARKETPLACE_DATE_ERRORS.closed_day).toBe('checkout_closed_day');
  });
});

describe('impostazioni degli ordini online', () => {
  it('anticipo fra 0 e 14 giorni; servono un modo di pagare e il telefono', async () => {
    const { onlineOrderSettingsSchema, onlineOrdersBlockers } = await import('../src/index');
    expect(onlineOrderSettingsSchema.parse({ ordersEnabled: 'on', minLeadDays: '0' })).toEqual({
      ordersEnabled: true,
      minLeadDays: 0,
    });
    expect(onlineOrderSettingsSchema.safeParse({ minLeadDays: '15' }).success).toBe(false);
    expect(onlineOrdersBlockers({ paymentMethods: [], contactPhone: null })).toEqual([
      'store_needs_payment',
      'store_needs_contact',
    ]);
    expect(
      onlineOrdersBlockers({ paymentMethods: ['CASH'], contactPhone: '+524495550101' }),
    ).toEqual([]);
  });
});

describe('«Aceptar pedido» con la consegna a 0 (M0)', () => {
  it('chiede la conferma solo a domicilio con il costo a 0', () => {
    expect(
      onlineOrderNeedsFreeDeliveryConfirmation({
        fulfillmentMode: 'DELIVERY',
        deliveryFeeMinor: 0,
      }),
    ).toBe(true);
    expect(
      onlineOrderNeedsFreeDeliveryConfirmation({
        fulfillmentMode: 'DELIVERY',
        deliveryFeeMinor: 9000,
      }),
    ).toBe(false);
    expect(
      onlineOrderNeedsFreeDeliveryConfirmation({ fulfillmentMode: 'PICKUP', deliveryFeeMinor: 0 }),
    ).toBe(false);
  });

  it('la casella del modulo: accesa solo con «on»', () => {
    expect(onlineOrderAcceptSchema.parse({ freeDeliveryConfirmed: 'on' })).toEqual({
      freeDeliveryConfirmed: true,
    });
    expect(onlineOrderAcceptSchema.parse({})).toEqual({ freeDeliveryConfirmed: false });
  });
});
