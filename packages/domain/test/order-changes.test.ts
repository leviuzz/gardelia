import { describe, expect, it } from 'vitest';
import {
  answerOrderChangeSchema,
  askOrderChangeSchema,
  diffOrderChanges,
  hasOrderChanges,
  orderChangeDeclined,
  orderChangeFields,
  orderChangeSnapshot,
  orderWaitsForBuyer,
  parseOrderChangeSnapshot,
  proposeOrderDateSchema,
  ORDER_CHANGE_LIMITS,
  type OrderChangeSource,
} from '../src/index';

/** Marketplace M3-2 «Cambi da confermare» (ADR-088). */

const ROSE = '0195b0a0-0000-7000-8000-000000000001';
const GLOBE = '0195b0a0-0000-7000-8000-000000000002';
const CUSTOM_LINE = '0195b0a0-0000-7000-8000-0000000000aa';

const source: OrderChangeSource = {
  fulfillmentMode: 'DELIVERY',
  scheduledDate: { year: 2026, month: 12, day: 2 },
  windowStartMinutes: 600,
  windowEndMinutes: 840,
  address: {
    line1: ' Av. Madero 120 ',
    line2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
  },
  lines: [
    {
      id: '0195b0a0-0000-7000-8000-0000000000b1',
      catalogItemId: ROSE,
      description: 'Ramo Clásico 12 rosas',
      quantity: 1,
      unitPriceMinor: 89000,
      lineTotalMinor: 89000,
    },
    {
      id: CUSTOM_LINE,
      catalogItemId: null,
      description: 'Tarjeta grande',
      quantity: 1,
      unitPriceMinor: 5000,
      lineTotalMinor: 5000,
    },
  ],
  subtotalMinor: 94000,
  discountMinor: 0,
  deliveryFeeMinor: 0,
  totalMinor: 94000,
};

describe('la fotografia dell’ordine', () => {
  it('tiene quello che chi compra vede: data ISO, indirizzo pulito, chiave del prodotto', () => {
    const snapshot = orderChangeSnapshot(source);
    expect(snapshot).toMatchObject({
      fulfillmentMode: 'DELIVERY',
      scheduledDate: '2026-12-02',
      windowStartMinutes: 600,
      windowEndMinutes: 840,
      address: { line1: 'Av. Madero 120', line2: null, neighborhood: 'Centro' },
      totalMinor: 94000,
    });
    // Un prodotto del catalogo si riconosce dal prodotto; una voce libera dalla sua riga.
    expect(snapshot.lines.map((line) => line.key)).toEqual([ROSE, CUSTOM_LINE]);
    expect(parseOrderChangeSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it('nel ritiro l’indirizzo non conta', () => {
    expect(orderChangeSnapshot({ ...source, fulfillmentMode: 'PICKUP' }).address).toBeNull();
  });

  it('una fotografia rovinata nel database non si legge', () => {
    expect(parseOrderChangeSnapshot({ lines: 'no' })).toBeNull();
    expect(parseOrderChangeSnapshot(null)).toBeNull();
  });
});

describe('i cambi fra prima e dopo', () => {
  const before = orderChangeSnapshot(source);

  it('niente cambi: uguale, anche con gli spazi dell’indirizzo diversi', () => {
    const same = orderChangeSnapshot({
      ...source,
      address: { ...source.address!, line1: 'Av. Madero 120' },
    });
    const diff = diffOrderChanges(before, same);
    expect(hasOrderChanges(diff)).toBe(false);
    expect(orderChangeFields(diff)).toEqual([]);
  });

  it('quantità, riga nuova, riga tolta, giorno, costo e totale', () => {
    const after = orderChangeSnapshot({
      ...source,
      scheduledDate: { year: 2026, month: 12, day: 3 },
      lines: [
        { ...source.lines[0]!, quantity: 2, lineTotalMinor: 178000 },
        {
          id: '0195b0a0-0000-7000-8000-0000000000b3',
          catalogItemId: GLOBE,
          description: 'Globo de corazón',
          quantity: 1,
          unitPriceMinor: 15000,
          lineTotalMinor: 15000,
        },
      ],
      subtotalMinor: 193000,
      deliveryFeeMinor: 12000,
      totalMinor: 205000,
    });
    const diff = diffOrderChanges(before, after);
    expect(diff.lines).toEqual([
      {
        change: 'changed',
        description: 'Ramo Clásico 12 rosas',
        before: { quantity: 1, unitPriceMinor: 89000, lineTotalMinor: 89000 },
        after: { quantity: 2, unitPriceMinor: 89000, lineTotalMinor: 178000 },
      },
      {
        change: 'added',
        description: 'Globo de corazón',
        before: null,
        after: { quantity: 1, unitPriceMinor: 15000, lineTotalMinor: 15000 },
      },
      {
        change: 'removed',
        description: 'Tarjeta grande',
        before: { quantity: 1, unitPriceMinor: 5000, lineTotalMinor: 5000 },
        after: null,
      },
    ]);
    expect(diff.schedule).toEqual({
      before: { date: '2026-12-02', windowStartMinutes: 600, windowEndMinutes: 840 },
      after: { date: '2026-12-03', windowStartMinutes: 600, windowEndMinutes: 840 },
    });
    expect(diff.deliveryFee).toEqual({ before: 0, after: 12000 });
    expect(diff.total).toEqual({ before: 94000, after: 205000 });
    expect(diff.discount).toBeNull();
    expect(orderChangeFields(diff)).toEqual(['lines', 'schedule', 'deliveryFee', 'total']);
  });

  it('due prodotti con lo stesso prezzo scambiati: il totale non cambia, ma è un cambio', () => {
    const after = orderChangeSnapshot({
      ...source,
      lines: [
        { ...source.lines[0]!, catalogItemId: GLOBE, description: 'Ramo Pastel' },
        source.lines[1]!,
      ],
    });
    const diff = diffOrderChanges(before, after);
    expect(diff.total).toBeNull();
    expect(diff.lines.map((line) => line.change)).toEqual(['added', 'removed']);
    expect(hasOrderChanges(diff)).toBe(true);
  });

  it('dalla consegna al ritiro: cambiano il modo e l’indirizzo', () => {
    const diff = diffOrderChanges(
      before,
      orderChangeSnapshot({ ...source, fulfillmentMode: 'PICKUP' }),
    );
    expect(diff.fulfillmentMode).toEqual({ before: 'DELIVERY', after: 'PICKUP' });
    expect(diff.address?.after).toBeNull();
    expect(orderChangeFields(diff)).toEqual(['fulfillmentMode', 'address']);
  });

  it('lo sconto', () => {
    const diff = diffOrderChanges(
      before,
      orderChangeSnapshot({ ...source, discountMinor: 4000, totalMinor: 90000 }),
    );
    expect(orderChangeFields(diff)).toEqual(['discount', 'total']);
  });
});

describe('chi deve fare qualcosa', () => {
  it('aspetta chi compra solo con la richiesta fatta; «No, gracias» torna alla fioreria', () => {
    expect(orderWaitsForBuyer('ASKED')).toBe(true);
    expect(orderWaitsForBuyer('EDITING')).toBe(false);
    expect(orderWaitsForBuyer('DECLINED')).toBe(false);
    expect(orderWaitsForBuyer(null)).toBe(false);
    expect(orderChangeDeclined('DECLINED')).toBe(true);
    expect(orderChangeDeclined('ASKED')).toBe(false);
  });
});

describe('moduli', () => {
  it('«Chiedi conferma»: messaggio facoltativo e consegna gratis', () => {
    expect(askOrderChangeSchema.parse({})).toEqual({ message: null, freeDeliveryConfirmed: false });
    expect(
      askOrderChangeSchema.parse({
        message: '  Te propongo otro día ',
        freeDeliveryConfirmed: 'on',
      }),
    ).toEqual({ message: 'Te propongo otro día', freeDeliveryConfirmed: true });
    const long = askOrderChangeSchema.safeParse({
      message: 'x'.repeat(ORDER_CHANGE_LIMITS.message + 1),
    });
    expect(long.error?.issues[0]?.message).toBe('too_long');
  });

  it('«Proponi un’altra data»: giorno obbligatorio, fascia intera e in ordine', () => {
    expect(
      proposeOrderDateSchema.parse({
        scheduledDate: '2026-12-04',
        windowStart: '16:00',
        windowEnd: '20:00',
      }),
    ).toMatchObject({
      scheduledDate: { year: 2026, month: 12, day: 4 },
      windowStart: 960,
      windowEnd: 1200,
      message: null,
    });
    expect(proposeOrderDateSchema.safeParse({ scheduledDate: '' }).error?.issues[0]?.message).toBe(
      'required',
    );
    expect(
      proposeOrderDateSchema.safeParse({ scheduledDate: '2026-12-04', windowStart: '16:00' }).error
        ?.issues[0]?.message,
    ).toBe('invalid_time_window');
    expect(
      proposeOrderDateSchema.safeParse({
        scheduledDate: '2026-12-04',
        windowStart: '20:00',
        windowEnd: '16:00',
      }).error?.issues[0]?.path,
    ).toEqual(['windowEnd']);
  });

  it('la risposta di chi compra porta la richiesta che ha visto', () => {
    expect(answerOrderChangeSchema.parse({ round: '2' })).toEqual({ round: 2, reason: null });
    expect(answerOrderChangeSchema.parse({ round: '1', reason: ' Prefiero el viernes ' })).toEqual({
      round: 1,
      reason: 'Prefiero el viernes',
    });
    expect(answerOrderChangeSchema.safeParse({ round: '' }).error?.issues[0]?.message).toBe(
      'invalid',
    );
    expect(answerOrderChangeSchema.safeParse({ round: 'abc' }).success).toBe(false);
    expect(
      answerOrderChangeSchema.safeParse({
        round: '1',
        reason: 'x'.repeat(ORDER_CHANGE_LIMITS.declineReason + 1),
      }).error?.issues[0]?.message,
    ).toBe('too_long');
  });
});
