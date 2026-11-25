/**
 * Floral Care [CARE-01] (ADR-075): l'offerta di cura delle piante della fioreria e i contratti con
 * i suoi clienti. Regole pure, senza I/O:
 *  - prezzo: tariffa per uscita + care per pianta secondo la misura + servizi extra (decisione del
 *    founder del 24/11/2026); il cliente sceglie quante uscite e il canone si calcola da solo;
 *  - frequenze e date delle visite nel calendario della fioreria;
 *  - fasce di uscita per giorno della settimana, con capienza.
 * Prezzi, distanze e date li calcola SOLO il server: dal browser arrivano scelte, mai importi.
 */
import { z } from 'zod';
import { addDays, compareDates, dayOfWeek, daysInMonth, type CalendarDate } from './calendar';
import { optionalPhoneField } from './customer';
import {
  isWeekday,
  roundedDistanceKm,
  sortFeeTiers,
  type DeliveryFeeTier,
  type Weekday,
} from './delivery';
import { SUPPORTED_LOCALES, type SupportedLocale } from './i18n';
import type { MarketCountry } from './markets';
import { careDueDaysField, careLateCancelHoursField } from './floral-care-charges';
import { MAX_AMOUNT_MINOR, type CurrencyCode } from './money';
import { optionalUuidField, parseTimeInput } from './order';
import type { Coordinates } from './places';
import { parseDateInput } from './quote';
import {
  checkboxField,
  moneyField,
  multiValueField,
  optionalInteger,
  optionalMoneyField,
  optionalText,
  requiredInteger,
  requiredText,
  toTrimmedString,
} from './validation';

export const CARE_LIMITS = {
  /** Servizi per fioreria (la lista nostra più quelli del fiorista). */
  services: 40,
  serviceName: 80,
  serviceDescription: 300,
  /** Fasce di uscita per fioreria. */
  slots: 40,
  /** Posti di una fascia nello stesso giorno. */
  slotCapacity: 20,
  /** Posti che occupa ogni visita di un contratto (un ufficio con 80 piante ne prende più d'uno). */
  visitSeats: 5,
  /** Righe di piante di un contratto, e piante per riga ("12 potos en jardinera"). */
  plants: 200,
  plantQuantity: 500,
  plantName: 80,
  plantLocation: 120,
  plantText: 500,
  termsText: 4000,
  contactName: 120,
  siteNotes: 500,
  notes: 1000,
  /** Ore di preavviso per spostare una visita: fino a una settimana. */
  noticeHoursMax: 168,
  /** Raggio massimo impostabile (km), come per le consegne. */
  maxDistanceKm: 100,
  /** Fasce di sovrapprezzo per distanza. */
  travelTiers: 8,
  /** Giorni di visite create in anticipo. */
  generationDays: 60,
  /** La manutenzione allunga un contratto quando le sue visite coprono meno di questi giorni. */
  refillDays: 45,
  /** Contratti allungati o chiusi per giro della manutenzione (una transazione per contratto). */
  jobBatch: 100,
  /** Giorni della settimana di un contratto settimanale. */
  weeklyDaysMax: 3,
  /** Primo giorno di un contratto: fino a 90 giorni da oggi. */
  startDaysMax: 90,
  /** Il fiorista sposta una visita fino a 90 giorni da oggi. */
  moveDaysMax: 90,
} as const;

// -----------------------------------------------------------------------------
// Vocabolari
// -----------------------------------------------------------------------------

export const PLANT_SIZES = ['SMALL', 'MEDIUM', 'LARGE'] as const;
export type PlantSize = (typeof PLANT_SIZES)[number];

export const PLANT_LIGHT_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type PlantLight = (typeof PLANT_LIGHT_LEVELS)[number];

/**
 * Frequenze che la fioreria può offrire. Mensili in giorni fissi (1º martes; 1º e 3º martes),
 * così il canone è sempre uguale; settimanali in 1–3 giorni (gli hotel lo chiedono), con 4 o 5
 * visite al mese secondo il calendario.
 */
export const CARE_FREQUENCIES = ['MONTHLY_1', 'MONTHLY_2', 'WEEKLY'] as const;
export type CareFrequency = (typeof CARE_FREQUENCIES)[number];

/** Le occorrenze del giorno nel mese per le frequenze mensili. */
export const MONTHLY_OCCURRENCES: Readonly<Record<'MONTHLY_1' | 'MONTHLY_2', readonly number[]>> = {
  MONTHLY_1: [1],
  MONTHLY_2: [1, 3],
};

/** Visita che il cliente non lascia fare: si conta come fatta, oppure si recupera. */
export const MISSED_VISIT_POLICIES = ['COUNTS', 'RECOVER'] as const;
export type MissedVisitPolicy = (typeof MISSED_VISIT_POLICIES)[number];

/** Pianta morta: la sostituzione è inclusa nel canone, oppure si fa un preventivo. */
export const DEAD_PLANT_POLICIES = ['INCLUDED', 'QUOTE'] as const;
export type DeadPlantPolicy = (typeof DEAD_PLANT_POLICIES)[number];

export const CARE_SERVICE_PRICINGS = ['INCLUDED', 'EXTRA'] as const;
export type CareServicePricing = (typeof CARE_SERVICE_PRICINGS)[number];

/** Un servizio extra si paga per visita, per pianta a ogni visita, o una volta sola. */
export const CARE_SERVICE_UNITS = ['PER_VISIT', 'PER_PLANT', 'ONE_TIME'] as const;
export type CareServiceUnit = (typeof CARE_SERVICE_UNITS)[number];

/**
 * La nostra lista di servizi, creata per ogni fioreria quando accende Floral Care: chiave stabile
 * e nome nelle tre lingue. Il nome principale del servizio è quello della lingua del mercato,
 * perché lo legge il cliente; gli altri sono le sue traduzioni, per chi usa l'app in un'altra
 * lingua (ADR-042). Il fiorista cambia prezzo e modalità, archivia quelli che non offre e aggiunge
 * i suoi.
 */
export const CARE_SERVICE_PRESETS = [
  {
    key: 'watering',
    names: { 'es-MX': 'Riego', 'it-IT': 'Irrigazione', 'en-US': 'Watering' },
    pricing: 'INCLUDED',
    unit: 'PER_VISIT',
  },
  {
    key: 'leaf_cleaning',
    names: {
      'es-MX': 'Limpieza de hojas',
      'it-IT': 'Pulizia delle foglie',
      'en-US': 'Leaf cleaning',
    },
    pricing: 'INCLUDED',
    unit: 'PER_VISIT',
  },
  {
    key: 'pruning',
    names: {
      'es-MX': 'Poda y retiro de hojas secas',
      'it-IT': 'Potatura e rimozione delle foglie secche',
      'en-US': 'Pruning and dead leaf removal',
    },
    pricing: 'INCLUDED',
    unit: 'PER_VISIT',
  },
  {
    key: 'pest_check',
    names: {
      'es-MX': 'Revisión de plagas y enfermedades',
      'it-IT': 'Controllo di parassiti e malattie',
      'en-US': 'Pest and disease check',
    },
    pricing: 'INCLUDED',
    unit: 'PER_VISIT',
  },
  {
    key: 'rotation',
    names: {
      'es-MX': 'Rotación de plantas',
      'it-IT': 'Rotazione delle piante',
      'en-US': 'Plant rotation',
    },
    pricing: 'INCLUDED',
    unit: 'PER_VISIT',
  },
  {
    key: 'pot_cleaning',
    names: { 'es-MX': 'Limpieza de macetas', 'it-IT': 'Pulizia dei vasi', 'en-US': 'Pot cleaning' },
    pricing: 'INCLUDED',
    unit: 'PER_VISIT',
  },
  {
    key: 'fertilizing',
    names: { 'es-MX': 'Fertilización', 'it-IT': 'Concimazione', 'en-US': 'Fertilizing' },
    pricing: 'EXTRA',
    unit: 'PER_PLANT',
  },
  {
    key: 'substrate',
    names: {
      'es-MX': 'Reposición de sustrato',
      'it-IT': 'Aggiunta di terriccio',
      'en-US': 'Substrate top-up',
    },
    pricing: 'EXTRA',
    unit: 'PER_PLANT',
  },
  {
    key: 'repotting',
    names: { 'es-MX': 'Trasplante', 'it-IT': 'Rinvaso', 'en-US': 'Repotting' },
    pricing: 'EXTRA',
    unit: 'PER_PLANT',
  },
] as const satisfies readonly {
  readonly key: string;
  readonly names: Readonly<Record<SupportedLocale, string>>;
  readonly pricing: CareServicePricing;
  readonly unit: CareServiceUnit;
}[];
export type CareServicePresetKey = (typeof CARE_SERVICE_PRESETS)[number]['key'];
export type CareServicePreset = (typeof CARE_SERVICE_PRESETS)[number];

/** Il servizio della nostra lista con questa chiave, o null. */
export function findCareServicePreset(key: unknown): CareServicePreset | null {
  if (typeof key !== 'string') return null;
  return CARE_SERVICE_PRESETS.find((preset) => preset.key === key) ?? null;
}

/**
 * Traduzioni del nome di un servizio, per le lingue diverse da quella del nome principale (che è
 * la lingua del mercato). Facoltative: senza traduzione si vede il nome principale.
 */
export type CareServiceTranslations = Partial<Record<SupportedLocale, string>>;

/** Le traduzioni lette dal database (JSON): solo lingue note e testi non vuoti. */
export function parseCareServiceTranslations(value: unknown): CareServiceTranslations {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: CareServiceTranslations = {};
  for (const locale of SUPPORTED_LOCALES) {
    const text = record[locale];
    if (typeof text === 'string' && text.trim() !== '') result[locale] = text.trim();
  }
  return result;
}

/**
 * Nome principale e traduzioni di un servizio della nostra lista per un mercato: il nome nella
 * lingua del mercato, le altre lingue come traduzioni.
 */
export function careServicePresetNames(
  preset: CareServicePreset,
  marketLocale: SupportedLocale,
): { readonly name: string; readonly translations: CareServiceTranslations } {
  const translations: CareServiceTranslations = {};
  for (const locale of SUPPORTED_LOCALES) {
    if (locale !== marketLocale) translations[locale] = preset.names[locale];
  }
  return { name: preset.names[marketLocale], translations };
}

/**
 * Nome di un servizio (o della sua copia in un contratto) nella lingua di chi guarda: la
 * traduzione, se c'è, se no il nome principale. Solo per l'app della fioreria e per Mi Floral Care:
 * rapporto pubblico, email e addebiti restano nella lingua del mercato (ADR-042).
 */
export function careServiceName(
  service: { readonly name: string; readonly translations: CareServiceTranslations },
  locale: SupportedLocale,
): string {
  return service.translations[locale] ?? service.name;
}

/**
 * Persona e telefono della sede presi dal cliente («Usa i dati del cliente»): quelli del
 * destinatario dell'indirizzo scelto, se ci sono, altrimenti nome e telefono del cliente.
 * Telefono in E.164 o null.
 */
export function careSiteContact(
  customer: { readonly name: string; readonly phone: string | null },
  address: { readonly recipientName: string | null; readonly recipientPhone: string | null } | null,
): { readonly name: string; readonly phone: string | null } {
  return {
    name: address?.recipientName?.trim() || customer.name,
    phone: address?.recipientPhone || customer.phone || null,
  };
}

/**
 * «Usa i dati del cliente» parte acceso se i dati salvati della sede sono vuoti o sono proprio
 * quelli del cliente (telefoni confrontati in E.164).
 */
export function careSiteContactMatches(
  saved: { readonly name: string | null; readonly phone: string | null },
  proposed: { readonly name: string; readonly phone: string | null },
): boolean {
  const name = saved.name?.trim() ?? '';
  const phone = saved.phone ?? '';
  return (
    (name === '' || name === proposed.name) && (phone === '' || phone === (proposed.phone ?? ''))
  );
}

/** Stati di un contratto (comune ai due tipi di suscripción). */
export const CUSTOMER_SUBSCRIPTION_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'ENDED',
  'CANCELLED',
] as const;
export type CustomerSubscriptionStatus = (typeof CUSTOMER_SUBSCRIPTION_STATUSES)[number];

/**
 * Stati di una visita. `TO_RESCHEDULE`: la manutenzione non ha trovato posto nel mese (fascia
 * piena o archiviata): la fioreria la sistema a mano.
 */
export const CARE_VISIT_STATUSES = [
  'SCHEDULED',
  'IN_PROGRESS',
  'DONE',
  'NOT_DONE',
  'CANCELLED',
  'TO_RESCHEDULE',
] as const;
export type CareVisitStatus = (typeof CARE_VISIT_STATUSES)[number];

/** Le visite che occupano un posto nella fascia di quel giorno. */
export const CARE_VISIT_HOLDING_STATUSES: readonly CareVisitStatus[] = [
  'SCHEDULED',
  'IN_PROGRESS',
  'DONE',
  'NOT_DONE',
];

/**
 * Perché una visita è cancellata. Le prime due le mette il sistema (calendario cambiato, contratto
 * finito: la visita è sostituita o non più dovuta); le altre le sceglie la fioreria. Ai cargos
 * (blocco 3) serve sapere chi l'ha tolta: se è la fioreria, è un credito.
 */
export const CARE_VISIT_CANCEL_REASONS = [
  'SCHEDULE_CHANGE',
  'CONTRACT_END',
  'SHOP',
  'CUSTOMER',
] as const;
export type CareVisitCancelReason = (typeof CARE_VISIT_CANCEL_REASONS)[number];

/** I motivi che sceglie la fioreria cancellando una visita a mano. */
export const CARE_MANUAL_CANCEL_REASONS = ['SHOP', 'CUSTOMER'] as const;

/** Visite ancora da fare: quelle che un cambio di agenda tocca. */
export const CARE_VISIT_OPEN_STATUSES: readonly CareVisitStatus[] = ['SCHEDULED', 'TO_RESCHEDULE'];

export function isCareVisitOpen(status: CareVisitStatus): boolean {
  return CARE_VISIT_OPEN_STATUSES.includes(status);
}

/** "Hecha" o "No se pudo": da una visita programata o in corso. */
export function canCloseCareVisit(status: CareVisitStatus): boolean {
  return status === 'SCHEDULED' || status === 'IN_PROGRESS';
}

/** Numero del contratto: SUS-0001. */
export function formatSubscriptionNumber(value: number): string {
  return `SUS-${String(value).padStart(4, '0')}`;
}

// -----------------------------------------------------------------------------
// Moduli
// -----------------------------------------------------------------------------

function enumField<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(toTrimmedString, z.enum(values, { error: 'required' }));
}

function optionalEnumField<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    toTrimmedString,
    z.union([z.literal('').transform(() => null), z.enum(values)], { error: 'invalid_option' }),
  );
}

const weekdayField = z.preprocess(
  (value) => (typeof value === 'string' && /^\d$/.test(value) ? Number(value) : value),
  z
    .number({ error: 'required' })
    .int({ error: 'invalid_option' })
    .refine(isWeekday, { error: 'invalid_option' }),
);

/** Un'ora "HH:MM" del giorno, in minuti dalla mezzanotte. */
export const careTimeField = z.preprocess(
  toTrimmedString,
  z.string().transform((value, ctx) => {
    const minutes = parseTimeInput(value);
    if (minutes === null) {
      ctx.addIssue({ code: 'custom', message: value === '' ? 'required' : 'invalid_time_window' });
      return z.NEVER;
    }
    return minutes;
  }),
);

/** Un giorno "AAAA-MM-GG" del calendario della fioreria. */
export const careDateField = z.preprocess(
  toTrimmedString,
  z.string().transform((value, ctx) => {
    if (value === '') {
      ctx.addIssue({ code: 'custom', message: 'required' });
      return z.NEVER;
    }
    const parsed = parseDateInput(value);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'invalid_date' });
      return z.NEVER;
    }
    return parsed;
  }),
);

/** Impostazioni di Floral Care della fioreria (Ajustes → Floral Care). */
export function careSettingsSchema(currency: CurrencyCode) {
  return z.object({
    /** Tariffa per uscita: comprende il viaggio dentro il raggio. */
    visitFee: moneyField(currency),
    /** Care per pianta a ogni visita, secondo la misura; vuoto = 0. */
    careFeeSmall: optionalMoneyField(currency).transform((value) => value ?? 0),
    careFeeMedium: optionalMoneyField(currency).transform((value) => value ?? 0),
    careFeeLarge: optionalMoneyField(currency).transform((value) => value ?? 0),
    frequencies: multiValueField(
      z.enum(CARE_FREQUENCIES, { error: 'invalid_option' }),
      CARE_FREQUENCIES.length,
    )
      .refine((list) => list.length > 0, { error: 'required' })
      .transform((list) => CARE_FREQUENCIES.filter((frequency) => list.includes(frequency))),
    /** Raggio in km dal negozio; vuoto = senza limite. */
    maxDistanceKm: optionalInteger({ min: 1, max: CARE_LIMITS.maxDistanceKm }),
    minNoticeHours: requiredInteger({ min: 0, max: CARE_LIMITS.noticeHoursMax }),
    missedVisitPolicy: enumField(MISSED_VISIT_POLICIES),
    deadPlantPolicy: enumField(DEAD_PLANT_POLICIES),
    /** "Días para pagar" un cargo (ADR-082): vuoto = 10. */
    paymentDueDays: careDueDaysField,
    /** Cancelación del cliente: si paga con meno di queste ore di preavviso (vuoto = 12, 0 = mai). */
    lateCancelHours: careLateCancelHoursField,
    /** I termini della fioreria, scritti da lei: Gardelia non inventa condizioni. */
    termsText: optionalText(CARE_LIMITS.termsText),
  });
}
export type CareSettingsInput = z.infer<ReturnType<typeof careSettingsSchema>>;

/**
 * Traduzioni del nome scritte dal fiorista (`translations.it-IT`, …): facoltative, lunghe al
 * massimo quanto il nome. Le lingue vuote non si salvano.
 */
const careServiceTranslationsField = z.preprocess(
  (value) => value ?? {},
  z
    .object({
      'es-MX': optionalText(CARE_LIMITS.serviceName),
      'it-IT': optionalText(CARE_LIMITS.serviceName),
      'en-US': optionalText(CARE_LIMITS.serviceName),
    })
    .transform((value): CareServiceTranslations => {
      const result: CareServiceTranslations = {};
      for (const locale of SUPPORTED_LOCALES) {
        const text = value[locale];
        if (text) result[locale] = text;
      }
      return result;
    }),
);

/** Un servizio della fioreria: nome, traduzioni, descrizione, incluso o extra con prezzo e unità. */
export function careServiceSchema(currency: CurrencyCode) {
  return z
    .object({
      name: requiredText(CARE_LIMITS.serviceName),
      translations: careServiceTranslationsField,
      description: optionalText(CARE_LIMITS.serviceDescription),
      pricing: enumField(CARE_SERVICE_PRICINGS),
      unit: enumField(CARE_SERVICE_UNITS),
      price: optionalMoneyField(currency),
    })
    .superRefine((value, ctx) => {
      if (value.pricing === 'EXTRA' && (value.price === null || value.price <= 0)) {
        ctx.addIssue({ code: 'custom', path: ['price'], message: 'required' });
      }
    })
    .transform((value) => ({
      ...value,
      // Un servizio incluso non ha prezzo suo: è dentro la tariffa per uscita.
      price: value.pricing === 'EXTRA' ? (value.price ?? 0) : 0,
      unit: value.pricing === 'EXTRA' ? value.unit : ('PER_VISIT' as const),
    }));
}
export type CareServiceInput = z.infer<ReturnType<typeof careServiceSchema>>;

/** Fascia di uscita: giorno della settimana, da–a, quante visite ci stanno. */
export const careSlotSchema = z
  .object({
    weekday: weekdayField,
    start: careTimeField,
    end: careTimeField,
    capacity: requiredInteger({ min: 1, max: CARE_LIMITS.slotCapacity }),
  })
  .superRefine((value, ctx) => {
    if (value.start >= value.end) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'invalid_time_window' });
    }
  });
export type CareSlotInput = z.infer<typeof careSlotSchema>;

/** Una riga di piante del contratto (anche a gruppi: "12 potos en jardinera"). */
export const carePlantSchema = z.object({
  name: requiredText(CARE_LIMITS.plantName),
  /** Specie della lista di riferimento (`CanonicalFlower`); vuoto = nessuna. */
  canonicalFlowerId: optionalUuidField,
  quantity: requiredInteger({ min: 1, max: CARE_LIMITS.plantQuantity }),
  size: enumField(PLANT_SIZES),
  location: optionalText(CARE_LIMITS.plantLocation),
  light: optionalEnumField(PLANT_LIGHT_LEVELS),
  watering: optionalText(CARE_LIMITS.plantText),
  /** Istruzioni per chi sta sul posto fra una visita e l'altra (le vede il cliente). */
  instructions: optionalText(CARE_LIMITS.plantText),
  /**
   * Pianta del cambio di stagione (ADR-078): fuori dal prezzo del contratto (la paga la
   * cotización) e archiviata alla visita di ritiro.
   */
  seasonal: checkboxField(),
});
export type CarePlantInput = z.infer<typeof carePlantSchema>;

const careScheduleShape = {
  frequency: enumField(CARE_FREQUENCIES),
  /** Le fasce scelte: una per le frequenze mensili, una per giorno per quella settimanale. */
  slotIds: multiValueField(z.uuid({ error: 'invalid_option' }), CARE_LIMITS.weeklyDaysMax).refine(
    (list) => list.length > 0,
    { error: 'required' },
  ),
  startDate: careDateField,
  seats: optionalInteger({ min: 1, max: CARE_LIMITS.visitSeats }).transform((value) => value ?? 1),
};

/** Nuovo contratto (borrador): sede, frequenza e fasce, primo giorno, servizi, dati della sede. */
export function careContractSchema(country: MarketCountry) {
  return z.object({
    customerAddressId: z.preprocess(toTrimmedString, z.uuid({ error: 'required' })),
    ...careScheduleShape,
    serviceIds: multiValueField(z.uuid({ error: 'invalid_option' }), CARE_LIMITS.services),
    contactName: optionalText(CARE_LIMITS.contactName),
    contactPhone: optionalPhoneField(country),
    /** Gafete, estacionamiento, horario de acceso, días que el lugar cierra. */
    accessNotes: optionalText(CARE_LIMITS.siteNotes),
    notes: optionalText(CARE_LIMITS.notes),
    /** Fuori dal raggio: il fiorista conferma che va lo stesso. */
    outOfRangeConfirmed: checkboxField(),
  });
}
export type CareContractInput = z.infer<ReturnType<typeof careContractSchema>>;

/**
 * Dati di un contratto già confermato che si cambiano senza toccare le visite: servizi (il prezzo
 * poi si aggiorna a parte) e dati pratici della sede. Sede e calendario hanno i loro passi.
 */
export function careContractDetailsSchema(country: MarketCountry) {
  return z.object({
    serviceIds: multiValueField(z.uuid({ error: 'invalid_option' }), CARE_LIMITS.services),
    contactName: optionalText(CARE_LIMITS.contactName),
    contactPhone: optionalPhoneField(country),
    accessNotes: optionalText(CARE_LIMITS.siteNotes),
    notes: optionalText(CARE_LIMITS.notes),
  });
}
export type CareContractDetailsInput = z.infer<ReturnType<typeof careContractDetailsSchema>>;

/** Cambio di frequenza, fasce o primo giorno di un contratto (vale per le visite future). */
export const careScheduleSchema = z.object(careScheduleShape);
export type CareScheduleInput = z.infer<typeof careScheduleSchema>;

/**
 * Conferma di un cambio che tocca visite già fissate: senza "Sí, avisé al cliente" il server lo
 * rifiuta (decisione del founder del 24/11/2026).
 */
export const careNoticeSchema = z.object({ customerNotified: checkboxField() });

/** Nuovo calendario di un contratto attivo, con la casella dell'avviso. */
export const careScheduleChangeSchema = z.object({
  ...careScheduleShape,
  ...careNoticeSchema.shape,
});
export type CareScheduleChangeInput = z.infer<typeof careScheduleChangeSchema>;

/** "Hecha" o "No se pudo": una nota facoltativa per il registro della visita. */
export const careVisitOutcomeSchema = z.object({ note: optionalText(CARE_LIMITS.notes) });

/**
 * Dove va una visita: in un orario di visita (conta i posti) o, solo una visita extra, a un'ora
 * libera (decisione del founder del 24/11/2026, ADR-078): non tocca i posti e i clienti non la
 * possono scegliere.
 */
export const CARE_VISIT_PLACEMENTS = ['SLOT', 'TIME'] as const;
export type CareVisitPlacement = (typeof CARE_VISIT_PLACEMENTS)[number];

export type CarePlacementInput =
  | { readonly placement: 'SLOT'; readonly date: CalendarDate; readonly slotId: string }
  | {
      readonly placement: 'TIME';
      readonly date: CalendarDate;
      readonly startMinutes: number;
      readonly endMinutes: number;
    };

const optionalTimeField = z.preprocess(
  toTrimmedString,
  z.string().transform((value, ctx) => {
    if (value === '') return null;
    const minutes = parseTimeInput(value);
    if (minutes === null) {
      ctx.addIssue({ code: 'custom', message: 'invalid_time_window' });
      return z.NEVER;
    }
    return minutes;
  }),
);

/** I campi del posto di una visita: giorno, e la fascia oppure l'ora libera. */
export const carePlacementShape = {
  // Senza scelta (o con una scelta sconosciuta) vale l'orario di visita, come nel blocco 1.
  placement: z.preprocess(toTrimmedString, z.enum(CARE_VISIT_PLACEMENTS).catch('SLOT')),
  date: careDateField,
  slotId: optionalUuidField,
  start: optionalTimeField,
  end: optionalTimeField,
};

interface PlacementFields {
  readonly placement: CareVisitPlacement;
  readonly date: CalendarDate;
  readonly slotId: string | null;
  readonly start: number | null;
  readonly end: number | null;
}

/** In un orario serve la fascia; a un'ora libera servono inizio e fine, nell'ordine. */
export function checkCarePlacement(value: PlacementFields, ctx: z.RefinementCtx): void {
  if (value.placement === 'SLOT') {
    if (!value.slotId) ctx.addIssue({ code: 'custom', path: ['slotId'], message: 'required' });
    return;
  }
  if (value.start === null) ctx.addIssue({ code: 'custom', path: ['start'], message: 'required' });
  if (value.end === null) ctx.addIssue({ code: 'custom', path: ['end'], message: 'required' });
  if (value.start !== null && value.end !== null && value.start >= value.end) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'invalid_time_window' });
  }
}

/** Dopo `checkCarePlacement`: il posto scelto, senza i campi dell'altra scelta. */
export function toCarePlacement(value: PlacementFields): CarePlacementInput {
  return value.placement === 'SLOT'
    ? { placement: 'SLOT', date: value.date, slotId: value.slotId ?? '' }
    : {
        placement: 'TIME',
        date: value.date,
        startMinutes: value.start ?? 0,
        endMinutes: value.end ?? 0,
      };
}

/** Spostare una visita: giorno e fascia nuovi (o un'ora libera, solo le extra), con l'avviso. */
export const careVisitMoveSchema = z
  .object({ ...carePlacementShape, ...careNoticeSchema.shape })
  .superRefine(checkCarePlacement)
  .transform((value) => ({ ...toCarePlacement(value), customerNotified: value.customerNotified }));
export type CareVisitMoveInput = z.infer<typeof careVisitMoveSchema>;

/** Cancellare una visita: chi la toglie, perché, e la casella dell'avviso. */
export const careVisitCancelSchema = z.object({
  reason: enumField(CARE_MANUAL_CANCEL_REASONS),
  note: optionalText(CARE_LIMITS.notes),
  /**
   * Cancellata dal cliente con meno preavviso del limite: "No cobrar esta vez" (PROPOSTO), per un
   * avviso arrivato in tempo e registrato tardi. Negli altri casi non cambia nulla.
   */
  noCharge: checkboxField(),
  ...careNoticeSchema.shape,
});
export type CareVisitCancelInput = z.infer<typeof careVisitCancelSchema>;

/** Fine del contratto: l'ultimo giorno di servizio (le visite dopo si cancellano). */
export const careEndSchema = z.object({
  endDate: careDateField,
  ...careNoticeSchema.shape,
});
export type CareEndInput = z.infer<typeof careEndSchema>;

/** Elenco dei contratti: attivi (anche in pausa), borradores, chiusi (finiti o scartati). */
export const CARE_CONTRACT_VIEWS = ['active', 'draft', 'closed'] as const;
export type CareContractView = (typeof CARE_CONTRACT_VIEWS)[number];
export const CARE_PAGE_SIZE = 20;

export const careContractListFiltersSchema = z.object({
  view: z.preprocess(toTrimmedString, z.enum(CARE_CONTRACT_VIEWS).catch('active')),
  q: z.preprocess(toTrimmedString, z.string().max(80).catch('')),
  page: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.int().min(1).max(10_000).catch(1),
  ),
});
export type CareContractListFilters = z.infer<typeof careContractListFiltersSchema>;

// -----------------------------------------------------------------------------
// Fasce, frequenze e date
// -----------------------------------------------------------------------------

export interface CareSlotLike {
  readonly id: string;
  readonly weekday: number;
}

/**
 * Le fasce scelte per un contratto vanno bene per la frequenza? Mensile: una fascia sola;
 * settimanale: da 1 a 3, ognuna in un giorno diverso. Restituisce il codice d'errore o null.
 */
export function careScheduleProblem(
  frequency: CareFrequency,
  slots: readonly CareSlotLike[],
): 'required' | 'care_one_slot' | 'care_repeated_weekday' | 'too_many_items' | null {
  if (slots.length === 0) return 'required';
  if (frequency !== 'WEEKLY') return slots.length === 1 ? null : 'care_one_slot';
  if (slots.length > CARE_LIMITS.weeklyDaysMax) return 'too_many_items';
  const weekdays = new Set(slots.map((slot) => slot.weekday));
  return weekdays.size === slots.length ? null : 'care_repeated_weekday';
}

/** L'n-esimo giorno `weekday` del mese (1 = il primo); null se non c'è (es. un 5º martes). */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  occurrence: number,
): CalendarDate | null {
  const first = dayOfWeek({ year, month, day: 1 });
  const day = 1 + ((weekday - first + 7) % 7) + (occurrence - 1) * 7;
  return day <= daysInMonth(year, month) ? { year, month, day } : null;
}

/**
 * Date delle visite di un contratto fra `from` e `until` (inclusi), in ordine: le occorrenze del
 * mese per le frequenze mensili, ogni settimana nei giorni scelti per quella settimanale.
 */
export function careVisitDates(input: {
  readonly frequency: CareFrequency;
  readonly weekdays: readonly Weekday[];
  readonly from: CalendarDate;
  readonly until: CalendarDate;
}): CalendarDate[] {
  const { from, until } = input;
  if (compareDates(from, until) > 0 || input.weekdays.length === 0) return [];
  const dates: CalendarDate[] = [];
  if (input.frequency === 'WEEKLY') {
    for (let day = from; compareDates(day, until) <= 0; day = addDays(day, 1)) {
      if ((input.weekdays as readonly number[]).includes(dayOfWeek(day))) dates.push(day);
    }
    return dates;
  }
  const weekday = input.weekdays[0]!;
  let year = from.year;
  let month = from.month;
  while (year < until.year || (year === until.year && month <= until.month)) {
    for (const occurrence of MONTHLY_OCCURRENCES[input.frequency]) {
      const date = nthWeekdayOfMonth(year, month, weekday, occurrence);
      if (date && compareDates(date, from) >= 0 && compareDates(date, until) <= 0) {
        dates.push(date);
      }
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return dates;
}

/** Quante visite ci sono in un mese con questa frequenza: da–a (le settimanali variano). */
export function careVisitsPerMonth(
  frequency: CareFrequency,
  weekdayCount: number,
): { readonly min: number; readonly max: number } {
  if (frequency === 'MONTHLY_1') return { min: 1, max: 1 };
  if (frequency === 'MONTHLY_2') return { min: 2, max: 2 };
  return { min: 4 * weekdayCount, max: 5 * weekdayCount };
}

export interface SlotAvailability {
  readonly date: CalendarDate;
  readonly slotId: string;
  /** Posti liberi quel giorno in quella fascia. */
  readonly free: number;
  readonly startMinutes: number;
}

/**
 * Dove va una visita: la fascia preferita il suo giorno; se è piena, un'altra fascia lo stesso
 * giorno; poi i giorni più vicini della stessa settimana, mai fuori dal mese. Null = nessun posto
 * (la visita resta "Por reprogramar").
 */
export function pickCareSlot(input: {
  readonly date: CalendarDate;
  readonly preferredSlotId: string;
  readonly seats: number;
  readonly candidates: readonly SlotAvailability[];
}): SlotAvailability | null {
  const fits = input.candidates.filter(
    (candidate) =>
      candidate.free >= input.seats &&
      candidate.date.year === input.date.year &&
      candidate.date.month === input.date.month,
  );
  const sameDay = fits.filter((candidate) => compareDates(candidate.date, input.date) === 0);
  const preferred = sameDay.find((candidate) => candidate.slotId === input.preferredSlotId);
  if (preferred) return preferred;
  const byTime = (a: SlotAvailability, b: SlotAvailability) => a.startMinutes - b.startMinutes;
  const firstSameDay = [...sameDay].sort(byTime)[0];
  if (firstSameDay) return firstSameDay;
  const distance = (candidate: SlotAvailability) => Math.abs(daysApart(candidate.date, input.date));
  const sameWeek = fits.filter((candidate) => {
    const gap = distance(candidate);
    return gap > 0 && gap < 7 && isoWeekStart(candidate.date) === isoWeekStart(input.date);
  });
  sameWeek.sort(
    (a, b) => distance(a) - distance(b) || compareDates(a.date, b.date) || byTime(a, b),
  );
  return sameWeek[0] ?? null;
}

function daysApart(a: CalendarDate, b: CalendarDate): number {
  return Math.round(
    (Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000,
  );
}

/** Lunedì della settimana della data, come numero di giorni: per dire "stessa settimana". */
function isoWeekStart(date: CalendarDate): number {
  const days = Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
  const weekday = (dayOfWeek(date) + 6) % 7;
  return days - weekday;
}

// -----------------------------------------------------------------------------
// Distanza e prezzo
// -----------------------------------------------------------------------------

export type CareTravelQuote =
  | { readonly kind: 'in_range'; readonly surchargeMinor: number; readonly distanceKm: number }
  | { readonly kind: 'out_of_range'; readonly distanceKm: number; readonly maxKm: number }
  /** Senza le due posizioni non si sa: il fiorista lo vede e decide. */
  | { readonly kind: 'unknown' };

/**
 * Sovrapprezzo per uscita secondo la distanza in linea retta: la prima fascia che arriva fin lì;
 * oltre l'ultima, il sovrapprezzo dell'ultima. Oltre il raggio la fioreria di solito non va.
 */
export function quoteCareTravel(input: {
  readonly tiers: readonly DeliveryFeeTier[];
  readonly maxDistanceKm: number | null;
  readonly from: Coordinates | null;
  readonly to: Coordinates | null;
}): CareTravelQuote {
  if (!input.from || !input.to) return { kind: 'unknown' };
  return careTravelForDistance({
    tiers: input.tiers,
    maxDistanceKm: input.maxDistanceKm,
    distanceKm: roundedDistanceKm(input.from, input.to),
  });
}

/**
 * Lo stesso per una distanza già misurata (in km, un decimale): il contratto la salva perché le
 * coordinate del cliente si cancellano dopo 30 giorni (ADR-059). Null = mai misurata.
 */
export function careTravelForDistance(input: {
  readonly tiers: readonly DeliveryFeeTier[];
  readonly maxDistanceKm: number | null;
  readonly distanceKm: number | null;
}): CareTravelQuote {
  const km = input.distanceKm;
  if (km === null) return { kind: 'unknown' };
  if (input.maxDistanceKm !== null && km > input.maxDistanceKm) {
    return { kind: 'out_of_range', distanceKm: km, maxKm: input.maxDistanceKm };
  }
  const tiers = sortFeeTiers(input.tiers);
  const meters = Math.round(km * 1000);
  const tier = tiers.find((candidate) => meters <= candidate.maxMeters) ?? tiers.at(-1);
  return { kind: 'in_range', surchargeMinor: tier?.feeMinor ?? 0, distanceKm: km };
}

export interface CarePriceInput {
  readonly visitFeeMinor: number;
  readonly travelSurchargeMinor: number;
  readonly careFees: Readonly<Record<PlantSize, number>>;
  readonly plants: readonly { readonly size: PlantSize; readonly quantity: number }[];
  /** Solo i servizi EXTRA del contratto: gli inclusi sono già nella tariffa. */
  readonly extras: readonly { readonly unit: CareServiceUnit; readonly priceMinor: number }[];
}

export interface CareVisitPrice {
  readonly plantCount: number;
  readonly visitFeeMinor: number;
  readonly travelSurchargeMinor: number;
  /** Care di tutte le piante per una visita. */
  readonly careMinor: number;
  /** Extra per visita e per pianta, per una visita. */
  readonly extrasMinor: number;
  /** Totale di una visita. */
  readonly perVisitMinor: number;
  /**
   * Extra una tantum: si pagano una volta, nel cargo dopo la visita in cui si fanno (ADR-082), al
   * prezzo copiato quando la squadra li segna.
   */
  readonly oneTimeMinor: number;
}

/**
 * Prezzo di una visita del contratto: tariffa + sovrapprezzo + care per pianta secondo la misura
 * + extra per visita e per pianta; a parte gli extra una tantum. Importi in unità minime.
 */
export function priceCareVisit(
  input: CarePriceInput,
):
  | { readonly ok: true; readonly price: CareVisitPrice }
  | { readonly ok: false; readonly error: 'amount_too_large' } {
  const plantCount = input.plants.reduce((total, plant) => total + plant.quantity, 0);
  const careMinor = input.plants.reduce(
    (total, plant) => total + plant.quantity * input.careFees[plant.size],
    0,
  );
  let extrasMinor = 0;
  let oneTimeMinor = 0;
  for (const extra of input.extras) {
    if (extra.unit === 'PER_VISIT') extrasMinor += extra.priceMinor;
    else if (extra.unit === 'PER_PLANT') extrasMinor += extra.priceMinor * plantCount;
    else oneTimeMinor += extra.priceMinor;
  }
  const perVisitMinor = input.visitFeeMinor + input.travelSurchargeMinor + careMinor + extrasMinor;
  if (
    ![perVisitMinor, oneTimeMinor, careMinor, extrasMinor].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT_MINOR,
    )
  ) {
    return { ok: false, error: 'amount_too_large' };
  }
  return {
    ok: true,
    price: {
      plantCount,
      visitFeeMinor: input.visitFeeMinor,
      travelSurchargeMinor: input.travelSurchargeMinor,
      careMinor,
      extrasMinor,
      perVisitMinor,
      oneTimeMinor,
    },
  };
}

/** Canone stimato di un mese: da–a, secondo quante visite cadono nel mese. */
export function estimateCareMonth(
  perVisitMinor: number,
  frequency: CareFrequency,
  weekdayCount: number,
): { readonly minMinor: number; readonly maxMinor: number } {
  const visits = careVisitsPerMonth(frequency, weekdayCount);
  return { minMinor: perVisitMinor * visits.min, maxMinor: perVisitMinor * visits.max };
}
