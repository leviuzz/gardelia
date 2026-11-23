/**
 * Impostazioni di consegna della fioreria (ADR-055, blocco A2 di docs/ORDERS_MARKETPLACE_PLAN.md):
 * fasce orarie proposte negli ordini, giorni di chiusura e costo di consegna predefinito.
 *
 * Il costo per distanza e il raggio servono le coordinate degli indirizzi (Google Places, O-14):
 * arrivano con quella decisione, qui non c'è nulla che finga di calcolarli.
 */
import { z } from 'zod';
import type { CurrencyCode } from './money';
import { parseTimeInput } from './order';
import { multiValueField, optionalMoneyField, toTrimmedString } from './validation';

export const DELIVERY_LIMITS = {
  /** Fasce orarie per fioreria: abbastanza per una giornata a blocchi di un'ora e mezza. */
  windows: 8,
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
