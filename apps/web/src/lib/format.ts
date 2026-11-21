import { formatMoney, isCurrencyCode } from '@floral/domain';

/** Formatta un importo in unità minime nella valuta del tenant. */
export function money(minor: number, currency: string, locale = 'es-MX'): string {
  if (!isCurrencyCode(currency)) return String(minor);
  return formatMoney(minor, currency, locale);
}

/** Basis points → percentuale leggibile ("71.9 %"). */
export function percentFromBps(bps: number, locale = 'es-MX'): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
    bps / 10_000,
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
  return letters
    .map((part) => part?.[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Telefono E.164 messicano → formato nazionale leggibile per gli input ("449 555 0101"). */
export function phoneForInput(e164: string | null): string {
  if (!e164) return '';
  const match = /^\+52(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : e164;
}
