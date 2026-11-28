/**
 * Marketplace M5 «Servizi in vetrina e richieste» (ADR-089): i servizi che la fioreria mette nella
 * sua vetrina (i predefiniti «Eventos y bodas», «Decoración de espacios», «Flores cada semana»,
 * «Floral Care» e quelli che scrive lei) e le richieste di chi compra, una per servizio, con un
 * modulo adatto al tipo. Regole pure: i servizi le applicano sotto il lock e le ripetono il database
 * (CHECK) dove serve.
 */
import { z } from 'zod';
import { addDays, addMonths, compareDates, type CalendarDate } from './calendar';
import { optionalPhoneField } from './customer';
import type { MarketCountry } from './markets';
import type { CurrencyCode } from './money';
import { CARE_FREQUENCIES } from './floral-care';
import { orderDateField, optionalUuidField, parseTimeInput, paymentDateField } from './order';
import {
  checkboxField,
  optionalMoneyField,
  optionalText,
  requiredInteger,
  requiredText,
  toTrimmedString,
} from './validation';

// -----------------------------------------------------------------------------
// I servizi della vetrina
// -----------------------------------------------------------------------------

/**
 * I tipi di servizio: quattro predefiniti (uno per fioreria, il nome lo traduciamo noi) e quelli
 * della fioreria (`CUSTOM`, con il nome che scrive lei).
 */
export const STOREFRONT_SERVICE_KINDS = ['EVENT', 'VENUE', 'WEEKLY', 'CARE', 'CUSTOM'] as const;
export type StorefrontServiceKind = (typeof STOREFRONT_SERVICE_KINDS)[number];

/** I predefiniti, nell'ordine in cui la vetrina li propone. */
export const STOREFRONT_SERVICE_PRESETS = [
  'EVENT',
  'VENUE',
  'WEEKLY',
  'CARE',
] as const satisfies readonly StorefrontServiceKind[];
export type StorefrontServicePreset = (typeof STOREFRONT_SERVICE_PRESETS)[number];

export function isPresetServiceKind(kind: StorefrontServiceKind): kind is StorefrontServicePreset {
  return (STOREFRONT_SERVICE_PRESETS as readonly string[]).includes(kind);
}

/**
 * I nomi dei predefiniti nella lingua del mercato (Messico): li usano le email e l'esportazione;
 * la vetrina e l'app li prendono dai testi nelle tre lingue.
 */
export const STOREFRONT_SERVICE_PRESET_NAMES_ES: Readonly<Record<StorefrontServicePreset, string>> =
  {
    EVENT: 'Eventos y bodas',
    VENUE: 'Decoración de espacios',
    WEEKLY: 'Flores cada semana',
    CARE: 'Floral Care',
  };

export const STOREFRONT_SERVICE_LIMITS = {
  name: 80,
  description: 600,
  includes: 600,
  /** Foto per servizio, come una galleria piccola. */
  photos: 6,
  /** Servizi scritti dalla fioreria (oltre ai quattro predefiniti). */
  customPerShop: 20,
} as const;

/** Il nome che vede chi compra: quello dei predefiniti (dato dalla lingua) o quello scritto. */
export function storefrontServiceDisplayName(service: {
  readonly kind: StorefrontServiceKind;
  readonly name: string | null;
}): string {
  if (isPresetServiceKind(service.kind)) return STOREFRONT_SERVICE_PRESET_NAMES_ES[service.kind];
  return service.name ?? '';
}

/**
 * I testi di un servizio (Impostazioni → Negozio online → «Servizi in vetrina»). Il nome solo per un
 * servizio della fioreria; data e indirizzo «chiesti» solo per quelli (i predefiniti hanno il loro
 * modulo). I testi li leggono i clienti: nella lingua del mercato, senza traduzioni.
 */
export function storefrontServiceSchema(currency: CurrencyCode, kind: StorefrontServiceKind) {
  return z.object({
    name:
      kind === 'CUSTOM'
        ? requiredText(STOREFRONT_SERVICE_LIMITS.name)
        : z
            .unknown()
            .optional()
            .transform(() => null),
    description: optionalText(STOREFRONT_SERVICE_LIMITS.description),
    includes: optionalText(STOREFRONT_SERVICE_LIMITS.includes),
    priceFrom: optionalMoneyField(currency),
    askDate:
      kind === 'CUSTOM'
        ? checkboxField()
        : z
            .unknown()
            .optional()
            .transform(() => false),
    askAddress:
      kind === 'CUSTOM'
        ? checkboxField()
        : z
            .unknown()
            .optional()
            .transform(() => false),
  });
}
export type StorefrontServiceInput = z.infer<ReturnType<typeof storefrontServiceSchema>>;

/** Perché un servizio non si può pubblicare; null = si può. */
export function storefrontServicePublishProblem(input: {
  readonly kind: StorefrontServiceKind;
  /** Per Floral Care: tariffe salvate e almeno una fascia di visita. */
  readonly careReady: boolean;
}): 'service_care_not_ready' | null {
  return input.kind === 'CARE' && !input.careReady ? 'service_care_not_ready' : null;
}

// -----------------------------------------------------------------------------
// Le richieste di chi compra
// -----------------------------------------------------------------------------

export const SERVICE_REQUEST_STATUSES = [
  /** Appena arrivata: la fioreria non ha ancora risposto. */
  'NEW',
  /** La fioreria ha mandato un preventivo (M5-2). */
  'QUOTED',
  /** Chi compra ha accettato il preventivo (M5-2). */
  'ACCEPTED',
  /** La fioreria non può (con un motivo). */
  'DECLINED',
  /** Chi compra l'ha annullata. */
  'CANCELLED',
  /** Chiusa dalla fioreria dopo il lavoro (M5-2). */
  'CLOSED',
] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

export const SERVICE_REQUEST_LIMITS = {
  message: 1000,
  place: 200,
  photos: 3,
  /** Richieste aperte (nuove o con preventivo) per persona e fioreria. */
  openPerBuyer: 5,
  guestsMax: 5000,
  plantsMax: 500,
  /** Da domani fino a 12 mesi. */
  monthsAhead: 12,
  declineDetail: 300,
} as const;

/** Aperta: la fioreria deve ancora rispondere o chi compra deve ancora decidere. */
export function isServiceRequestOpen(status: ServiceRequestStatus): boolean {
  return status === 'NEW' || status === 'QUOTED';
}

/** «Cancelar solicitud» di chi compra: finché è aperta. */
export function canBuyerCancelServiceRequest(status: ServiceRequestStatus): boolean {
  return isServiceRequestOpen(status);
}

/** «Rifiuta» della fioreria: finché è aperta. */
export function canShopDeclineServiceRequest(status: ServiceRequestStatus): boolean {
  return isServiceRequestOpen(status);
}

/** «SOL-0003»: il numero della richiesta, progressivo per fioreria. */
export function formatServiceRequestNumber(number: number): string {
  return `SOL-${String(number).padStart(4, '0')}`;
}

export const EVENT_TYPES = ['WEDDING', 'XV', 'BAPTISM', 'CORPORATE', 'OTHER'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const VENUE_TYPES = ['RESTAURANT', 'HOTEL', 'OFFICE', 'SHOP', 'OTHER'] as const;
export type VenueType = (typeof VENUE_TYPES)[number];
export const VENUE_RECURRENCES = ['ONCE', 'RECURRING'] as const;
export type VenueRecurrence = (typeof VENUE_RECURRENCES)[number];
export const WEEKLY_DURATIONS = ['ONE_MONTH', 'THREE_MONTHS', 'SIX_MONTHS', 'OPEN'] as const;
export type WeeklyDuration = (typeof WEEKLY_DURATIONS)[number];

/** Il giorno della settimana per «Flores cada semana»: 0 = domenica … 6 = sabato. */
const weekdayField = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
  z
    .int({ error: 'required' })
    .min(0, { error: 'invalid_option' })
    .max(6, { error: 'invalid_option' }),
);

/** "HH:MM-HH:MM" facoltativa (vuoto = qualsiasi ora). */
const optionalWindowField = z.preprocess(
  toTrimmedString,
  z.string().transform((value, ctx) => {
    if (value === '') return null;
    const [start, end] = value.split('-').map((part) => parseTimeInput(part));
    if (start === null || end === null || start === undefined || end === undefined) {
      ctx.addIssue({ code: 'custom', message: 'invalid_option' });
      return z.NEVER;
    }
    if (start >= end) {
      ctx.addIssue({ code: 'custom', message: 'invalid_time_window' });
      return z.NEVER;
    }
    return { start, end };
  }),
);

function enumField<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(toTrimmedString, z.enum(values, { error: 'required' }));
}

const requiredPhoneField = (country: MarketCountry) =>
  optionalPhoneField(country).refine((value) => value !== null, { error: 'required' });

/** Le parti comuni a ogni richiesta. */
function commonFields(country: MarketCountry, messageRequired: boolean) {
  return {
    message: messageRequired
      ? requiredText(SERVICE_REQUEST_LIMITS.message)
      : optionalText(SERVICE_REQUEST_LIMITS.message),
    contactPhone: requiredPhoneField(country),
    /** La chiave del modulo: lo stesso invio due volte non scrive due richieste. */
    submitKey: z.preprocess(toTrimmedString, z.uuid({ error: 'required' })),
  };
}

/** Il servizio che si chiede (solo quello che serve al modulo). */
export interface RequestedService {
  readonly kind: StorefrontServiceKind;
  readonly askDate: boolean;
  readonly askAddress: boolean;
}

/** Il modulo chiede un indirizzo (salvato nel conto o nuovo, validato a parte dal servizio). */
export function serviceRequestNeedsAddress(service: RequestedService): boolean {
  switch (service.kind) {
    case 'VENUE':
    case 'WEEKLY':
    case 'CARE':
      return true;
    case 'EVENT':
      return false;
    case 'CUSTOM':
      return service.askAddress;
  }
}

/**
 * Il modulo della richiesta, per tipo. Le date si controllano a parte (`serviceRequestDateProblem`:
 * dipendono da oggi nel fuso della fioreria). L'indirizzo: `buyerAddressId` (uno salvato nel conto)
 * o i campi di un indirizzo nuovo, validati dal servizio con lo schema della rubrica.
 */
export function serviceRequestSchema(
  service: RequestedService,
  country: MarketCountry,
  currency: CurrencyCode,
) {
  const budget = optionalMoneyField(currency);
  switch (service.kind) {
    case 'EVENT':
      return z.object({
        ...commonFields(country, false),
        kind: z.literal('EVENT').default('EVENT'),
        date: orderDateField,
        eventType: enumField(EVENT_TYPES),
        guests: requiredInteger({ min: 1, max: SERVICE_REQUEST_LIMITS.guestsMax }),
        place: requiredText(SERVICE_REQUEST_LIMITS.place),
        budget,
      });
    case 'VENUE':
      return z.object({
        ...commonFields(country, false),
        kind: z.literal('VENUE').default('VENUE'),
        buyerAddressId: optionalUuidField,
        date: orderDateField,
        venueType: enumField(VENUE_TYPES),
        recurrence: enumField(VENUE_RECURRENCES),
        budget,
      });
    case 'WEEKLY':
      return z.object({
        ...commonFields(country, false),
        kind: z.literal('WEEKLY').default('WEEKLY'),
        buyerAddressId: optionalUuidField,
        date: orderDateField,
        weekday: weekdayField,
        window: optionalWindowField,
        duration: enumField(WEEKLY_DURATIONS),
        budget,
      });
    case 'CARE':
      return z.object({
        ...commonFields(country, false),
        kind: z.literal('CARE').default('CARE'),
        buyerAddressId: optionalUuidField,
        plants: requiredInteger({ min: 1, max: SERVICE_REQUEST_LIMITS.plantsMax }),
        frequency: enumField(CARE_FREQUENCIES),
      });
    case 'CUSTOM':
      return z.object({
        ...commonFields(country, true),
        kind: z.literal('CUSTOM').default('CUSTOM'),
        buyerAddressId: optionalUuidField,
        // Data facoltativa, e solo se il servizio la chiede.
        date: service.askDate
          ? paymentDateField()
          : z
              .unknown()
              .optional()
              .transform(() => null),
        budget,
      });
  }
}
export type ServiceRequestInput = z.infer<ReturnType<typeof serviceRequestSchema>>;

/** Da domani a 12 mesi: la fioreria deve avere il tempo di rispondere. */
export function serviceRequestDateProblem(
  date: CalendarDate | null,
  today: CalendarDate,
): 'service_date_too_soon' | 'service_date_too_far' | null {
  if (!date) return null;
  if (compareDates(date, addDays(today, 1)) < 0) return 'service_date_too_soon';
  if (compareDates(date, addMonths(today, SERVICE_REQUEST_LIMITS.monthsAhead)) > 0) {
    return 'service_date_too_far';
  }
  return null;
}

/**
 * Le risposte che vanno nel JSON della richiesta (quello che non ha una colonna sua): tipo di evento,
 * invitati e luogo, tipo di locale e ricorrenza, giorno, fascia e durata, piante e frequenza.
 */
export const serviceRequestAnswersSchema = z
  .object({
    eventType: z.enum(EVENT_TYPES).optional(),
    guests: z.int().min(1).max(SERVICE_REQUEST_LIMITS.guestsMax).optional(),
    place: z.string().max(SERVICE_REQUEST_LIMITS.place).optional(),
    venueType: z.enum(VENUE_TYPES).optional(),
    recurrence: z.enum(VENUE_RECURRENCES).optional(),
    weekday: z.int().min(0).max(6).optional(),
    windowStartMinutes: z.int().min(0).max(1440).optional(),
    windowEndMinutes: z.int().min(0).max(1440).optional(),
    duration: z.enum(WEEKLY_DURATIONS).optional(),
    plants: z.int().min(1).max(SERVICE_REQUEST_LIMITS.plantsMax).optional(),
    frequency: z.enum(CARE_FREQUENCIES).optional(),
  })
  .strict();
export type ServiceRequestAnswers = z.infer<typeof serviceRequestAnswersSchema>;

/** Le risposte del modulo da salvare nel JSON (senza le parti che hanno una colonna). */
export function serviceRequestAnswers(input: ServiceRequestInput): ServiceRequestAnswers {
  switch (input.kind) {
    case 'EVENT':
      return { eventType: input.eventType, guests: input.guests, place: input.place };
    case 'VENUE':
      return { venueType: input.venueType, recurrence: input.recurrence };
    case 'WEEKLY':
      return {
        weekday: input.weekday,
        ...(input.window
          ? { windowStartMinutes: input.window.start, windowEndMinutes: input.window.end }
          : {}),
        duration: input.duration,
      };
    case 'CARE':
      return { plants: input.plants, frequency: input.frequency };
    case 'CUSTOM':
      return {};
  }
}

/** Le risposte lette dal database (null se il JSON non è valido: non si mostra niente di strano). */
export function parseServiceRequestAnswers(value: unknown): ServiceRequestAnswers | null {
  const parsed = serviceRequestAnswersSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type ServiceRequestProblem =
  'service_unavailable' | 'service_care_not_ready' | 'service_requests_open_limit';

/** Perché non si può mandare una richiesta adesso; null = si può. */
export function serviceRequestProblem(input: {
  /** Negozio pubblicato e servizio pubblicato e attivo. */
  readonly available: boolean;
  readonly kind: StorefrontServiceKind;
  readonly careReady: boolean;
  /** Richieste aperte della persona in questa fioreria. */
  readonly openRequests: number;
}): ServiceRequestProblem | null {
  if (!input.available) return 'service_unavailable';
  if (input.kind === 'CARE' && !input.careReady) return 'service_care_not_ready';
  if (input.openRequests >= SERVICE_REQUEST_LIMITS.openPerBuyer) {
    return 'service_requests_open_limit';
  }
  return null;
}

// -----------------------------------------------------------------------------
// «Rifiuta» della fioreria
// -----------------------------------------------------------------------------

export const SERVICE_DECLINE_REASONS = [
  'NO_AVAILABILITY',
  'OUT_OF_AREA',
  'NOT_OFFERED',
  'OTHER',
] as const;
export type ServiceDeclineReason = (typeof SERVICE_DECLINE_REASONS)[number];

/** Il motivo come lo legge chi compra, nella lingua del mercato. */
export const SERVICE_DECLINE_REASON_TEXTS: Readonly<
  Record<Exclude<ServiceDeclineReason, 'OTHER'>, string>
> = {
  NO_AVAILABILITY: 'No tenemos disponibilidad para esa fecha.',
  OUT_OF_AREA: 'No llegamos a ese lugar.',
  NOT_OFFERED: 'Por ahora no hacemos este tipo de trabajo.',
};

/** Il motivo pronto e un dettaglio; con «Altro motivo» il dettaglio è obbligatorio. */
export const serviceDeclineSchema = z
  .object({
    reasonCode: z.preprocess(
      toTrimmedString,
      z.enum(SERVICE_DECLINE_REASONS, { error: 'required' }),
    ),
    detail: optionalText(SERVICE_REQUEST_LIMITS.declineDetail),
  })
  .superRefine((value, ctx) => {
    if (value.reasonCode === 'OTHER' && value.detail === null) {
      ctx.addIssue({ code: 'custom', path: ['detail'], message: 'required' });
    }
  });
export type ServiceDeclineInput = z.infer<typeof serviceDeclineSchema>;

/** Il testo che legge chi compra: il motivo pronto con il dettaglio, o solo il dettaglio. */
export function serviceDeclineReasonText(
  code: ServiceDeclineReason,
  detail: string | null,
): string {
  if (code === 'OTHER') return detail ?? '';
  const base = SERVICE_DECLINE_REASON_TEXTS[code];
  return detail ? `${base} ${detail}` : base;
}
