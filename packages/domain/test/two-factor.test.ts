import { describe, expect, it } from 'vitest';
import {
  TWO_FACTOR_POLICY,
  describeUserAgent,
  normalizeTotpCode,
  twoFactorRequirement,
} from '../src/index';

/** Verifica in due passaggi (ADR-077): obbligatoria per i titolari con password dopo 14 giorni. */

const day = 24 * 60 * 60 * 1000;
const since = new Date('2026-11-10T12:00:00Z');

describe('quando è obbligatoria', () => {
  it('titolare con password: avviso con la data, poi blocca', () => {
    expect(TWO_FACTOR_POLICY.graceDays).toBe(14);
    const facts = { enabled: false, hasPassword: true, ownerSince: since };
    const before = twoFactorRequirement(facts, new Date(since.getTime() + 13 * day));
    expect(before).toMatchObject({ required: true, blocking: false });
    expect(before.deadline?.toISOString()).toBe('2026-11-24T12:00:00.000Z');
    expect(twoFactorRequirement(facts, new Date(since.getTime() + 14 * day)).blocking).toBe(true);
  });

  it('attiva, solo Google o non titolare: nessun obbligo', () => {
    const later = new Date(since.getTime() + 60 * day);
    expect(
      twoFactorRequirement({ enabled: true, hasPassword: true, ownerSince: since }, later),
    ).toMatchObject({ required: true, deadline: null, blocking: false });
    expect(
      twoFactorRequirement({ enabled: false, hasPassword: false, ownerSince: since }, later),
    ).toMatchObject({ required: false, deadline: null, blocking: false });
    expect(
      twoFactorRequirement({ enabled: false, hasPassword: true, ownerSince: null }, later),
    ).toMatchObject({ required: false, deadline: null, blocking: false });
  });

  it('il codice ha 6 cifre; spazi e trattini non contano', () => {
    expect(normalizeTotpCode(' 123 456 ')).toBe('123456');
    expect(normalizeTotpCode('123-456')).toBe('123456');
    expect(normalizeTotpCode('12345')).toBeNull();
    expect(normalizeTotpCode('abcdef')).toBeNull();
  });
});

describe('dispositivo della sessione', () => {
  it('riconosce i browser e i sistemi comuni', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      ),
    ).toEqual({ browser: 'Chrome', os: 'Android' });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', os: 'iPhone' });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
      ),
    ).toEqual({ browser: 'Edge', os: 'Windows' });
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0',
      ),
    ).toEqual({ browser: 'Firefox', os: 'Mac' });
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null });
    expect(describeUserAgent('curl/8.0')).toEqual({ browser: null, os: null });
  });
});
