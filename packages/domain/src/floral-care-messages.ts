/**
 * Floral Care, blocco 5b (ADR-084): i messaggi fra cliente e fioreria — regole pure.
 *
 *  - Un filo per contratto. Scrivono la persona invitata (dal portale) e la squadra: tutti i ruoli,
 *    staff compreso (decisione del founder del 24/11).
 *  - Testo fino a 2000 caratteri e al massimo una foto; serve almeno uno dei due.
 *  - Si scrive solo con il contratto attivo o in pausa; finito, il filo si legge e basta.
 *  - Al cliente al massimo un'email al giorno per contratto quando la fioreria scrive (decisione
 *    del founder); alla fioreria un riassunto al giorno, non un'email per messaggio
 *    (`docs/FLORAL_CARE_PLAN.md` §1).
 */
import { z } from 'zod';
import { zonedDateTime } from './ai';
import { todayInTimeZone } from './customer';
import type { CustomerSubscriptionStatus } from './floral-care';
import { toTrimmedString } from './validation';

export const CARE_MESSAGE_LIMITS = {
  /** Caratteri di un messaggio. */
  body: 2000,
  /** Messaggi al giorno di una persona su un contratto: oltre è un abuso, non un uso normale. */
  perPersonPerDay: 30,
  /** Messaggi mostrati per volta nel filo ("Ver anteriores" per gli altri). */
  page: 30,
  /** Contratti per pagina nell'elenco «Mensajes» della fioreria. */
  threadsPage: 25,
  /** Tentativi del riassunto giornaliero alla fioreria (come le altre email di Floral Care). */
  digestAttempts: 3,
} as const;

/** Chi ha scritto: la persona del cliente (dal portale) o qualcuno della fioreria. */
export const CARE_MESSAGE_AUTHORS = ['CUSTOMER', 'SHOP'] as const;
export type CareMessageAuthor = (typeof CARE_MESSAGE_AUTHORS)[number];

/** Codici dei problemi di un messaggio (testi in `care.validation.*` e `care.conflict.*`). */
export type CareMessageProblem = 'care_message_empty' | 'care_message_closed';

/**
 * Il testo di un messaggio e la chiave dell'invio: lo stesso modulo inviato due volte (doppio clic,
 * rete lenta) non scrive due messaggi. La foto arriva a parte, come file.
 */
export const careMessageSchema = z.object({
  body: z.preprocess(
    toTrimmedString,
    z.string({ error: 'invalid' }).max(CARE_MESSAGE_LIMITS.body, { error: 'too_long' }),
  ),
  submitKey: z.preprocess(toTrimmedString, z.uuid({ error: 'required' })),
});
export type CareMessageInput = z.infer<typeof careMessageSchema>;

/** Si scrive solo su un contratto attivo o in pausa (mai un borrador o uno finito). */
export function careMessagesOpen(status: CustomerSubscriptionStatus): boolean {
  return status === 'ACTIVE' || status === 'PAUSED';
}

/** Perché un messaggio non si può mandare; null = si può. */
export function careMessageProblem(input: {
  readonly status: CustomerSubscriptionStatus;
  readonly body: string;
  readonly hasPhoto: boolean;
}): CareMessageProblem | null {
  if (!careMessagesOpen(input.status)) return 'care_message_closed';
  if (input.body.trim() === '' && !input.hasPhoto) return 'care_message_empty';
  return null;
}

/**
 * L'inizio di oggi nel fuso della fioreria: da qui si contano i messaggi del giorno di una persona
 * e parte il giorno dell'avviso al cliente.
 */
export function careMessageDayStart(timeZone: string, now: Date = new Date()): Date {
  return zonedDateTime(todayInTimeZone(timeZone, now), 0, timeZone);
}
