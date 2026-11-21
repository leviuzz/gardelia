/**
 * CRM [CRM-01]: clienti, indirizzi di consegna e ricorrenze.
 *
 * Regola di attribuzione (spec §3.2, §12.3): l'origine NETWORK_B2B / MARKETPLACE_B2C determina
 * le commissioni della piattaforma e viene impostata SOLO dalla piattaforma. Un fiorista crea
 * sempre clienti MERCHANT_DIRECT e può indicare solo il canale (Instagram, passaparola…).
 */
import { z } from 'zod';
import {
  MARKETS,
  isValidMexicanRfc,
  isValidPostalCode,
  normalizePhone,
  type MarketCountry,
} from './markets';
import {
  checkboxField,
  optionalEmail,
  optionalInteger,
  optionalText,
  requiredInteger,
  requiredText,
  tagsField,
  toTrimmedString,
} from './validation';

export const CUSTOMER_TYPES = ['PERSON', 'COMPANY'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const ACQUISITION_SOURCES = [
  'MERCHANT_DIRECT',
  'NETWORK_B2B',
  'MARKETPLACE_B2C',
  'IMPORT',
  'MANUAL',
] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

/** Origini che generano commissioni per la piattaforma (mai impostabili dal fiorista). */
export const PLATFORM_SOURCES: readonly AcquisitionSource[] = ['NETWORK_B2B', 'MARKETPLACE_B2C'];

export function isPlatformSource(source: AcquisitionSource): boolean {
  return PLATFORM_SOURCES.includes(source);
}

/** Canali con cui il fiorista ha conosciuto il cliente (informativi, nessun effetto sulle fee). */
export const ACQUISITION_CHANNELS = [
  'walk_in',
  'phone',
  'whatsapp',
  'instagram',
  'facebook',
  'website',
  'referral',
  'event',
  'other',
] as const;
export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

export const OCCASION_TYPES = ['BIRTHDAY', 'ANNIVERSARY', 'CUSTOM'] as const;
export type OccasionType = (typeof OCCASION_TYPES)[number];

export const CUSTOMER_LIMITS = {
  displayName: 120,
  legalName: 160,
  notes: 2000,
  preferences: 1000,
  restrictions: 1000,
  tags: 15,
  tagLength: 30,
  addressLabel: 40,
  recipientName: 120,
  deliveryNotes: 500,
  occasionLabel: 80,
  occasionNotes: 500,
  addressesPerCustomer: 20,
  occasionsPerCustomer: 30,
} as const;

export const CUSTOMER_PAGE_SIZE = 20;

function optionalPhoneField(country: MarketCountry) {
  return z.preprocess(
    toTrimmedString,
    z.string().transform((value, ctx) => {
      if (value === '') return null;
      const normalized = normalizePhone(value, country);
      if (normalized === null) {
        ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
        return z.NEVER;
      }
      return normalized;
    }),
  );
}

/** Input normalizzato di un cliente (accettato e rivalidato dai servizi). */
export const customerInputSchema = z.object({
  type: z.enum(CUSTOMER_TYPES, { error: 'invalid_option' }),
  displayName: z.string().trim().min(1, { error: 'required' }).max(CUSTOMER_LIMITS.displayName),
  legalName: z.string().trim().max(CUSTOMER_LIMITS.legalName).nullable(),
  taxId: z.string().trim().max(13).nullable(),
  email: z.email({ error: 'invalid_email' }).max(254).nullable(),
  phone: z
    .string()
    .regex(/^\+\d{8,15}$/, { error: 'invalid_phone' })
    .nullable(),
  notes: z.string().trim().max(CUSTOMER_LIMITS.notes).nullable(),
  preferences: z.string().trim().max(CUSTOMER_LIMITS.preferences).nullable(),
  restrictions: z.string().trim().max(CUSTOMER_LIMITS.restrictions).nullable(),
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(CUSTOMER_LIMITS.tagLength))
    .max(CUSTOMER_LIMITS.tags),
  acquisitionChannel: z.enum(ACQUISITION_CHANNELS, { error: 'invalid_option' }).nullable(),
  marketingConsent: z.boolean(),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export function customerFormSchema(country: MarketCountry) {
  return z
    .object({
      type: z.preprocess(toTrimmedString, z.enum(CUSTOMER_TYPES, { error: 'invalid_option' })),
      displayName: requiredText(CUSTOMER_LIMITS.displayName),
      legalName: optionalText(CUSTOMER_LIMITS.legalName),
      taxId: z.preprocess(
        (value) => {
          const trimmed = toTrimmedString(value);
          return typeof trimmed === 'string' ? trimmed.toUpperCase() : trimmed;
        },
        z.string().transform((value, ctx) => {
          if (value === '') return null;
          if (country === 'MX' && !isValidMexicanRfc(value)) {
            ctx.addIssue({ code: 'custom', message: 'invalid_tax_id' });
            return z.NEVER;
          }
          return value;
        }),
      ),
      email: optionalEmail(),
      phone: optionalPhoneField(country),
      notes: optionalText(CUSTOMER_LIMITS.notes),
      preferences: optionalText(CUSTOMER_LIMITS.preferences),
      restrictions: optionalText(CUSTOMER_LIMITS.restrictions),
      tags: tagsField(CUSTOMER_LIMITS.tags, CUSTOMER_LIMITS.tagLength),
      acquisitionChannel: z.preprocess(
        (value) => (value === '' || value === undefined ? null : value),
        z.enum(ACQUISITION_CHANNELS, { error: 'invalid_option' }).nullable(),
      ),
      marketingConsent: checkboxField(),
    })
    .pipe(customerInputSchema);
}

/** Filtri dell'elenco clienti (query string). */
export const customerListFiltersSchema = z.object({
  q: z.preprocess(toTrimmedString, z.string().max(80).catch('')),
  type: z.preprocess(toTrimmedString, z.enum(CUSTOMER_TYPES).nullable().catch(null)),
  status: z.preprocess(toTrimmedString, z.enum(['ACTIVE', 'ARCHIVED']).catch('ACTIVE')),
  page: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.int().min(1).max(10_000).catch(1),
  ),
});
export type CustomerListFilters = z.infer<typeof customerListFiltersSchema>;

// -----------------------------------------------------------------------------
// Indirizzi
// -----------------------------------------------------------------------------

export function customerAddressSchema(country: MarketCountry) {
  const market = MARKETS[country];
  return z.object({
    label: optionalText(CUSTOMER_LIMITS.addressLabel),
    recipientName: optionalText(CUSTOMER_LIMITS.recipientName),
    recipientPhone: optionalPhoneField(country),
    addressLine1: requiredText(160),
    addressLine2: optionalText(80),
    neighborhood: optionalText(120),
    city: requiredText(120),
    region: z.preprocess(
      toTrimmedString,
      z.string().refine((code) => market.isValidRegion(code), { error: 'invalid_option' }),
    ),
    postalCode: z.preprocess(
      toTrimmedString,
      z
        .string()
        .refine((code) => isValidPostalCode(country, code), { error: 'invalid_postal_code' }),
    ),
    deliveryNotes: optionalText(CUSTOMER_LIMITS.deliveryNotes),
    isDefault: checkboxField(),
  });
}
export type CustomerAddressInput = z.infer<ReturnType<typeof customerAddressSchema>>;

// -----------------------------------------------------------------------------
// Ricorrenze
// -----------------------------------------------------------------------------

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Giorno valido per il mese (il 29 febbraio è ammesso: ricorrenza degli anni bisestili). */
export function isValidMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12) return false;
  return day >= 1 && day <= (DAYS_IN_MONTH[month - 1] ?? 0);
}

export const occasionSchema = z
  .object({
    type: z.preprocess(toTrimmedString, z.enum(OCCASION_TYPES, { error: 'invalid_option' })),
    label: optionalText(CUSTOMER_LIMITS.occasionLabel),
    personName: optionalText(CUSTOMER_LIMITS.recipientName),
    month: requiredInteger({ min: 1, max: 12 }),
    day: requiredInteger({ min: 1, max: 31 }),
    year: optionalInteger({ min: 1900, max: 2100 }),
    remindDaysBefore: z.preprocess(
      (value) => (value === undefined || value === '' ? '7' : value),
      requiredInteger({ min: 0, max: 60 }),
    ),
    notes: optionalText(CUSTOMER_LIMITS.occasionNotes),
  })
  .superRefine((value, ctx) => {
    if (!isValidMonthDay(value.month, value.day)) {
      ctx.addIssue({ code: 'custom', path: ['day'], message: 'invalid_date' });
    }
    if (value.type === 'CUSTOM' && value.label === null) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'required' });
    }
  });
export type OccasionInput = z.infer<typeof occasionSchema>;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Data di oggi (anno, mese, giorno) nel fuso orario indicato. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface NextOccurrence {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** Giorni da oggi (0 = oggi), calcolati nel fuso del tenant. */
  readonly daysUntil: number;
}

/**
 * Prossima ricorrenza (oggi incluso) nel fuso del tenant. Il 29 febbraio, negli anni non
 * bisestili, viene ricordato il 28 febbraio.
 */
export function nextOccurrence(
  month: number,
  day: number,
  timeZone: string,
  now: Date = new Date(),
): NextOccurrence {
  const today = todayInTimeZone(timeZone, now);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  for (const year of [today.year, today.year + 1]) {
    const actualDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
    const candidate = Date.UTC(year, month - 1, actualDay);
    if (candidate >= todayUtc) {
      return {
        year,
        month,
        day: actualDay,
        daysUntil: Math.round((candidate - todayUtc) / MS_PER_DAY),
      };
    }
  }
  /* c8 ignore next */
  throw new Error('Ricorrenza non calcolabile');
}

/** Link "clic per chattare" di WhatsApp (nessun invio automatico: spec §5.2). */
export function whatsappLink(phoneE164: string, text?: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
