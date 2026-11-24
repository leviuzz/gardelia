/**
 * Floral Care, blocco 4 (ADR-083): giorni bloccati, vacanze e cambi di massa — regole pure.
 *
 *  - Un blocco toglie dei giorni (dal–al) a tutte le fasce o a una sola: lì non si prenota più
 *    niente (generazione, spostamenti, visite extra, poi il cliente dal portale).
 *  - Le visite già fissate in quei giorni si spostano tutte insieme nel giorno libero più vicino
 *    dello stesso mese (se non c'è posto: "Por reprogramar") oppure si cancellano, come se le
 *    togliesse la fioreria (credito nel cargo dopo, ADR-082). Le visite che nasceranno dopo in
 *    quei giorni seguono la stessa scelta.
 *  - Giorni di punta proposti dal mercato (14 febbraio, 10 maggio, 1–2 novembre, 12 dicembre in
 *    Messico): si bloccano con un tocco, mai da soli (PROPOSTO nel piano).
 */
import { z } from 'zod';
import { addDays, compareDates, daysBetween, type CalendarDate } from './calendar';
import { careDateField } from './floral-care';
import type { MarketCountry } from './markets';
import { optionalUuidField } from './order';
import { checkboxField, requiredText, toTrimmedString } from './validation';

export const CARE_BLOCK_LIMITS = {
  /** Nome del blocco ("Vacaciones de diciembre"): lo vede solo la fioreria. */
  label: 80,
  /** Giorni di un blocco, al massimo: tre mesi. */
  maxDays: 92,
  /** Un blocco comincia al più tardi fra un anno. */
  horizonDays: 365,
  /** Blocchi attivi per fioreria: oltre è un errore, non un uso normale. */
  active: 60,
  /** Visite toccate da un blocco in una volta sola (una transazione). */
  affectedVisits: 500,
} as const;

/** Cosa succede alle visite dei giorni bloccati. */
export const CARE_BLOCK_ACTIONS = ['MOVE', 'CANCEL'] as const;
export type CareBlockAction = (typeof CARE_BLOCK_ACTIONS)[number];

/** Cosa è successo a una visita toccata da un blocco. */
export const CARE_BLOCK_OUTCOMES = ['MOVED', 'TO_RESCHEDULE', 'CANCELLED'] as const;
export type CareBlockOutcome = (typeof CARE_BLOCK_OUTCOMES)[number];

export interface CareBlockRange {
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  /** null = tutte le fasce (anche le visite extra a un'ora libera). */
  readonly slotId: string | null;
}

/**
 * Il blocco copre questa visita? Il giorno è dentro e la fascia è la sua (o il blocco è di tutto
 * il giorno). Una visita a un'ora libera (senza fascia) la copre solo un blocco di tutto il giorno.
 */
export function careBlockCovers(
  block: CareBlockRange,
  date: CalendarDate,
  slotId: string | null,
): boolean {
  if (compareDates(date, block.startDate) < 0 || compareDates(date, block.endDate) > 0) {
    return false;
  }
  return block.slotId === null || (slotId !== null && block.slotId === slotId);
}

// -----------------------------------------------------------------------------
// Modulo
// -----------------------------------------------------------------------------

const careBlockShape = {
  startDate: careDateField,
  endDate: careDateField,
  /** Vuoto = tutto il giorno. */
  slotId: optionalUuidField,
  label: requiredText(CARE_BLOCK_LIMITS.label),
  action: z.preprocess(
    toTrimmedString,
    z.union([z.literal('').transform(() => 'MOVE' as const), z.enum(CARE_BLOCK_ACTIONS)], {
      error: 'invalid_option',
    }),
  ),
};

function checkRange(
  value: { readonly startDate: CalendarDate; readonly endDate: CalendarDate },
  ctx: z.RefinementCtx,
): void {
  if (compareDates(value.endDate, value.startDate) < 0) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'care_block_range' });
    return;
  }
  if (daysBetween(value.startDate, value.endDate) + 1 > CARE_BLOCK_LIMITS.maxDays) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'care_block_too_long' });
  }
}

/** "Bloquear días": dal–al, fascia (o tutto il giorno), nome e cosa fare con le visite. */
export const careBlockSchema = z.object(careBlockShape).superRefine(checkRange);
export type CareBlockInput = z.infer<typeof careBlockSchema>;

/**
 * Il salvataggio: lo stesso modulo, l'impronta del piano visto nell'anteprima (se le visite sono
 * cambiate nel frattempo si rivede), l'email facoltativa e "Sí, avisé al cliente".
 */
export const careBlockConfirmSchema = z
  .object({
    ...careBlockShape,
    plan: z.preprocess(toTrimmedString, z.string().max(64).catch('')),
    sendEmail: checkboxField(),
    customerNotified: checkboxField(),
  })
  .superRefine(checkRange);
export type CareBlockConfirmInput = z.infer<typeof careBlockConfirmSchema>;

/** "Alguien no puede ir": le visite di una persona in quei giorni passano a un'altra (o a nessuno). */
export const careReassignSchema = z
  .object({
    fromMembershipId: z.preprocess(toTrimmedString, z.uuid({ error: 'required' })),
    /** Vuoto = senza persona assegnata. */
    toMembershipId: optionalUuidField,
    startDate: careDateField,
    endDate: careDateField,
  })
  .superRefine((value, ctx) => {
    checkRange(value, ctx);
    if (value.toMembershipId === value.fromMembershipId) {
      ctx.addIssue({ code: 'custom', path: ['toMembershipId'], message: 'care_reassign_same' });
    }
  });
export type CareReassignInput = z.infer<typeof careReassignSchema>;

// -----------------------------------------------------------------------------
// Dove va una visita di un giorno bloccato
// -----------------------------------------------------------------------------

export interface CareMonthCandidate {
  readonly date: CalendarDate;
  readonly slotId: string;
  /** Posti liberi (0 se la fascia è bloccata quel giorno). */
  readonly free: number;
  readonly startMinutes: number;
}

/**
 * Il posto per una visita di un giorno bloccato: la sua fascia o un'altra lo stesso giorno (un
 * blocco di una sola fascia), poi il giorno con posto più vicino dello stesso mese, prima o dopo
 * (a pari distanza il giorno prima, poi la fascia più presto). Null = nessun posto nel mese.
 */
export function pickCareSlotInMonth(input: {
  readonly date: CalendarDate;
  readonly preferredSlotId: string | null;
  readonly seats: number;
  readonly candidates: readonly CareMonthCandidate[];
}): CareMonthCandidate | null {
  const fits = input.candidates.filter(
    (candidate) =>
      candidate.free >= input.seats &&
      candidate.date.year === input.date.year &&
      candidate.date.month === input.date.month,
  );
  const distance = (candidate: CareMonthCandidate) =>
    Math.abs(daysBetween(input.date, candidate.date));
  const sorted = [...fits].sort(
    (a, b) =>
      distance(a) - distance(b) ||
      compareDates(a.date, b.date) ||
      Number(b.slotId === input.preferredSlotId) - Number(a.slotId === input.preferredSlotId) ||
      a.startMinutes - b.startMinutes,
  );
  return sorted[0] ?? null;
}

// -----------------------------------------------------------------------------
// Impronta del piano
// -----------------------------------------------------------------------------

export interface CareBlockPlannedChange {
  readonly visitId: string;
  readonly outcome: CareBlockOutcome;
  /** Il giorno nuovo ("AAAA-MM-GG") e la fascia, solo per MOVED. */
  readonly toDate: string | null;
  readonly toSlotId: string | null;
}

/**
 * Impronta del piano dell'anteprima: la stessa se le stesse visite vanno negli stessi posti, in
 * qualsiasi ordine. FNV-1a a 32 bit due volte (con due semi): basta a riconoscere un cambio, non è
 * un segreto.
 */
export function careBlockPlanFingerprint(changes: readonly CareBlockPlannedChange[]): string {
  const text = changes
    .map((change) =>
      [change.visitId, change.outcome, change.toDate ?? '', change.toSlotId ?? ''].join(':'),
    )
    .sort()
    .join('|');
  const fnv = (seed: number) => {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  return `${changes.length}-${fnv(0x811c9dc5)}${fnv(0x01000193)}`;
}

// -----------------------------------------------------------------------------
// Giorni di punta proposti
// -----------------------------------------------------------------------------

export const CARE_PEAK_DAY_KEYS = ['valentine', 'mothers', 'deadDays', 'guadalupe'] as const;
export type CarePeakDayKey = (typeof CARE_PEAK_DAY_KEYS)[number];

export interface CarePeakDay {
  readonly key: CarePeakDayKey;
  readonly month: number;
  readonly day: number;
  /** Giorni di fila (1–2 novembre: 2). */
  readonly days: number;
}

/**
 * I giorni di più lavoro della fioreria per mercato (PROPOSTO nel piano, da confermare con le
 * fiorerie). L'Italia ha date diverse (la festa della mamma si sposta): si scrivono quando il
 * mercato si apre.
 */
export const CARE_PEAK_DAYS: Readonly<Record<MarketCountry, readonly CarePeakDay[]>> = {
  MX: [
    { key: 'valentine', month: 2, day: 14, days: 1 },
    { key: 'mothers', month: 5, day: 10, days: 1 },
    { key: 'deadDays', month: 11, day: 1, days: 2 },
    { key: 'guadalupe', month: 12, day: 12, days: 1 },
  ],
  IT: [],
};

export interface UpcomingCarePeakDay {
  readonly key: CarePeakDayKey;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
}

/**
 * La prossima volta di ogni giorno di punta, da oggi entro un anno, in ordine di data. Se è già
 * cominciato (oggi è il 2 novembre) vale da oggi alla fine.
 */
export function upcomingCarePeakDays(
  market: MarketCountry,
  today: CalendarDate,
): UpcomingCarePeakDay[] {
  const result: UpcomingCarePeakDay[] = [];
  for (const peak of CARE_PEAK_DAYS[market]) {
    for (const year of [today.year, today.year + 1]) {
      const start = { year, month: peak.month, day: peak.day };
      const end = addDays(start, peak.days - 1);
      if (compareDates(end, today) < 0) continue;
      result.push({
        key: peak.key,
        startDate: compareDates(start, today) < 0 ? today : start,
        endDate: end,
      });
      break;
    }
  }
  return result
    .filter((peak) => daysBetween(today, peak.startDate) <= CARE_BLOCK_LIMITS.horizonDays)
    .sort((a, b) => compareDates(a.startDate, b.startDate));
}
