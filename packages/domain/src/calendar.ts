/**
 * Calendario della fioreria — regole pure (date senza orario, nel fuso della fioreria).
 *
 *  - Viste: mese (griglia di settimane intere), settimana, giorno e agenda (60 giorni).
 *  - La settimana inizia la domenica in Messico e negli Stati Uniti, il lunedì in Italia.
 *  - Le date speciali dei clienti si ripetono ogni anno; il 29 febbraio, negli anni non
 *    bisestili, cade il 28 (come `nextOccurrence`).
 */
import type { SupportedLocale } from './i18n';

export const CALENDAR_VIEWS = ['month', 'week', 'day', 'agenda'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** Giorni coperti dall'agenda a partire dalla data scelta. */
export const AGENDA_DAYS = 60;

export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtc(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function fromUtc(ms: number): CalendarDate {
  const value = new Date(ms);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-11-22". */
export function toIsoDate(date: CalendarDate): string {
  const pad = (value: number, length: number) => String(value).padStart(length, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** Data "AAAA-MM-GG" valida, o null. */
export function parseIsoDate(value: unknown): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.year < 1900 || date.year > 2200 || date.month < 1 || date.month > 12) return null;
  if (date.day < 1 || date.day > daysInMonth(date.year, date.month)) return null;
  return date;
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromUtc(toUtc(date) + days * MS_PER_DAY);
}

/** Stesso giorno del mese `months` mesi dopo (o prima), fermandosi all'ultimo giorno. */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Giorni da `from` a `to` (negativo se `to` viene prima). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return toUtc(a) - toUtc(b);
}

export function sameDate(a: CalendarDate, b: CalendarDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** 0 = domenica … 6 = sabato. */
export function dayOfWeek(date: CalendarDate): number {
  return new Date(toUtc(date)).getUTCDay();
}

/** Primo giorno della settimana per lingua: domenica (0) o lunedì (1). */
export function weekStartsOn(locale: SupportedLocale): 0 | 1 {
  return locale === 'it-IT' ? 1 : 0;
}

export function startOfWeek(date: CalendarDate, firstDay: 0 | 1): CalendarDate {
  const offset = (dayOfWeek(date) - firstDay + 7) % 7;
  return addDays(date, -offset);
}

export interface CalendarRange {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  /** Tutti i giorni dell'intervallo, in ordine (per la griglia del mese: settimane intere). */
  readonly days: readonly CalendarDate[];
}

function rangeOf(from: CalendarDate, to: CalendarDate): CalendarRange {
  const days: CalendarDate[] = [];
  for (let day = from; compareDates(day, to) <= 0; day = addDays(day, 1)) days.push(day);
  return { from, to, days };
}

/** Giorni mostrati da una vista attorno alla data scelta. */
export function calendarRange(
  view: CalendarView,
  date: CalendarDate,
  firstDay: 0 | 1,
): CalendarRange {
  if (view === 'day') return rangeOf(date, date);
  if (view === 'week') {
    const from = startOfWeek(date, firstDay);
    return rangeOf(from, addDays(from, 6));
  }
  if (view === 'agenda') return rangeOf(date, addDays(date, AGENDA_DAYS - 1));
  const first = { year: date.year, month: date.month, day: 1 };
  const last = { year: date.year, month: date.month, day: daysInMonth(date.year, date.month) };
  const from = startOfWeek(first, firstDay);
  const to = addDays(startOfWeek(last, firstDay), 6);
  return rangeOf(from, to);
}

/** Data della vista precedente (-1) o successiva (+1). */
export function shiftDate(view: CalendarView, date: CalendarDate, step: -1 | 1): CalendarDate {
  if (view === 'month') return addMonths(date, step);
  if (view === 'week') return addDays(date, 7 * step);
  if (view === 'agenda') return addDays(date, AGENDA_DAYS * step);
  return addDays(date, step);
}

/** Vista e data dalla query (?view=…&date=…), con il mese di oggi come ripiego. */
export function parseCalendarQuery(
  query: { readonly view?: unknown; readonly date?: unknown },
  today: CalendarDate,
): { readonly view: CalendarView; readonly date: CalendarDate } {
  const view = CALENDAR_VIEWS.find((value) => value === query.view) ?? 'month';
  return { view, date: parseIsoDate(query.date) ?? today };
}

/**
 * Giorni dell'intervallo in cui cade una data che si ripete ogni anno (mese, giorno). Il 29
 * febbraio, negli anni non bisestili, cade il 28.
 */
export function yearlyOccurrences(
  month: number,
  day: number,
  from: CalendarDate,
  to: CalendarDate,
): CalendarDate[] {
  const result: CalendarDate[] = [];
  for (let year = from.year; year <= to.year; year++) {
    const actualDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
    const candidate = { year, month, day: actualDay };
    if (compareDates(candidate, from) >= 0 && compareDates(candidate, to) <= 0) {
      result.push(candidate);
    }
  }
  return result;
}

/** Mesi (1–12) toccati dall'intervallo: per leggere dal database solo le date utili. */
export function monthsInRange(from: CalendarDate, to: CalendarDate): number[] {
  const months = new Set<number>();
  for (let cursor = { ...from, day: 1 }; compareDates(cursor, to) <= 0;) {
    months.add(cursor.month);
    cursor = addMonths(cursor, 1);
  }
  return [...months].sort((a, b) => a - b);
}
