/**
 * Floral Care, blocco 5a (ADR-084): la pagina del cliente ("Mi Floral Care") — regole pure.
 *
 *  - La fioreria invita una persona (email) a vedere i contratti di un suo cliente: uno solo o
 *    tutti. L'invito vale 7 giorni e solo per la stessa email; la fioreria sceglie se la persona
 *    vede prezzi e cargos ("Puede ver precios y cobros", deciso dal founder il 24/11).
 *  - Un contratto attivo si vede e si può cambiare; finito resta in sola lettura 30 giorni (finché
 *    le foto si cancellano, decisione del founder), poi l'accesso si chiude.
 *  - "Cambiar fecha" (DECISO): solo nello stesso mese, fra le fasce libere, con il preavviso del
 *    contratto. Qui le regole che non chiedono il database; posti, blocchi e giorni occupati li
 *    controlla il servizio con il libro delle fasce.
 */
import { z } from 'zod';
import { addDays, compareDates, daysInMonth, type CalendarDate } from './calendar';
import {
  careDateField,
  type CareVisitStatus,
  type CustomerSubscriptionStatus,
} from './floral-care';
import { careVisitStartAt } from './floral-care-charges';
import { CARE_PHOTO_RETENTION_DAYS } from './floral-care-visit';
import { INVITATION_TTL_DAYS } from './team';
import { checkboxField, toTrimmedString } from './validation';

export const CARE_PORTAL_LIMITS = {
  /** Validità di un invito (come quelli della squadra). */
  inviteDays: INVITATION_TTL_DAYS,
  /** Inviti in attesa per cliente: oltre è un errore, non un uso normale. */
  pendingInvites: 10,
  /** Persone con accesso per cliente. */
  accesses: 20,
  /** Giorni di sola lettura dopo la fine del contratto: gli stessi delle foto. */
  readOnlyDays: CARE_PHOTO_RETENTION_DAYS,
  /** Preavviso per cambiare la data quando un contratto vecchio non l'ha copiato. */
  defaultNoticeHours: 24,
  /** Contratti nell'elenco di "Mi Floral Care". */
  contracts: 100,
} as const;

/** Cosa vede la persona invitata: questo contratto o tutti quelli del cliente. */
export const CARE_PORTAL_SCOPES = ['CONTRACT', 'CUSTOMER'] as const;
export type CarePortalScope = (typeof CARE_PORTAL_SCOPES)[number];

export const CARE_PORTAL_INVITE_STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const;
export type CarePortalInviteStatus = (typeof CARE_PORTAL_INVITE_STATUSES)[number];

/** Perché un accesso si è chiuso: a mano, cliente archiviato, contratto finito da 30 giorni. */
export const CARE_PORTAL_REVOKE_REASONS = [
  'MANUAL',
  'CUSTOMER_ARCHIVED',
  'CONTRACT_ENDED',
] as const;
export type CarePortalRevokeReason = (typeof CARE_PORTAL_REVOKE_REASONS)[number];

// -----------------------------------------------------------------------------
// Invito
// -----------------------------------------------------------------------------

/** "Invitar al portal": email, contratto o tutti, e se vede i soldi (casella spuntata di default). */
export const carePortalInviteSchema = z.object({
  email: z.preprocess(
    (value) => {
      const trimmed = toTrimmedString(value);
      return typeof trimmed === 'string' ? trimmed.toLowerCase() : trimmed;
    },
    z
      .string({ error: 'required' })
      .min(1, { error: 'required' })
      .pipe(z.email({ error: 'invalid_email' }).max(254, { error: 'too_long' })),
  ),
  scope: z.preprocess(
    toTrimmedString,
    z.union([z.literal('').transform(() => 'CONTRACT' as const), z.enum(CARE_PORTAL_SCOPES)], {
      error: 'invalid_option',
    }),
  ),
  canSeeMoney: checkboxField(),
});
export type CarePortalInviteInput = z.infer<typeof carePortalInviteSchema>;

/** Scadenza di un invito creato adesso. */
export function carePortalInviteExpiresAt(now: Date): Date {
  return new Date(now.getTime() + CARE_PORTAL_LIMITS.inviteDays * 24 * 3_600_000);
}

/** Lo stato vero di un invito: uno in attesa oltre la scadenza è scaduto anche prima del lavoro. */
export function carePortalInviteStatus(
  invite: { readonly status: CarePortalInviteStatus; readonly expiresAt: Date },
  now: Date,
): CarePortalInviteStatus {
  if (invite.status === 'PENDING' && invite.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return invite.status;
}

// -----------------------------------------------------------------------------
// Il contratto nella pagina del cliente
// -----------------------------------------------------------------------------

/**
 * Come si vede un contratto: aperto (attivo o in pausa), in sola lettura (finito, fino al giorno in
 * cui si cancellano le foto, escluso) o chiuso. È la stessa regola della funzione SQL
 * `app_portal_visible_contracts()`; un test le confronta.
 */
export type CarePortalContractState = 'OPEN' | 'READ_ONLY' | 'CLOSED';

export function carePortalContractState(input: {
  readonly status: CustomerSubscriptionStatus;
  readonly endDate: CalendarDate | null;
  readonly today: CalendarDate;
}): CarePortalContractState {
  if (input.status === 'ACTIVE' || input.status === 'PAUSED') return 'OPEN';
  if (input.status !== 'ENDED' || !input.endDate) return 'CLOSED';
  const closesOn = addDays(input.endDate, CARE_PORTAL_LIMITS.readOnlyDays);
  return compareDates(input.today, closesOn) < 0 ? 'READ_ONLY' : 'CLOSED';
}

// -----------------------------------------------------------------------------
// "Cambiar fecha"
// -----------------------------------------------------------------------------

/** "Cambiar fecha": giorno e fascia nuovi (il cliente sceglie solo fra le fasce, mai un'ora libera). */
export const carePortalMoveSchema = z.object({
  date: careDateField,
  slotId: z.preprocess(
    toTrimmedString,
    z
      .string()
      .min(1, { error: 'required' })
      .pipe(z.uuid({ error: 'invalid_option' })),
  ),
});
export type CarePortalMoveInput = z.infer<typeof carePortalMoveSchema>;

/** Fino a quando il cliente può cambiare la data: l'inizio della visita meno le ore del contratto. */
export function careCustomerChangeUntil(visitStart: Date | null, noticeHours: number): Date | null {
  if (!visitStart) return null;
  return new Date(visitStart.getTime() - Math.max(0, noticeHours) * 3_600_000);
}

/** Il primo inizio che il cliente può scegliere: adesso più le ore del contratto. */
export function careCustomerEarliestStart(now: Date, noticeHours: number): Date {
  return new Date(now.getTime() + Math.max(0, noticeHours) * 3_600_000);
}

/** I giorni del mese di una data: dal primo all'ultimo. */
export function careMonthBounds(date: CalendarDate): { from: CalendarDate; until: CalendarDate } {
  return {
    from: { year: date.year, month: date.month, day: 1 },
    until: { year: date.year, month: date.month, day: daysInMonth(date.year, date.month) },
  };
}

export type CareCustomerChangeProblem =
  'care_portal_contract_not_open' | 'care_portal_move_not_allowed' | 'care_portal_move_notice';

/**
 * La visita si può cambiare dal portale? Solo una visita regolare programmata (non extra, non "Por
 * reprogramar") di un contratto attivo, prima del termine del preavviso.
 */
export function careCustomerChangeProblem(input: {
  readonly contractStatus: CustomerSubscriptionStatus;
  readonly visit: {
    readonly status: CareVisitStatus;
    readonly isExtra: boolean;
    readonly scheduledDate: CalendarDate | null;
    readonly startMinutes: number | null;
    readonly slotId: string | null;
  };
  readonly noticeHours: number;
  readonly timeZone: string;
  readonly now: Date;
}): CareCustomerChangeProblem | null {
  if (input.contractStatus !== 'ACTIVE') return 'care_portal_contract_not_open';
  const { visit } = input;
  if (
    visit.status !== 'SCHEDULED' ||
    visit.isExtra ||
    !visit.scheduledDate ||
    visit.startMinutes === null ||
    !visit.slotId
  ) {
    return 'care_portal_move_not_allowed';
  }
  const until = careCustomerChangeUntil(
    careVisitStartAt(visit.scheduledDate, visit.startMinutes, input.timeZone),
    input.noticeHours,
  );
  if (!until || input.now.getTime() > until.getTime()) return 'care_portal_move_notice';
  return null;
}

export type CareCustomerTargetProblem =
  | 'care_portal_move_other_month'
  | 'care_portal_move_notice'
  | 'care_move_out_of_range'
  | 'care_portal_move_same';

/**
 * Il nuovo giorno e ora vanno bene, prima di guardare le fasce? Stesso mese della data attuale,
 * dentro il contratto, dopo il preavviso, e non lo stesso posto di adesso.
 */
export function careCustomerTargetProblem(input: {
  readonly current: { readonly date: CalendarDate; readonly slotId: string };
  readonly target: {
    readonly date: CalendarDate;
    readonly slotId: string;
    readonly startMinutes: number;
  };
  readonly contract: { readonly startDate: CalendarDate; readonly endDate: CalendarDate | null };
  readonly noticeHours: number;
  readonly timeZone: string;
  readonly now: Date;
}): CareCustomerTargetProblem | null {
  const { current, target, contract } = input;
  if (target.date.year !== current.date.year || target.date.month !== current.date.month) {
    return 'care_portal_move_other_month';
  }
  if (
    compareDates(target.date, contract.startDate) < 0 ||
    (contract.endDate && compareDates(target.date, contract.endDate) > 0)
  ) {
    return 'care_move_out_of_range';
  }
  if (compareDates(target.date, current.date) === 0 && target.slotId === current.slotId) {
    return 'care_portal_move_same';
  }
  const start = careVisitStartAt(target.date, target.startMinutes, input.timeZone);
  const earliest = careCustomerEarliestStart(input.now, input.noticeHours);
  if (!start || start.getTime() < earliest.getTime()) return 'care_portal_move_notice';
  return null;
}
