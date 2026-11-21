import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_MINOR,
  formatMoney,
  minorToDecimalString,
  multiplyMinor,
  parseMoneyInput,
  ratioInBasisPoints,
  sumMinor,
} from '../src/money';

describe('parseMoneyInput', () => {
  it.each([
    ['35', 3500],
    ['35.5', 3550],
    ['35.50', 3550],
    ['35,50', 3550],
    ['0', 0],
    ['0.01', 1],
    [' 1200.00 ', 120000],
  ])('converte %s in %i unità minime', (input, expected) => {
    expect(parseMoneyInput(input, 'MXN')).toEqual({ ok: true, minor: expected });
  });

  it('rifiuta input vuoto', () => {
    expect(parseMoneyInput('  ', 'MXN')).toEqual({ ok: false, error: 'required' });
  });

  it.each(['-5', '1,234.50', '$35', 'abc', '35.5.0', '1e3'])('rifiuta il formato %s', (input) => {
    expect(parseMoneyInput(input, 'MXN')).toEqual({ ok: false, error: 'invalid_money' });
  });

  it('rifiuta più decimali di quelli della valuta', () => {
    expect(parseMoneyInput('35.555', 'MXN')).toEqual({ ok: false, error: 'too_many_decimals' });
  });

  it('rifiuta importi oltre il tetto di sicurezza', () => {
    expect(parseMoneyInput('10000000.01', 'MXN')).toEqual({ ok: false, error: 'amount_too_large' });
    expect(parseMoneyInput('99999999999999', 'MXN')).toEqual({
      ok: false,
      error: 'amount_too_large',
    });
    expect(parseMoneyInput('10000000', 'MXN')).toEqual({ ok: true, minor: MAX_AMOUNT_MINOR });
  });
});

describe('minorToDecimalString / formatMoney', () => {
  it('produce un valore adatto agli input', () => {
    expect(minorToDecimalString(3550, 'MXN')).toBe('35.50');
    expect(minorToDecimalString(5, 'MXN')).toBe('0.05');
    expect(minorToDecimalString(0, 'EUR')).toBe('0.00');
  });

  it('formatta in pesos messicani', () => {
    expect(formatMoney(69000, 'MXN', 'es-MX')).toBe('$690.00');
  });

  it('formatta in euro per l’Italia', () => {
    // Intl usa uno spazio non separabile prima del simbolo.
    expect(formatMoney(199_00, 'EUR', 'it-IT').replace(/\s/g, ' ')).toBe('199,00 €');
  });

  it('rifiuta importi non interi', () => {
    expect(() => formatMoney(10.5, 'MXN', 'es-MX')).toThrow(TypeError);
  });
});

describe('aritmetica in unità minime', () => {
  it('moltiplica per quantità intere', () => {
    expect(multiplyMinor(3500, 12)).toBe(42000);
    expect(() => multiplyMinor(3500, 1.5)).toThrow(RangeError);
    expect(() => multiplyMinor(3500, -1)).toThrow(RangeError);
  });

  it('somma senza perdita di precisione', () => {
    // 0.1 + 0.2 in floating point ≠ 0.3: con unità minime è esatto.
    expect(sumMinor([10, 20])).toBe(30);
    expect(sumMinor([])).toBe(0);
  });

  it('calcola rapporti in basis points', () => {
    expect(ratioInBasisPoints(1, 3)).toBe(3333);
    expect(ratioInBasisPoints(50, 100)).toBe(5000);
    expect(ratioInBasisPoints(5, 0)).toBeNull();
  });
});
