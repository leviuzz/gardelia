/**
 * Impostazioni di consegna della fioreria (ADR-055, blocco A2 di docs/ORDERS_MARKETPLACE_PLAN.md):
 * fasce orarie proposte negli ordini, giorni di chiusura e costo di consegna predefinito; costo per
 * distanza a fasce di km (ADR-069), con le coordinate di Google Places (ADR-059).
 */
import { z } from 'zod';
import type { CurrencyCode } from './money';
import { parseTimeInput } from './order';
import { distanceKm, type Coordinates } from './places';
import { moneyField, multiValueField, optionalMoneyField, toTrimmedString } from './validation';

export const DELIVERY_LIMITS = {
  /** Fasce orarie per fioreria: abbastanza per una giornata a blocchi di un'ora e mezza. */
  windows: 8,
  /** Fasce di costo per distanza per fioreria. */
  feeTiers: 8,
  /** Fin dove può arrivare l'ultima fascia (km). */
  maxDistanceKm: 100,
} as const;

/** 0 = domenica … 6 = sabato, come `Date.getUTCDay()`. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Ordine di visualizzazione in Messico e in Italia: la settimana comincia di lunedì. */
export const WEEKDAYS_FROM_MONDAY: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

/** Giorno della settimana di una data di calendario "AAAA-MM-GG" (null se non valida). */
export function weekdayOf(date: string): Weekday | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(value.getTime())) return null;
  const day = value.getUTCDay();
  return isWeekday(day) ? day : null;
}

/** La fioreria è chiusa quel giorno (avviso nei form: chi registra l'ordine decide). */
export function isClosedOn(date: string, closedWeekdays: readonly number[]): boolean {
  const day = weekdayOf(date);
  return day !== null && closedWeekdays.includes(day);
}

const requiredTime = z.preprocess(
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

/** Fascia "Desde/Hasta" in "HH:MM" → minuti dalla mezzanotte, in ordine. */
export const deliveryWindowSchema = z
  .object({ start: requiredTime, end: requiredTime })
  .superRefine((value, ctx) => {
    if (value.start >= value.end) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'invalid_time_window' });
    }
  });
export type DeliveryWindowInput = z.infer<typeof deliveryWindowSchema>;

const weekdayField = z.preprocess(
  (value) => (typeof value === 'string' && /^\d$/.test(value) ? Number(value) : value),
  z
    .number({ error: 'invalid_option' })
    .int({ error: 'invalid_option' })
    .refine(isWeekday, { error: 'invalid_option' }),
);

export function deliverySettingsSchema(currency: CurrencyCode) {
  return z.object({
    /** Checkbox ripetuti: i giorni in cui la fioreria non consegna né apre per i ritiri. */
    closedWeekdays: multiValueField(weekdayField, WEEKDAYS.length).transform((days) =>
      [...new Set(days)].sort((a, b) => a - b),
    ),
    /** Vuoto = nessun costo proposto. */
    defaultFee: optionalMoneyField(currency).transform((value) => value ?? 0),
  });
}
export type DeliverySettingsInput = z.infer<ReturnType<typeof deliverySettingsSchema>>;

// -----------------------------------------------------------------------------
// Costo di consegna per distanza (ADR-069)
// -----------------------------------------------------------------------------

/** "Hasta 3.5 km": da 0.1 a 100 km, al massimo un decimale (punto o virgola) → metri. */
const distanceKmField = z.preprocess(
  toTrimmedString,
  z.string().transform((value, ctx) => {
    if (value === '') {
      ctx.addIssue({ code: 'custom', message: 'required' });
      return z.NEVER;
    }
    if (!/^\d{1,3}(?:[.,]\d)?$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'invalid_number' });
      return z.NEVER;
    }
    const meters = Math.round(Number(value.replace(',', '.')) * 1000);
    if (meters < 100 || meters > DELIVERY_LIMITS.maxDistanceKm * 1000) {
      ctx.addIssue({ code: 'custom', message: 'out_of_range' });
      return z.NEVER;
    }
    return meters;
  }),
);

/** Una fascia: "hasta X km cuesta Y". */
export function deliveryFeeTierSchema(currency: CurrencyCode) {
  return z.object({ upToKm: distanceKmField, fee: moneyField(currency) });
}
export type DeliveryFeeTierInput = z.infer<ReturnType<typeof deliveryFeeTierSchema>>;

export interface DeliveryFeeTier {
  /** Fin dove arriva la fascia, in metri (inclusa). */
  readonly maxMeters: number;
  readonly feeMinor: number;
}

/** Come si è deciso il costo di consegna di un indirizzo. */
export type DeliveryFeeQuote =
  /** Dalla fascia che comprende la distanza. */
  | {
      readonly kind: 'distance';
      readonly feeMinor: number;
      readonly distanceKm: number;
    }
  /** Oltre l'ultima fascia: la fioreria non consegna così lontano. */
  | {
      readonly kind: 'out_of_zone';
      readonly distanceKm: number;
      readonly maxKm: number;
    }
  /** Costo abituale: nessuna fascia, o distanza sconosciuta (coordinate mancanti o scadute). */
  | { readonly kind: 'default'; readonly feeMinor: number };

/** Distanza in linea retta in km, con un decimale (quella che si mostra e si confronta). */
export function roundedDistanceKm(from: Coordinates, to: Coordinates): number {
  return Math.round(distanceKm(from, to) * 10) / 10;
}

export function sortFeeTiers(tiers: readonly DeliveryFeeTier[]): DeliveryFeeTier[] {
  return [...tiers].sort((a, b) => a.maxMeters - b.maxMeters);
}

/**
 * Costo di consegna di un indirizzo: la prima fascia che arriva fin lì (distanza in linea retta
 * fra la tienda e l'indirizzo); senza fasce o senza le due posizioni, il costo abituale.
 */
export function quoteDeliveryFee(input: {
  readonly tiers: readonly DeliveryFeeTier[];
  readonly defaultFeeMinor: number;
  readonly from: Coordinates | null;
  readonly to: Coordinates | null;
}): DeliveryFeeQuote {
  const tiers = sortFeeTiers(input.tiers);
  const last = tiers.at(-1);
  if (!last || !input.from || !input.to) {
    return { kind: 'default', feeMinor: input.defaultFeeMinor };
  }
  const km = roundedDistanceKm(input.from, input.to);
  const meters = Math.round(km * 1000);
  const tier = tiers.find((candidate) => meters <= candidate.maxMeters);
  if (!tier) return { kind: 'out_of_zone', distanceKm: km, maxKm: last.maxMeters / 1000 };
  return { kind: 'distance', feeMinor: tier.feeMinor, distanceKm: km };
}
