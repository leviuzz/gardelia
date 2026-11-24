/**
 * Orari di apertura della tienda (V1 §2.2, deciso dal founder il 24/11/2026: "tutte le fasce, nessun
 * limite"). Per ogni giorno della settimana zero o più fasce "Desde/Hasta"; un giorno senza fasce è
 * chiuso. Nessuna fascia in tutta la settimana = orario non indicato (non si mostra nulla).
 * Si vedono nella tienda en línea e nelle cotizaciones stampate.
 *
 * Diverso dai giorni di chiusura delle consegne (ADR-055): una fioreria può consegnare la domenica
 * con la tienda chiusa, o viceversa. La pagina delle impostazioni segnala quando non coincidono.
 */
import { z } from 'zod';
import { WEEKDAYS, WEEKDAYS_FROM_MONDAY, type Weekday } from './delivery';
import { formatTimeOfDay, parseTimeInput } from './order';
import { toTrimmedString } from './validation';

export const OPENING_HOURS_LIMITS = {
  /** Difesa contro i form manomessi: nessuna fioreria vera arriva a tanto in un giorno. */
  rangesPerDay: 12,
} as const;

/** Minuti dalla mezzanotte nel fuso della fioreria; `start < end`, stesso giorno. */
export interface OpeningRange {
  readonly start: number;
  readonly end: number;
}

export interface OpeningDay {
  readonly weekday: Weekday;
  /** In ordine di inizio; vuoto = chiuso. */
  readonly ranges: readonly OpeningRange[];
}

/** Nome del campo di un giorno nel form: `d1.start`, `d1.end` (ripetuti, uno per fascia). */
export function openingDayField(weekday: Weekday): `d${Weekday}` {
  return `d${weekday}`;
}

/** Tutti i nomi ripetuti del form, per `formDataToObject`. */
export const OPENING_HOURS_FORM_KEYS: readonly string[] = WEEKDAYS.flatMap((weekday) => [
  `${openingDayField(weekday)}.start`,
  `${openingDayField(weekday)}.end`,
]);

const timeList = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  },
  z.array(z.preprocess(toTrimmedString, z.string())),
);

const dayInput = z
  .object({ start: timeList, end: timeList })
  .optional()
  .transform((value) => value ?? { start: [], end: [] });

/**
 * Il form della settimana: per ogni giorno le fasce come coppie `start`/`end` nello stesso ordine.
 * Errori sulla fascia (`d1.0`: `required`, `invalid_time_window`, `opening_hours_overlap`) o sul
 * giorno (`d1`: `too_many_items`, `invalid_option` se le liste non hanno la stessa lunghezza).
 */
export const openingHoursSchema = z
  .object({
    d0: dayInput,
    d1: dayInput,
    d2: dayInput,
    d3: dayInput,
    d4: dayInput,
    d5: dayInput,
    d6: dayInput,
  })
  .transform((input, ctx): OpeningDay[] => {
    const days: OpeningDay[] = [];
    for (const weekday of WEEKDAYS) {
      const field = openingDayField(weekday);
      const { start, end } = input[field];
      if (start.length !== end.length) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'invalid_option' });
        continue;
      }
      if (start.length > OPENING_HOURS_LIMITS.rangesPerDay) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'too_many_items' });
        continue;
      }
      const ranges: (OpeningRange & { readonly index: number })[] = [];
      start.forEach((rawStart, index) => {
        const rawEnd = end[index] ?? '';
        if (rawStart === '' || rawEnd === '') {
          ctx.addIssue({ code: 'custom', path: [field, index], message: 'required' });
          return;
        }
        const from = parseTimeInput(rawStart);
        const to = parseTimeInput(rawEnd);
        if (from === null || to === null || from >= to) {
          ctx.addIssue({ code: 'custom', path: [field, index], message: 'invalid_time_window' });
          return;
        }
        ranges.push({ start: from, end: to, index });
      });
      ranges.sort((a, b) => a.start - b.start);
      for (let i = 1; i < ranges.length; i += 1) {
        const previous = ranges[i - 1]!;
        const current = ranges[i]!;
        // Fasce che si toccano (14:00 e 14:00) sono un errore anche loro: basta una fascia sola.
        if (current.start <= previous.end) {
          ctx.addIssue({
            code: 'custom',
            path: [field, current.index],
            message: 'opening_hours_overlap',
          });
        }
      }
      days.push({ weekday, ranges: ranges.map(({ start: s, end: e }) => ({ start: s, end: e })) });
    }
    return days;
  });

/** La fioreria ha indicato almeno una fascia. */
export function hasOpeningHours(days: readonly OpeningDay[]): boolean {
  return days.some((day) => day.ranges.length > 0);
}

/** Le fasce di un giorno come testo: "09:00–14:00, 16:00–20:00". */
export function formatOpeningRanges(ranges: readonly OpeningRange[]): string {
  return ranges
    .map((range) => `${formatTimeOfDay(range.start)}–${formatTimeOfDay(range.end)}`)
    .join(', ');
}

/** Giorni consecutivi (da lunedì) con le stesse fasce, per scrivere l'orario in poche righe. */
export interface OpeningDayGroup {
  readonly first: Weekday;
  readonly last: Weekday;
  /** Vuoto = chiuso. */
  readonly ranges: readonly OpeningRange[];
}

function sameRanges(a: readonly OpeningRange[], b: readonly OpeningRange[]): boolean {
  return (
    a.length === b.length &&
    a.every((range, index) => range.start === b[index]?.start && range.end === b[index]?.end)
  );
}

/**
 * "Lunes a viernes 09:00–14:00, 16:00–20:00 · Sábado 10:00–14:00 · Domingo cerrado": i giorni da
 * lunedì a domenica, uniti quando hanno le stesse fasce. Un giorno che manca vale chiuso.
 */
export function groupOpeningDays(days: readonly OpeningDay[]): OpeningDayGroup[] {
  const byWeekday = new Map(days.map((day) => [day.weekday, day.ranges]));
  const groups: OpeningDayGroup[] = [];
  for (const weekday of WEEKDAYS_FROM_MONDAY) {
    const ranges = byWeekday.get(weekday) ?? [];
    const previous = groups[groups.length - 1];
    if (previous && sameRanges(previous.ranges, ranges)) {
      groups[groups.length - 1] = { ...previous, last: weekday };
    } else {
      groups.push({ first: weekday, last: weekday, ranges });
    }
  }
  return groups;
}

/**
 * I giorni in cui la tienda è chiusa ma si accettano consegne e ritiri (i giorni di chiusura delle
 * consegne sono un'impostazione a parte): la pagina chiede di controllare.
 */
export function closedButDelivering(
  days: readonly OpeningDay[],
  deliveryClosedWeekdays: readonly number[],
): Weekday[] {
  if (!hasOpeningHours(days)) return [];
  const byWeekday = new Map(days.map((day) => [day.weekday, day.ranges]));
  return WEEKDAYS_FROM_MONDAY.filter(
    (weekday) =>
      (byWeekday.get(weekday) ?? []).length === 0 && !deliveryClosedWeekdays.includes(weekday),
  );
}
