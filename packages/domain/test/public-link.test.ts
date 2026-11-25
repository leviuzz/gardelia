import { describe, expect, it } from 'vitest';
import {
  ORDER_LINK_DAYS_AFTER_DELIVERY,
  PUBLIC_LINK_DAYS,
  orderLinkDeliveryExpiry,
  orderLinkExpiry,
  publicLinkExpiry,
} from '../src/index';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-25T18:00:00Z');

describe('scadenza del link di un ordine (M0)', () => {
  it('senza giorno di consegna, i soliti 60 giorni', () => {
    expect(orderLinkExpiry(now, null)).toEqual(publicLinkExpiry(now));
    expect(publicLinkExpiry(now).getTime() - now.getTime()).toBe(PUBLIC_LINK_DAYS * DAY);
  });

  it('una consegna vicina non accorcia i 60 giorni', () => {
    const delivery = new Date('2026-11-27T00:00:00Z');
    expect(orderLinkExpiry(now, delivery)).toEqual(publicLinkExpiry(now));
  });

  it('una consegna lontana tiene il link fino a 30 giorni dopo, giorno compreso', () => {
    const delivery = new Date('2027-01-20T00:00:00Z');
    const expiry = orderLinkExpiry(now, delivery);
    expect(expiry > publicLinkExpiry(now)).toBe(true);
    expect(expiry).toEqual(
      new Date(delivery.getTime() + (ORDER_LINK_DAYS_AFTER_DELIVERY + 1) * DAY),
    );
    // Il trentesimo giorno dopo la consegna il link vale ancora.
    const lastDay = new Date(delivery.getTime() + ORDER_LINK_DAYS_AFTER_DELIVERY * DAY);
    expect(lastDay < expiry).toBe(true);
    expect(orderLinkDeliveryExpiry(delivery)).toEqual(expiry);
  });
});
