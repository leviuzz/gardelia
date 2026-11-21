import { describe, expect, it } from 'vitest';
import {
  NO_ENTITLEMENTS,
  isPlanCode,
  isSubscriptionStatus,
  parseEntitlements,
  subscriptionGrantsAccess,
} from '../src/plans';

describe('entitlements dei piani', () => {
  it('legge gli entitlements validi dal JSON del database', () => {
    expect(parseEntitlements({ bouquetBuilder: true, aiPreviewsPerMonth: 25 })).toEqual({
      bouquetBuilder: true,
      aiPreviewsPerMonth: 25,
    });
  });

  it('fail closed: valori mancanti o malformati non danno accesso', () => {
    expect(parseEntitlements(null)).toEqual(NO_ENTITLEMENTS);
    expect(parseEntitlements('PLUS')).toEqual(NO_ENTITLEMENTS);
    expect(parseEntitlements([])).toEqual(NO_ENTITLEMENTS);
    expect(parseEntitlements({})).toEqual(NO_ENTITLEMENTS);
    expect(parseEntitlements({ bouquetBuilder: 'yes', aiPreviewsPerMonth: -3 })).toEqual(
      NO_ENTITLEMENTS,
    );
    expect(parseEntitlements({ bouquetBuilder: true, aiPreviewsPerMonth: 2.5 })).toEqual({
      bouquetBuilder: true,
      aiPreviewsPerMonth: 0,
    });
  });
});

describe('stato dell’abbonamento', () => {
  const now = new Date('2026-11-21T12:00:00Z');

  it('pilota, prova e attivo danno accesso; cancellato no', () => {
    for (const status of ['PILOT', 'TRIALING', 'ACTIVE'] as const) {
      expect(subscriptionGrantsAccess({ status, currentPeriodEnd: null }, now)).toBe(true);
    }
    expect(subscriptionGrantsAccess({ status: 'CANCELLED', currentPeriodEnd: null }, now)).toBe(
      false,
    );
  });

  it('a periodo terminato l’accesso decade (anche esattamente alla scadenza)', () => {
    const ended = new Date('2026-11-21T11:59:59Z');
    expect(subscriptionGrantsAccess({ status: 'ACTIVE', currentPeriodEnd: ended }, now)).toBe(
      false,
    );
    expect(subscriptionGrantsAccess({ status: 'PILOT', currentPeriodEnd: now }, now)).toBe(false);
    const future = new Date('2026-12-21T12:00:00Z');
    expect(subscriptionGrantsAccess({ status: 'TRIALING', currentPeriodEnd: future }, now)).toBe(
      true,
    );
  });

  it('riconosce solo codici e stati noti', () => {
    expect(isPlanCode('PLUS')).toBe(true);
    expect(isPlanCode('plus')).toBe(false);
    expect(isSubscriptionStatus('PILOT')).toBe(true);
    expect(isSubscriptionStatus('PAST_DUE')).toBe(false);
  });
});
