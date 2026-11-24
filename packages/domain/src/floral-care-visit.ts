/**
 * Floral Care, blocco 2 (ADR-076): la visita dal telefono. Regole pure, senza I/O:
 *  - i passi della visita (servizi, piante, foto, materiali, avvisi, nota) e i loro moduli;
 *  - il conteggio delle piante per il resoconto del cliente;
 *  - quando si cancellano le foto: 30 giorni dopo la fine del contratto (decisione del founder);
 *  - l'unico controllo per le email di Floral Care al cliente: fioreria LIVE e attiva, mai demo.
 */
import { z } from 'zod';
import { addDays, compareDates, type CalendarDate } from './calendar';
import { CARE_LIMITS, type CareServiceUnit, type CareVisitStatus } from './floral-care';
import {
  checkboxField,
  optionalInteger,
  optionalText,
  requiredInteger,
  requiredText,
  toTrimmedString,
} from './validation';

export const CARE_VISIT_LIMITS = {
  /** Foto per visita: una alla volta, ognuna nel limite di 4 MB per richiesta. */
  photos: 20,
  /** Nota su un servizio o su una pianta. */
  resultNote: 300,
  /** Avviso per chi gestisce (reposición, extra, altro). */
  followUpNote: 500,
  /** Avvisi aperti in una visita. */
  followUps: 20,
  /** Prodotti diversi usati in una visita. */
  materials: 30,
  /** Come le quantità dell'inventario. */
  materialQuantity: 100_000,
} as const;

/** Le foto si cancellano 30 giorni dopo l'ultimo giorno del contratto (decisione del founder). */
export const CARE_PHOTO_RETENTION_DAYS = 30;
/** Dopo 7 giorni di tentativi falliti la cancellazione diventa un errore nel log. */
export const CARE_PHOTO_PURGE_ALERT_DAYS = 7;

/** Tetti del lavoro giornaliero che cancella le foto: la route di manutenzione ha 60 s in tutto. */
export const CARE_PHOTO_PURGE = {
  contractsPerRun: 20,
  photosPerContract: 100,
  budgetMs: 20_000,
} as const;

/** Email di Floral Care: tentativi e attese del lavoro che le riprova. */
export const CARE_EMAIL_RETRY = {
  maxAttempts: 3,
  /** Una email non mandata entro 3 giorni non si manda più: il resoconto è vecchio. */
  days: 3,
  /** Una PENDING mai presa (l'azione si è interrotta dopo il commit) la manda il lavoro. */
  pendingMinutes: 10,
  /** Una SENDING ferma da un'ora si chiude come FAILED senza rimandarla: forse è partita. */
  sendingStaleMinutes: 60,
  /** Ogni invio è una richiesta al provider: pochi per giro e un tetto di tempo. */
  perRun: 20,
  budgetMs: 15_000,
} as const;

/** Stato di una pianta alla visita. */
export const CARE_PLANT_CONDITIONS = ['OK', 'ATTENTION', 'PROBLEM', 'DEAD'] as const;
export type CarePlantCondition = (typeof CARE_PLANT_CONDITIONS)[number];

/** Un servizio della checklist: fatto o no (con la nota del perché). */
export const CARE_SERVICE_OUTCOMES = ['DONE', 'SKIPPED'] as const;
export type CareServiceOutcome = (typeof CARE_SERVICE_OUTCOMES)[number];

/** Avvisi della squadra per chi gestisce: una pianta da reponer, un lavoro extra chiesto, altro. */
export const CARE_FOLLOW_UP_KINDS = ['REPLACEMENT', 'EXTRA', 'OTHER'] as const;
export type CareFollowUpKind = (typeof CARE_FOLLOW_UP_KINDS)[number];
export const CARE_FOLLOW_UP_STATUSES = ['OPEN', 'RESOLVED'] as const;
export type CareFollowUpStatus = (typeof CARE_FOLLOW_UP_STATUSES)[number];

/** Email di Floral Care al cliente (tabella d'uscita: una per visita e tipo). */
export const CARE_EMAIL_KINDS = ['VISIT_REPORT'] as const;
export type CareEmailKind = (typeof CARE_EMAIL_KINDS)[number];
export const CARE_EMAIL_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED'] as const;
export type CareEmailStatus = (typeof CARE_EMAIL_STATUSES)[number];

// -----------------------------------------------------------------------------
// Stati della visita
// -----------------------------------------------------------------------------

/** "Empezar visita": solo una visita programmata (la data la controlla il server). */
export function canStartCareVisit(status: CareVisitStatus): boolean {
  return status === 'SCHEDULED';
}

/** I passi (servizi, piante, foto, materiali, avvisi, nota) si registrano a visita in corso. */
export function canWorkOnCareVisit(status: CareVisitStatus): boolean {
  return status === 'IN_PROGRESS';
}

/** Il resoconto e il suo link esistono per una visita chiusa: hecha o no realizada. */
export function canShareCareVisit(status: CareVisitStatus): boolean {
  return status === 'DONE' || status === 'NOT_DONE';
}

/**
 * L'unico controllo per tutte le email di Floral Care al cliente: la fioreria è LIVE e attiva.
 * Una fioreria demo (dati di prova, ADR-016) non scrive mai a clienti veri.
 */
export function careEmailsAllowed(tenant: {
  readonly mode: 'LIVE' | 'DEMO';
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}): boolean {
  return tenant.mode === 'LIVE' && tenant.status === 'ACTIVE';
}

/** Dove va il resoconto: solo se chiesto, la fioreria può scrivere e il cliente ha l'email. */
export function careReportRecipient(input: {
  readonly requested: boolean;
  readonly allowed: boolean;
  readonly customerEmail: string | null;
}): string | null {
  if (!input.requested || !input.allowed) return null;
  const email = input.customerEmail?.trim() ?? '';
  return email === '' ? null : email;
}

// -----------------------------------------------------------------------------
// Checklist e piante
// -----------------------------------------------------------------------------

/**
 * La checklist di una visita: i servizi del contratto, tranne quelli "una sola vez" già fatti in
 * una visita precedente (un trasplante si fa una volta).
 */
export function careChecklist<
  T extends { readonly serviceId: string; readonly unit: CareServiceUnit },
>(services: readonly T[], oneTimeDone: ReadonlySet<string>): T[] {
  return services.filter(
    (service) => service.unit !== 'ONE_TIME' || !oneTimeDone.has(service.serviceId),
  );
}

export interface CarePlantTally {
  /** Piante in tutto (un gruppo conta la sua quantità). */
  readonly total: number;
  readonly ok: number;
  readonly attention: number;
  readonly problem: number;
  readonly dead: number;
  /** Ancora senza stato. */
  readonly unmarked: number;
}

/**
 * Le piante per stato, per il resoconto. In un gruppo ("12 potos") con un problema `affected` dice
 * quante sono toccate: le altre stanno bene. Senza `affected` conta tutto il gruppo.
 */
export function carePlantTally(
  plants: readonly {
    readonly quantity: number;
    readonly condition: CarePlantCondition | null;
    readonly affected: number | null;
  }[],
): CarePlantTally {
  const tally = { total: 0, ok: 0, attention: 0, problem: 0, dead: 0, unmarked: 0 };
  for (const plant of plants) {
    tally.total += plant.quantity;
    if (plant.condition === null) {
      tally.unmarked += plant.quantity;
      continue;
    }
    if (plant.condition === 'OK') {
      tally.ok += plant.quantity;
      continue;
    }
    const touched =
      plant.affected === null ? plant.quantity : Math.min(plant.affected, plant.quantity);
    tally.ok += plant.quantity - touched;
    if (plant.condition === 'ATTENTION') tally.attention += touched;
    else if (plant.condition === 'PROBLEM') tally.problem += touched;
    else tally.dead += touched;
  }
  return tally;
}

// -----------------------------------------------------------------------------
// Foto: quando si cancellano
// -----------------------------------------------------------------------------

/** Il giorno in cui le foto di un contratto finito si cancellano (calendario della fioreria). */
export function carePhotoPurgeDate(endDate: CalendarDate): CalendarDate {
  return addDays(endDate, CARE_PHOTO_RETENTION_DAYS);
}

/** Le foto del contratto vanno cancellate oggi o sono già in ritardo. */
export function isCarePhotoPurgeDue(endDate: CalendarDate, today: CalendarDate): boolean {
  return compareDates(today, carePhotoPurgeDate(endDate)) >= 0;
}

/** La cancellazione fallisce da 7 giorni dopo la data dovuta: va segnalata come errore. */
export function isCarePhotoPurgeOverdue(endDate: CalendarDate, today: CalendarDate): boolean {
  return (
    compareDates(today, addDays(carePhotoPurgeDate(endDate), CARE_PHOTO_PURGE_ALERT_DAYS)) >= 0
  );
}

// -----------------------------------------------------------------------------
// Moduli dei passi
// -----------------------------------------------------------------------------

const requiredUuid = z.preprocess(toTrimmedString, z.uuid({ error: 'required' }));

const optionalUuid = z.preprocess(
  toTrimmedString,
  z.union([z.literal('').transform(() => null), z.uuid()], { error: 'invalid_option' }),
);

function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    toTrimmedString,
    z.union([z.literal('').transform(() => null), z.enum(values)], { error: 'invalid_option' }),
  );
}

function requiredEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(toTrimmedString, z.enum(values, { error: 'required' }));
}

/** Un servizio della checklist: "Hecho", "No se hizo" o vuoto (togli la scelta). */
export const careServiceResultSchema = z.object({
  serviceId: requiredUuid,
  outcome: optionalEnum(CARE_SERVICE_OUTCOMES),
  note: optionalText(CARE_VISIT_LIMITS.resultNote),
});
export type CareServiceResultInput = z.infer<typeof careServiceResultSchema>;

/**
 * Lo stato di una pianta. `affected`: in un gruppo, quante sono toccate (solo se non sta bene;
 * il server controlla che non superi la quantità del gruppo).
 */
export const carePlantResultSchema = z
  .object({
    plantId: requiredUuid,
    condition: requiredEnum(CARE_PLANT_CONDITIONS),
    affected: optionalInteger({ min: 1, max: CARE_LIMITS.plantQuantity }),
    note: optionalText(CARE_VISIT_LIMITS.resultNote),
  })
  .transform((input) => (input.condition === 'OK' ? { ...input, affected: null } : input));
export type CarePlantResultInput = z.infer<typeof carePlantResultSchema>;

/** Un materiale usato: quantità 0 toglie la riga. */
export const careMaterialSchema = z.object({
  catalogItemId: requiredUuid,
  quantity: requiredInteger({ min: 0, max: CARE_VISIT_LIMITS.materialQuantity }),
});
export type CareMaterialInput = z.infer<typeof careMaterialSchema>;

/** La nota che il cliente legge nel resoconto. */
export const careVisitNoteSchema = z.object({ note: optionalText(CARE_LIMITS.notes) });
export type CareVisitNoteInput = z.infer<typeof careVisitNoteSchema>;

/** Avviso per chi gestisce: cosa, eventualmente quale pianta e quante, e una nota. */
export const careFollowUpSchema = z.object({
  kind: requiredEnum(CARE_FOLLOW_UP_KINDS),
  plantId: optionalUuid,
  quantity: optionalInteger({ min: 1, max: CARE_LIMITS.plantQuantity }),
  note: requiredText(CARE_VISIT_LIMITS.followUpNote),
});
export type CareFollowUpInput = z.infer<typeof careFollowUpSchema>;

/** Chi gestisce segna l'avviso come atteso, con una nota facoltativa. */
export const careFollowUpResolveSchema = z.object({
  note: optionalText(CARE_VISIT_LIMITS.followUpNote),
});

/** Una foto della visita: la chiave del file (per i nuovi tentativi) e la pianta, se c'è. */
export const carePhotoUploadSchema = z.object({
  uploadKey: requiredUuid,
  plantId: optionalUuid,
});
export type CarePhotoUploadInput = z.infer<typeof carePhotoUploadSchema>;

/** "Terminar visita": mandare il resoconto, e la conferma se manca giacenza dei materiali. */
export const careFinishSchema = z.object({
  sendReport: checkboxField(),
  confirmShortage: checkboxField(),
});
export type CareFinishInput = z.infer<typeof careFinishSchema>;

/** "No se pudo": la nota per il cliente e se mandargli il resoconto. */
export const careNotDoneSchema = z.object({
  note: optionalText(CARE_LIMITS.notes),
  sendReport: checkboxField(),
});
export type CareNotDoneInput = z.infer<typeof careNotDoneSchema>;
