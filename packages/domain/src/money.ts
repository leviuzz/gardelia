/**
 * Denaro in UNITÀ MINIME INTERE (es. centavos). Mai floating point per importi.
 * Le conversioni da/verso stringhe decimali avvengono solo ai bordi (form, visualizzazione).
 */

export const CURRENCIES = {
  MXN: { minorUnits: 2 },
  EUR: { minorUnits: 2 },
  USD: { minorUnits: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCIES, value);
}

/**
 * Tetto di sicurezza per un singolo importo (10.000.000,00 nella valuta):
 * resta ampiamente sotto il limite di un intero Postgres a 32 bit (2.147.483.647).
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000;

export type MoneyParseError = 'required' | 'invalid_money' | 'too_many_decimals' | 'amount_too_large';

export type MoneyParseResult =
  | { readonly ok: true; readonly minor: number }
  | { readonly ok: false; readonly error: MoneyParseError };

/**
 * Converte l'input di un form ("35", "35.5", "35,50") in unità minime.
 * Regole volutamente rigide e prevedibili:
 *  - separatore decimale "." oppure "," (uno solo);
 *  - nessun separatore delle migliaia e nessun simbolo di valuta;
 *  - nessun importo negativo;
 *  - al massimo `minorUnits` decimali.
 */
export function parseMoneyInput(input: string, currency: CurrencyCode): MoneyParseResult {
  const value = input.trim().replace(/\s+/g, '');
  if (value === '') return { ok: false, error: 'required' };
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(value);
  if (!match) return { ok: false, error: 'invalid_money' };

  const { minorUnits } = CURRENCIES[currency];
  const integerPart = match[1] ?? '0';
  const fractionPart = match[2] ?? '';
  if (fractionPart.length > minorUnits) return { ok: false, error: 'too_many_decimals' };
  if (integerPart.length > 12) return { ok: false, error: 'amount_too_large' };

  const minor =
    Number(integerPart) * 10 ** minorUnits + Number(fractionPart.padEnd(minorUnits, '0') || '0');
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) {
    return { ok: false, error: 'amount_too_large' };
  }
  return { ok: true, minor };
}

/** Rappresentazione decimale senza simbolo, adatta come valore iniziale di un input ("35.00"). */
export function minorToDecimalString(minor: number, currency: CurrencyCode): string {
  assertMinor(minor);
  const minorUnits: number = CURRENCIES[currency].minorUnits;
  if (minorUnits === 0) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const divisor = 10 ** minorUnits;
  const integerPart = Math.floor(abs / divisor);
  const fractionPart = String(abs % divisor).padStart(minorUnits, '0');
  return `${sign}${integerPart}.${fractionPart}`;
}

/** Formattazione localizzata, es. formatMoney(3550, 'MXN', 'es-MX') → "$35.50". */
export function formatMoney(minor: number, currency: CurrencyCode, locale: string): string {
  assertMinor(minor);
  const { minorUnits } = CURRENCIES[currency];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  }).format(minor / 10 ** minorUnits);
}

/** Prezzo unitario × quantità intera, con controllo di overflow. */
export function multiplyMinor(unitMinor: number, quantity: number): number {
  assertMinor(unitMinor);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`Quantità non valida: ${quantity}`);
  }
  const result = unitMinor * quantity;
  if (!Number.isSafeInteger(result)) throw new RangeError('Importo fuori intervallo');
  return result;
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    assertMinor(value);
    total += value;
  }
  if (!Number.isSafeInteger(total)) throw new RangeError('Importo fuori intervallo');
  return total;
}

/** Rapporto in basis points (1 bp = 0,01%), arrotondato all'intero più vicino. */
export function ratioInBasisPoints(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part * 10_000) / whole);
}

function assertMinor(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Importo non intero in unità minime: ${value}`);
  }
}
