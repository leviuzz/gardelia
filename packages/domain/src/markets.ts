/**
 * Configurazione per Paese (mercato). Valuta, fuso, regioni, CAP e telefono sono
 * modellati per Paese e non concatenati in stringhe.
 *
 * Solo il Messico è abilitato al lancio (D-02). L'Italia è predisposta ma disattivata:
 * attivarla richiede traduzioni it-IT, regole fiscali validate e province complete.
 */
import type { CurrencyCode } from './money';

export const MX_REGIONS = [
  { code: 'AGU', name: 'Aguascalientes' },
  { code: 'BCN', name: 'Baja California' },
  { code: 'BCS', name: 'Baja California Sur' },
  { code: 'CAM', name: 'Campeche' },
  { code: 'CHP', name: 'Chiapas' },
  { code: 'CHH', name: 'Chihuahua' },
  { code: 'CMX', name: 'Ciudad de México' },
  { code: 'COA', name: 'Coahuila' },
  { code: 'COL', name: 'Colima' },
  { code: 'DUR', name: 'Durango' },
  { code: 'GUA', name: 'Guanajuato' },
  { code: 'GRO', name: 'Guerrero' },
  { code: 'HID', name: 'Hidalgo' },
  { code: 'JAL', name: 'Jalisco' },
  { code: 'MEX', name: 'Estado de México' },
  { code: 'MIC', name: 'Michoacán' },
  { code: 'MOR', name: 'Morelos' },
  { code: 'NAY', name: 'Nayarit' },
  { code: 'NLE', name: 'Nuevo León' },
  { code: 'OAX', name: 'Oaxaca' },
  { code: 'PUE', name: 'Puebla' },
  { code: 'QUE', name: 'Querétaro' },
  { code: 'ROO', name: 'Quintana Roo' },
  { code: 'SLP', name: 'San Luis Potosí' },
  { code: 'SIN', name: 'Sinaloa' },
  { code: 'SON', name: 'Sonora' },
  { code: 'TAB', name: 'Tabasco' },
  { code: 'TAM', name: 'Tamaulipas' },
  { code: 'TLA', name: 'Tlaxcala' },
  { code: 'VER', name: 'Veracruz' },
  { code: 'YUC', name: 'Yucatán' },
  { code: 'ZAC', name: 'Zacatecas' },
] as const;

/**
 * Fusi orari IANA del Messico (dopo la riforma 2022 che ha abolito l'ora legale,
 * salvo la frontiera nord). Le etichette visualizzate sono nei file di traduzione.
 */
export const MX_TIMEZONES = [
  'America/Mexico_City',
  'America/Cancun',
  'America/Mazatlan',
  'America/Hermosillo',
  'America/Tijuana',
  'America/Matamoros',
  'America/Ciudad_Juarez',
] as const;

export interface MarketConfig {
  readonly country: string;
  readonly currency: CurrencyCode;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly timezones: readonly string[];
  readonly enabled: boolean;
  readonly phoneCountryCode: string;
  readonly nationalPhoneDigits: number;
  readonly postalCodePattern: RegExp;
  isValidRegion(code: string): boolean;
}

export const MARKETS = {
  MX: {
    country: 'MX',
    currency: 'MXN',
    defaultLocale: 'es-MX',
    defaultTimezone: 'America/Mexico_City',
    timezones: MX_TIMEZONES,
    enabled: true,
    phoneCountryCode: '52',
    nationalPhoneDigits: 10,
    postalCodePattern: /^\d{5}$/,
    isValidRegion: (code: string) => MX_REGIONS.some((region) => region.code === code),
  },
  IT: {
    country: 'IT',
    currency: 'EUR',
    defaultLocale: 'it-IT',
    defaultTimezone: 'Europe/Rome',
    timezones: ['Europe/Rome'],
    enabled: false,
    phoneCountryCode: '39',
    nationalPhoneDigits: 10,
    postalCodePattern: /^\d{5}$/,
    // Sigla provincia (es. "MI"). Elenco completo da aggiungere quando il mercato viene attivato.
    isValidRegion: (code: string) => /^[A-Z]{2}$/.test(code),
  },
} as const satisfies Record<string, MarketConfig>;

export type MarketCountry = keyof typeof MARKETS;

export const ENABLED_MARKETS = (Object.keys(MARKETS) as MarketCountry[]).filter(
  (country) => MARKETS[country].enabled,
);

export function isMarketCountry(value: string): value is MarketCountry {
  return Object.hasOwn(MARKETS, value);
}

export function getMarket(country: string): MarketConfig {
  if (!isMarketCountry(country)) throw new RangeError(`Mercato non supportato: ${country}`);
  return MARKETS[country];
}

export function isValidPostalCode(country: MarketCountry, postalCode: string): boolean {
  return MARKETS[country].postalCodePattern.test(postalCode.trim());
}

/**
 * Normalizza un numero di telefono in E.164 per il Paese indicato.
 * Messico: 10 cifre nazionali; accetta prefissi +52 / 52 e il vecchio "1" dei cellulari.
 * Restituisce null se il numero non è riconoscibile.
 */
export function normalizePhone(input: string, country: MarketCountry): string | null {
  const market = MARKETS[country];
  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) return null;

  let national = digits;
  if (national.startsWith(market.phoneCountryCode)) {
    const rest = national.slice(market.phoneCountryCode.length);
    if (rest.length === market.nationalPhoneDigits) national = rest;
    else if (country === 'MX' && rest.length === 11 && rest.startsWith('1')) national = rest.slice(1);
  }
  if (national.length !== market.nationalPhoneDigits) return null;
  return `+${market.phoneCountryCode}${national}`;
}

/** Formato RFC messicano (persona morale 12 caratteri, persona física 13). Validazione solo sintattica. */
export function isValidMexicanRfc(value: string): boolean {
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(value.trim().toUpperCase());
}
