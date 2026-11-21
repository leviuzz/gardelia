/**
 * Onboarding e impostazioni della fioreria [CORE-01]: profilo, dati legali, sede.
 * Gli schemi sono parametrizzati per mercato; al lancio è abilitato solo il Messico.
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
  optionalEmail,
  optionalInteger,
  optionalText,
  requiredText,
  toTrimmedString,
} from './validation';

export const TENANT_LIMITS = {
  displayName: 80,
  legalName: 160,
  taxId: 13,
  addressLine1: 160,
  addressLine2: 80,
  neighborhood: 120,
  city: 120,
  deliveryRadiusKmMax: 200,
} as const;

function optionalPhone(country: MarketCountry) {
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

function optionalTaxId(country: MarketCountry) {
  return z.preprocess(
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
      if (value.length > TENANT_LIMITS.taxId) {
        ctx.addIssue({ code: 'custom', message: 'too_long' });
        return z.NEVER;
      }
      return value;
    }),
  );
}

/** Profilo operativo modificabile da OWNER e MANAGER. */
export function tenantProfileSchema(country: MarketCountry) {
  const market = MARKETS[country];
  return z.object({
    displayName: requiredText(TENANT_LIMITS.displayName),
    contactEmail: optionalEmail(),
    contactPhone: optionalPhone(country),
    timezone: z.preprocess(
      toTrimmedString,
      z.string().refine((tz) => (market.timezones as readonly string[]).includes(tz), {
        error: 'invalid_option',
      }),
    ),
  });
}
export type TenantProfileInput = z.infer<ReturnType<typeof tenantProfileSchema>>;

/** Dati legali/fiscali, modificabili solo dall'OWNER. Uso fiscale DA VALIDARE (spec §18.2). */
export function tenantLegalSchema(country: MarketCountry) {
  return z.object({
    legalName: optionalText(TENANT_LIMITS.legalName),
    taxId: optionalTaxId(country),
  });
}
export type TenantLegalInput = z.infer<ReturnType<typeof tenantLegalSchema>>;

/** Indirizzo strutturato della sede. */
export function locationSchema(country: MarketCountry) {
  const market = MARKETS[country];
  return z.object({
    addressLine1: requiredText(TENANT_LIMITS.addressLine1),
    addressLine2: optionalText(TENANT_LIMITS.addressLine2),
    neighborhood: optionalText(TENANT_LIMITS.neighborhood),
    city: requiredText(TENANT_LIMITS.city),
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
    phone: optionalPhone(country),
    deliveryRadiusKm: optionalInteger({ min: 0, max: TENANT_LIMITS.deliveryRadiusKmMax }),
  });
}
export type LocationInput = z.infer<ReturnType<typeof locationSchema>>;

/** Wizard di creazione fioreria: profilo + dati legali facoltativi + sede principale. */
export function onboardingSchema(country: MarketCountry) {
  return z.object({
    ...tenantProfileSchema(country).shape,
    ...tenantLegalSchema(country).shape,
    location: locationSchema(country),
  });
}
export type OnboardingInput = z.infer<ReturnType<typeof onboardingSchema>>;
