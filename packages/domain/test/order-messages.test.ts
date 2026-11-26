import { describe, expect, it } from 'vitest';
import {
  ORDER_MESSAGE_LIMITS,
  hasOrderThread,
  isOrderClosed,
  orderMessagePages,
  orderMessageProblem,
  orderMessageSchema,
  orderMessagesOpen,
  orderPhotosPurgeAfter,
  orderStepNotice,
  shouldSendMessageNotice,
} from '../src/index';

/**
 * Messaggi degli ordini online (M3-1, ADR-088): quando si scrive, quando parte l'avviso per email,
 * quando si cancellano le foto, quali passi avvisano chi compra.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = new Date('2026-11-26T18:00:00Z');

const online = {
  status: 'CONFIRMED' as const,
  statusChangedAt: new Date('2026-11-25T18:00:00Z'),
  placedOnline: true,
  buyerUserId: '0194d8a4-1b2c-7d3e-8f40-123456789abc',
};

describe('pagine del filo', () => {
  it('dall’indirizzo, da 1 al massimo di Floral Care', () => {
    expect(ORDER_MESSAGE_LIMITS.maxPages).toBe(20);
    expect(orderMessagePages(undefined)).toBe(1);
    expect(orderMessagePages('3')).toBe(3);
    expect(orderMessagePages('99')).toBe(ORDER_MESSAGE_LIMITS.maxPages);
    expect(orderMessagePages('-2')).toBe(1);
  });
});

describe('quando si scrive', () => {
  it('solo sugli ordini online di un conto che esiste ancora', () => {
    expect(hasOrderThread(online)).toBe(true);
    expect(hasOrderThread({ ...online, placedOnline: false })).toBe(false);
    expect(hasOrderThread({ ...online, buyerUserId: null })).toBe(false);
    expect(orderMessagesOpen({ ...online, buyerUserId: null }, now)).toBe(false);
  });

  it("dall'invio, mai su una bozza; dopo la chiusura per 7 giorni", () => {
    expect(orderMessagesOpen({ ...online, status: 'PENDING_ACCEPTANCE' }, now)).toBe(true);
    expect(orderMessagesOpen({ ...online, status: 'OUT_FOR_DELIVERY' }, now)).toBe(true);
    expect(orderMessagesOpen({ ...online, status: 'DRAFT' }, now)).toBe(false);
    for (const status of ['DELIVERED', 'PICKED_UP', 'CANCELLED'] as const) {
      expect(isOrderClosed(status)).toBe(true);
      const closedAt = new Date(now.getTime() - ORDER_MESSAGE_LIMITS.writeDaysAfterClose * DAY);
      expect(orderMessagesOpen({ ...online, status, statusChangedAt: closedAt }, now)).toBe(true);
      const tooOld = new Date(closedAt.getTime() - 1);
      expect(orderMessagesOpen({ ...online, status, statusChangedAt: tooOld }, now)).toBe(false);
    }
  });

  it('serve il testo o la foto, e il filo aperto', () => {
    expect(orderMessageProblem({ order: online, body: '  ', hasPhoto: false, now })).toBe(
      'order_message_empty',
    );
    expect(orderMessageProblem({ order: online, body: '', hasPhoto: true, now })).toBeNull();
    expect(orderMessageProblem({ order: online, body: 'Hola', hasPhoto: false, now })).toBeNull();
    expect(
      orderMessageProblem({
        order: {
          ...online,
          status: 'CANCELLED',
          statusChangedAt: new Date(now.getTime() - 8 * DAY),
        },
        body: 'Hola',
        hasPhoto: false,
        now,
      }),
    ).toBe('order_message_closed');
  });

  it('il modulo: al massimo 2000 caratteri e la chiave dell’invio', () => {
    const submitKey = '0194d8a4-1b2c-7d3e-8f40-123456789abc';
    expect(orderMessageSchema.safeParse({ body: ' Hola ', submitKey }).data).toEqual({
      body: 'Hola',
      submitKey,
    });
    expect(
      orderMessageSchema.safeParse({ body: 'a'.repeat(ORDER_MESSAGE_LIMITS.body + 1), submitKey })
        .success,
    ).toBe(false);
    expect(orderMessageSchema.safeParse({ body: 'Hola', submitKey: 'x' }).success).toBe(false);
  });
});

describe("l'avviso per email all'altra parte", () => {
  it('al primo messaggio da leggere', () => {
    expect(shouldSendMessageNotice({ unreadBefore: 0, lastNoticeAt: now, now })).toBe(true);
  });

  it('con altri ancora da leggere, di nuovo solo dopo 6 ore', () => {
    const recent = new Date(now.getTime() - (ORDER_MESSAGE_LIMITS.renoticeHours * HOUR - 1));
    expect(shouldSendMessageNotice({ unreadBefore: 2, lastNoticeAt: recent, now })).toBe(false);
    const old = new Date(now.getTime() - ORDER_MESSAGE_LIMITS.renoticeHours * HOUR);
    expect(shouldSendMessageNotice({ unreadBefore: 2, lastNoticeAt: old, now })).toBe(true);
  });

  it('senza nessun avviso precedente parte comunque', () => {
    expect(shouldSendMessageNotice({ unreadBefore: 3, lastNoticeAt: null, now })).toBe(true);
  });
});

describe('quando si cancellano le foto dei messaggi', () => {
  it('30 giorni dopo la chiusura', () => {
    const closedAt = new Date('2026-11-01T10:00:00Z');
    expect(
      orderPhotosPurgeAfter(
        { status: 'DELIVERED', statusChangedAt: closedAt, scheduledDate: null },
        'America/Mexico_City',
      ),
    ).toEqual(new Date(closedAt.getTime() + 30 * DAY));
  });

  it('un ordine rimasto aperto: 30 giorni dopo la fine del suo giorno, nel fuso della fioreria', () => {
    const after = orderPhotosPurgeAfter(
      {
        status: 'CONFIRMED',
        statusChangedAt: new Date('2026-10-01T10:00:00Z'),
        scheduledDate: { year: 2026, month: 10, day: 5 },
      },
      'America/Mexico_City',
    );
    // Fine del 5 ottobre a Città del Messico (UTC−6) = 6 ottobre 06:00 UTC.
    expect(after).toEqual(new Date(Date.UTC(2026, 9, 6, 6) + 30 * DAY));
  });

  it('aperto e senza giorno: non ancora', () => {
    expect(
      orderPhotosPurgeAfter(
        { status: 'CONFIRMED', statusChangedAt: now, scheduledDate: null },
        'America/Mexico_City',
      ),
    ).toBeNull();
  });
});

describe('i passi che avvisano chi compra', () => {
  it('in preparazione, pronto per il ritiro, in consegna, consegnato', () => {
    expect(orderStepNotice('IN_PREPARATION', 'DELIVERY')).toBe('STEP_IN_PREPARATION');
    expect(orderStepNotice('READY', 'PICKUP')).toBe('STEP_READY_PICKUP');
    expect(orderStepNotice('OUT_FOR_DELIVERY', 'DELIVERY')).toBe('STEP_OUT_FOR_DELIVERY');
    expect(orderStepNotice('DELIVERED', 'DELIVERY')).toBe('STEP_DELIVERED');
  });

  it('niente per «Pronto» di una consegna, per il ritiro fatto e per gli altri stati', () => {
    expect(orderStepNotice('READY', 'DELIVERY')).toBeNull();
    expect(orderStepNotice('PICKED_UP', 'PICKUP')).toBeNull();
    expect(orderStepNotice('CONFIRMED', 'DELIVERY')).toBeNull();
    expect(orderStepNotice('CANCELLED', 'DELIVERY')).toBeNull();
  });
});
