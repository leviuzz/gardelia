import { describe, expect, it } from 'vitest';
import {
  canTransitionQuote,
  effectiveQuoteStatus,
  formatQuoteNumber,
  isQuoteEditable,
  parseDateInput,
  priceQuote,
  quoteDetailsSchema,
  quoteSettingsSchema,
} from '../src/quote';
import { toFieldErrors } from '../src/validation';

describe('motore prezzi v1', () => {
  it('7 rose + 5 tulipani + carta: totale coerente (BQ-01)', () => {
    const result = priceQuote({
      lines: [
        { quantity: 7, unitPriceMinor: 3500 },
        { quantity: 5, unitPriceMinor: 5500 },
        { quantity: 1, unitPriceMinor: 3000 },
      ],
      discountMinor: 0,
    });
    expect(result).toEqual({
      ok: true,
      lineTotals: [24500, 27500, 3000],
      subtotalMinor: 55000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 55000,
    });
  });

  it('applica lo sconto e rifiuta sconti superiori al subtotale', () => {
    const lines = [{ quantity: 2, unitPriceMinor: 10000 }];
    expect(priceQuote({ lines, discountMinor: 2500 })).toMatchObject({
      ok: true,
      totalMinor: 17500,
    });
    expect(priceQuote({ lines, discountMinor: 20001 })).toEqual({
      ok: false,
      error: 'discount_exceeds_subtotal',
    });
    expect(priceQuote({ lines: [], discountMinor: 0 })).toMatchObject({ ok: true, totalMinor: 0 });
  });

  it('rifiuta totali oltre il tetto di sicurezza', () => {
    expect(
      priceQuote({ lines: [{ quantity: 999, unitPriceMinor: 1_000_000_000 }], discountMinor: 0 }),
    ).toEqual({
      ok: false,
      error: 'amount_too_large',
    });
  });
});

describe('stati del preventivo', () => {
  it('consente solo le transizioni previste', () => {
    expect(canTransitionQuote('DRAFT', 'SENT')).toBe(true);
    expect(canTransitionQuote('DRAFT', 'ACCEPTED')).toBe(false);
    expect(canTransitionQuote('SENT', 'ACCEPTED')).toBe(true);
    expect(canTransitionQuote('SENT', 'DRAFT')).toBe(true);
    expect(canTransitionQuote('ACCEPTED', 'CANCELLED')).toBe(false);
    expect(canTransitionQuote('EXPIRED', 'SENT')).toBe(false);
    expect(isQuoteEditable('DRAFT')).toBe(true);
    expect(isQuoteEditable('SENT')).toBe(false);
  });

  it('un preventivo inviato scade il giorno dopo la validità', () => {
    const until = { year: 2026, month: 11, day: 28 };
    expect(effectiveQuoteStatus('SENT', until, { year: 2026, month: 11, day: 28 })).toBe('SENT');
    expect(effectiveQuoteStatus('SENT', until, { year: 2026, month: 11, day: 29 })).toBe('EXPIRED');
    expect(effectiveQuoteStatus('DRAFT', until, { year: 2027, month: 1, day: 1 })).toBe('DRAFT');
    expect(effectiveQuoteStatus('SENT', null, { year: 2030, month: 1, day: 1 })).toBe('SENT');
  });

  it('numera e valida le date', () => {
    expect(formatQuoteNumber(7)).toBe('COT-0007');
    expect(formatQuoteNumber(12345)).toBe('COT-12345');
    expect(parseDateInput('2026-02-29')).toBeNull();
    expect(parseDateInput('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseDateInput('29/02/2028')).toBeNull();
  });

  it('valida i dettagli del preventivo', () => {
    const schema = quoteDetailsSchema('MXN');
    expect(schema.parse({ title: '', notes: '', discount: '', validUntil: '' })).toEqual({
      title: null,
      notes: null,
      discount: 0,
      validUntil: null,
    });
    const invalid = schema.safeParse({ discount: '-5', validUntil: '2026-13-01' });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(toFieldErrors(invalid.error)).toMatchObject({
        discount: 'invalid_money',
        validUntil: 'invalid_date',
      });
    }
  });
});

describe('vigencia delle cotizaciones nuove', () => {
  it('da 1 a 90 giorni interi', () => {
    expect(quoteSettingsSchema.parse({ validityDays: ' 30 ' })).toEqual({ validityDays: 30 });
    expect(quoteSettingsSchema.parse({ validityDays: '1' }).validityDays).toBe(1);
    expect(quoteSettingsSchema.parse({ validityDays: '90' }).validityDays).toBe(90);
    const errorOf = (value: string) => {
      const result = quoteSettingsSchema.safeParse({ validityDays: value });
      return result.success ? null : toFieldErrors(result.error).validityDays;
    };
    expect(errorOf('')).toBe('required');
    expect(errorOf('0')).toBe('out_of_range');
    expect(errorOf('91')).toBe('out_of_range');
    expect(errorOf('siete')).toBe('invalid_number');
  });
});
