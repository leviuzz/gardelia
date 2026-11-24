/**
 * Floral Care, blocco 3 (ADR-081): cargos e pagamenti dei contratti. Regole pure, senza I/O.
 *
 * Una regola sola, per visita (docs/FLORAL_CARE_PLAN.md §3):
 *  - una visita del calendario è DOVUTA se non è "Por reprogramar" e non l'ha tolta la fioreria
 *    (cancellata dalla fioreria, cambio di calendario, fine del contratto, "No pudimos ir");
 *  - all'emissione del mese P si confronta "dovuta" con "cobrada": le dovute del mese entrano come
 *    visite del mese al prezzo di P; quelle dovute dei mesi prima e mai cobrate come debito; quelle
 *    cobrate e non più dovute come credito. Così ogni variazione va sul cargo del mese dopo e il
 *    cargo emesso non cambia più;
 *  - una visita chiusa (hecha, no se pudo, cancelada) con lo stato pari non si guarda più;
 *  - le visite extra fatte con la tariffa per visita e i servizi "una sola vez" fatti si cobrano una
 *    volta, nel cargo dopo la visita;
 *  - con il contratto attivo un cargo non va sotto zero: l'eccedenza passa al cargo dopo. Nel cargo
 *    finale di un contratto chiuso resta "a favor" e si chiude con una devolución.
 *
 * Importi in unità minime, calcolati solo dal server: dal browser arriva solo quanto ha pagato il
 * cliente, e il server lo ricontrolla. Il cargo non è una factura: "Precios finales, sin impuestos"
 * (O-06).
 */
import { z } from 'zod';
import {
  addDays,
  addMonths,
  compareDates,
  daysInMonth,
  toIsoDate,
  type CalendarDate,
} from './calendar';
import type { CareVisitCancelReason, CareVisitStatus } from './floral-care';
import type { CareExtraFee } from './floral-care-extras';
import { MAX_AMOUNT_MINOR, multiplyMinor, type CurrencyCode } from './money';
import { PAYMENT_METHODS, optionalUuidField } from './order';
import { parseDateInput } from './quote';
import { moneyField, optionalInteger, optionalText, toTrimmedString } from './validation';

export const CARE_CHARGE_LIMITS = {
  /** "Días para pagar" della fioreria: da 1 a 90, 10 se non li sceglie. */
  dueDaysMin: 1,
  dueDaysMax: 90,
  dueDaysDefault: 10,
  paymentReference: 80,
  paymentNote: 300,
  /** Mesi emessi per contratto in un giro del lavoro (un contratto rimasto indietro recupera). */
  catchUpMonths: 3,
  /** Contratti per giro della manutenzione (una transazione per mese di ogni contratto). */
  jobBatch: 100,
  /**
   * Tetto di tempo dei cargos in un giro: la route di manutenzione ha 60 s in tutto (con le foto,
   * 20 s, e le email, 15 s). Quello che resta lo prende il giro dopo; la scadenza conta dal giorno
   * in cui il cargo nasce.
   */
  budgetMs: 15_000,
  /** Estado de cuenta: i cargos degli ultimi 12 mesi, più tutti quelli ancora aperti. */
  statementMonths: 12,
  /** Cargos aperti di un cliente su cui si distribuisce un pagamento. */
  allocationCharges: 120,
} as const;

/** Numero del cargo: CAR-0001 (per fioreria). */
export function formatCareChargeNumber(value: number): string {
  return `CAR-${String(value).padStart(4, '0')}`;
}

// -----------------------------------------------------------------------------
// Vocabolari
// -----------------------------------------------------------------------------

/**
 * Le righe di un cargo:
 *  - VISITS: le visite del mese, insieme ("4 visitas × $490");
 *  - VISIT_DEBIT: una visita dovuta di un mese prima che non era nel suo cargo;
 *  - VISIT_CREDIT: una visita cobrada che non è più dovuta;
 *  - EXTRA_VISIT: una visita extra fatta con la tariffa per visita;
 *  - ONE_TIME_SERVICE: un servizio "una sola vez" fatto;
 *  - CREDIT_CARRIED_OUT / CREDIT_CARRIED_IN: il saldo a favore che passa al cargo dopo;
 *  - ADJUSTMENT: un ajuste di chi gestisce (blocco 3b).
 */
export const CARE_CHARGE_LINE_KINDS = [
  'VISITS',
  'VISIT_DEBIT',
  'VISIT_CREDIT',
  'EXTRA_VISIT',
  'ONE_TIME_SERVICE',
  'CREDIT_CARRIED_IN',
  'CREDIT_CARRIED_OUT',
  'ADJUSTMENT',
] as const;
export type CareChargeLineKind = (typeof CARE_CHARGE_LINE_KINDS)[number];

/** Perché una visita cobrada torna come credito. */
export const CARE_CREDIT_REASONS = [
  'TO_RESCHEDULE',
  'SHOP',
  'SCHEDULE_CHANGE',
  'CONTRACT_END',
  'NOT_DONE',
] as const;
export type CareCreditReason = (typeof CARE_CREDIT_REASONS)[number];

/** "No se pudo": il cliente non ha aperto (si paga) o la fioreria non è potuta andare (credito). */
export const CARE_NOT_DONE_CAUSES = ['CUSTOMER', 'SHOP'] as const;
export type CareNotDoneCause = (typeof CARE_NOT_DONE_CAUSES)[number];

/**
 * Un movimento di soldi del cliente: pagamento (positivo), storno di un movimento sbagliato
 * ("Anular", di segno opposto) o devolución di un saldo a favore (negativa).
 */
export const CARE_PAYMENT_KINDS = ['PAYMENT', 'REVERSAL', 'REFUND'] as const;
export type CarePaymentKind = (typeof CARE_PAYMENT_KINDS)[number];

/** Un incasso segnato dallo staff alla visita resta "Por registrar" finché chi gestisce decide. */
export const CARE_PAYMENT_STATUSES = ['RECORDED', 'PENDING', 'REJECTED'] as const;
export type CarePaymentStatus = (typeof CARE_PAYMENT_STATUSES)[number];

/**
 * Stato di un cargo, calcolato in lettura (mai salvato: "vencido" dipende dal giorno):
 *  - PENDING, PARTIAL, OVERDUE: il cliente deve ancora pagare (OVERDUE dopo la scadenza);
 *  - PAID: pagato; NO_BALANCE: il cargo vale 0;
 *  - IN_FAVOR: il cargo finale è a favore del cliente e la devolución manca; REFUNDED: fatta.
 */
export const CARE_CHARGE_STATUSES = [
  'PENDING',
  'PARTIAL',
  'OVERDUE',
  'PAID',
  'NO_BALANCE',
  'IN_FAVOR',
  'REFUNDED',
] as const;
export type CareChargeStatus = (typeof CARE_CHARGE_STATUSES)[number];

/** Il cliente deve ancora pagare qualcosa. */
export function isCareChargeOpen(status: CareChargeStatus): boolean {
  return status === 'PENDING' || status === 'PARTIAL' || status === 'OVERDUE';
}

/** Pestañas di "Cobros": por cobrar (anche vencidos), vencidos, pagados, a favor del cliente. */
export const CARE_CHARGE_VIEWS = ['open', 'overdue', 'paid', 'credit'] as const;
export type CareChargeView = (typeof CARE_CHARGE_VIEWS)[number];
export const CARE_CHARGE_PAGE_SIZE = 20;

// -----------------------------------------------------------------------------
// Mesi
// -----------------------------------------------------------------------------

/** Il mese di un giorno, come il suo primo giorno (così si salva `CareCharge.period`). */
export function carePeriodOf(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: 1 };
}

/** L'ultimo giorno del mese. */
export function carePeriodEnd(period: CalendarDate): CalendarDate {
  return { year: period.year, month: period.month, day: daysInMonth(period.year, period.month) };
}

/** Il mese `count` mesi dopo (o prima). */
export function addCarePeriods(period: CalendarDate, count: number): CalendarDate {
  return carePeriodOf(addMonths(carePeriodOf(period), count));
}

export function sameCarePeriod(a: CalendarDate, b: CalendarDate): boolean {
  return a.year === b.year && a.month === b.month;
}

/** "2026-11": la chiave di un mese (filtri, prezzi dei mesi già cobrati). */
export function carePeriodKey(date: CalendarDate): string {
  return toIsoDate(carePeriodOf(date)).slice(0, 7);
}

/** "AAAA-MM" → il primo giorno del mese, o null. */
export function parseCarePeriodKey(value: unknown): CalendarDate | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return null;
  return parseDateInput(`${value}-01`);
}

/**
 * I mesi da emettere per un contratto, in ordine: dal mese dopo l'ultimo emesso (o dal mese in
 * cui inizia) fino a quello in corso, al massimo `max` (un contratto rimasto indietro recupera un
 * po' a ogni giro). Vuoto se è già tutto emesso o il contratto parte più avanti.
 */
export function careBillingPeriods(input: {
  readonly firstPeriod: CalendarDate;
  readonly chargedThrough: CalendarDate | null;
  readonly currentPeriod: CalendarDate;
  readonly max: number;
}): CalendarDate[] {
  let next = input.chargedThrough
    ? addCarePeriods(input.chargedThrough, 1)
    : carePeriodOf(input.firstPeriod);
  if (compareDates(next, carePeriodOf(input.firstPeriod)) < 0) {
    next = carePeriodOf(input.firstPeriod);
  }
  const periods: CalendarDate[] = [];
  const last = carePeriodOf(input.currentPeriod);
  while (compareDates(next, last) <= 0 && periods.length < input.max) {
    periods.push(next);
    next = addCarePeriods(next, 1);
  }
  return periods;
}

// -----------------------------------------------------------------------------
// Visite dovute
// -----------------------------------------------------------------------------

/** I campi di una visita che servono ai cargos. */
export interface CareBillableVisit {
  readonly id: string;
  readonly isExtra: boolean;
  readonly status: CareVisitStatus;
  readonly cancelReason: CareVisitCancelReason | null;
  /** Solo per "No se pudo"; null (visite del blocco 2) vale "el cliente no abrió". */
  readonly notDoneCause: CareNotDoneCause | null;
  readonly scheduledDate: CalendarDate | null;
  readonly originalDate: CalendarDate;
  readonly extraFee: CareExtraFee | null;
  readonly extraFeeMinor: number | null;
  /** Quanto è cobrado adesso per questa visita; null = niente. */
  readonly billedMinor: number | null;
}

/** Il giorno di una visita per i cargos: quello programmato, o quello originale se non ce l'ha. */
export function careVisitDay(visit: {
  readonly scheduledDate: CalendarDate | null;
  readonly originalDate: CalendarDate;
}): CalendarDate {
  return visit.scheduledDate ?? visit.originalDate;
}

/** Hecha, no se pudo o cancelada: lo stato non cambia più. */
export function isCareVisitFinal(status: CareVisitStatus): boolean {
  return status === 'DONE' || status === 'NOT_DONE' || status === 'CANCELLED';
}

/**
 * Una visita del calendario è dovuta? Sì se è programmata (anche se nessuno l'ha chiusa), in
 * corso, fatta, "No se pudo" perché il cliente non ha aperto (decisione del founder del 24/11: si
 * paga anche se poi si recupera) o cancellata dal cliente (PROPOSTO, come la visita mancata). No se
 * è "Por reprogramar", se l'ha tolta la fioreria o se la fioreria non è potuta andare.
 */
export function careVisitOwed(visit: {
  readonly status: CareVisitStatus;
  readonly cancelReason: CareVisitCancelReason | null;
  readonly notDoneCause: CareNotDoneCause | null;
}): boolean {
  switch (visit.status) {
    case 'SCHEDULED':
    case 'IN_PROGRESS':
    case 'DONE':
      return true;
    case 'NOT_DONE':
      return visit.notDoneCause !== 'SHOP';
    case 'CANCELLED':
      return visit.cancelReason === 'CUSTOMER';
    case 'TO_RESCHEDULE':
      return false;
  }
}

/** Quanto si cobra una visita extra: la tariffa per visita, solo se fatta; il resto non si cobra. */
export function careExtraVisitCharge(visit: {
  readonly status: CareVisitStatus;
  readonly extraFee: CareExtraFee | null;
  readonly extraFeeMinor: number | null;
}): number {
  if (visit.status !== 'DONE' || visit.extraFee !== 'VISIT_FEE') return 0;
  return Math.max(0, visit.extraFeeMinor ?? 0);
}

/** Perché una visita cobrada non è più dovuta (la riga di credito lo ricorda). */
export function careCreditReason(visit: {
  readonly status: CareVisitStatus;
  readonly cancelReason: CareVisitCancelReason | null;
}): CareCreditReason {
  if (visit.status === 'TO_RESCHEDULE') return 'TO_RESCHEDULE';
  if (visit.status === 'NOT_DONE') return 'NOT_DONE';
  if (visit.cancelReason === 'SCHEDULE_CHANGE') return 'SCHEDULE_CHANGE';
  if (visit.cancelReason === 'CONTRACT_END') return 'CONTRACT_END';
  return 'SHOP';
}

// -----------------------------------------------------------------------------
// Le righe di un cargo
// -----------------------------------------------------------------------------

/** Un servizio "una sola vez" fatto in una visita hecha e non ancora cobrado. */
export interface CareOneTimeServiceDone {
  readonly serviceResultId: string;
  readonly serviceId: string;
  /** Nome copiato quando la squadra l'ha segnato. */
  readonly name: string;
  /** Prezzo copiato quando la squadra l'ha segnato. */
  readonly priceMinor: number;
  /** Il giorno della visita. */
  readonly day: CalendarDate;
}

/** Un saldo a favore di un cargo precedente da portare in questo. */
export interface CareCarriedCredit {
  readonly chargeId: string;
  /** Quanto è uscito da quel cargo (positivo). */
  readonly amountMinor: number;
}

export interface CareChargePlanInput {
  /** Il mese del cargo (primo giorno). */
  readonly period: CalendarDate;
  /** Il prezzo di una visita per questo mese: quello del contratto adesso. */
  readonly unitPriceMinor: number;
  /** Il prezzo di una visita nei cargos già emessi, per mese ("2026-11" → unità minime). */
  readonly pastPrices: ReadonlyMap<string, number>;
  /** Le visite non ancora sistemate del contratto (le altre non servono). */
  readonly visits: readonly CareBillableVisit[];
  readonly oneTimeServices: readonly CareOneTimeServiceDone[];
  readonly carriedIn: readonly CareCarriedCredit[];
  /**
   * Il contratto è finito: si guardano tutte le visite (non c'è un mese dopo) e il cargo può
   * restare a favore del cliente, da chiudere con una devolución.
   */
  readonly final: boolean;
}

export interface PlannedCareChargeLine {
  readonly kind: CareChargeLineKind;
  readonly visitId: string | null;
  readonly visitDate: CalendarDate | null;
  readonly serviceResultId: string | null;
  readonly serviceId: string | null;
  /** CREDIT_CARRIED_IN: il cargo da cui viene il saldo. */
  readonly sourceChargeId: string | null;
  readonly creditReason: CareCreditReason | null;
  /** Nome copiato (servizio "una sola vez"). */
  readonly label: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  /** Con il segno: i crediti sono negativi. */
  readonly amountMinor: number;
}

/** Cosa cambia per una visita dopo il cargo: quanto è cobrado e se è sistemata per sempre. */
export interface CareVisitBillingUpdate {
  readonly visitId: string;
  readonly billedMinor: number | null;
  readonly stable: boolean;
}

export type CareChargePlan =
  | {
      readonly ok: true;
      readonly lines: readonly PlannedCareChargeLine[];
      readonly billing: readonly CareVisitBillingUpdate[];
      /** Visite del mese nella riga VISITS. */
      readonly visitCount: number;
      readonly totalMinor: number;
    }
  | { readonly ok: false; readonly error: 'amount_too_large' };

function line(
  kind: CareChargeLineKind,
  values: Partial<Omit<PlannedCareChargeLine, 'kind'>> & {
    readonly unitPriceMinor: number;
    readonly amountMinor: number;
  },
): PlannedCareChargeLine {
  return {
    kind,
    visitId: null,
    visitDate: null,
    serviceResultId: null,
    serviceId: null,
    sourceChargeId: null,
    creditReason: null,
    label: null,
    quantity: 1,
    ...values,
  };
}

function byDayThenId(a: CareBillableVisit, b: CareBillableVisit): number {
  return compareDates(careVisitDay(a), careVisitDay(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Le righe del cargo del mese e cosa cambia per ogni visita. Le visite di un mese dopo P si
 * lasciano ai mesi loro (salvo nel cargo finale). Restituisce righe vuote se non c'è nulla da
 * cobrar: allora il cargo non nasce.
 */
export function planCareChargeLines(input: CareChargePlanInput): CareChargePlan {
  const periodEnd = carePeriodEnd(input.period);
  const within = (day: CalendarDate) => input.final || compareDates(day, periodEnd) <= 0;
  const debits: PlannedCareChargeLine[] = [];
  const extras: PlannedCareChargeLine[] = [];
  const credits: PlannedCareChargeLine[] = [];
  const billing: CareVisitBillingUpdate[] = [];
  let visitCount = 0;

  const visits = [...input.visits].sort(byDayThenId);
  for (const visit of visits) {
    const day = careVisitDay(visit);
    if (!within(day)) continue;
    const final = isCareVisitFinal(visit.status);
    if (visit.isExtra) {
      const fee = careExtraVisitCharge(visit);
      if (fee > 0 && visit.billedMinor === null) {
        extras.push(
          line('EXTRA_VISIT', {
            visitId: visit.id,
            visitDate: day,
            unitPriceMinor: fee,
            amountMinor: fee,
          }),
        );
        billing.push({ visitId: visit.id, billedMinor: fee, stable: final });
      } else if (final) {
        billing.push({ visitId: visit.id, billedMinor: visit.billedMinor, stable: true });
      }
      continue;
    }
    const owed = careVisitOwed(visit);
    if (owed && visit.billedMinor === null) {
      let price = input.unitPriceMinor;
      if (sameCarePeriod(day, input.period)) {
        visitCount += 1;
      } else {
        price = input.pastPrices.get(carePeriodKey(day)) ?? input.unitPriceMinor;
        if (price > 0) {
          debits.push(
            line('VISIT_DEBIT', {
              visitId: visit.id,
              visitDate: day,
              unitPriceMinor: price,
              amountMinor: price,
            }),
          );
        }
      }
      billing.push({ visitId: visit.id, billedMinor: price, stable: final });
    } else if (!owed && visit.billedMinor !== null) {
      if (visit.billedMinor > 0) {
        credits.push(
          line('VISIT_CREDIT', {
            visitId: visit.id,
            visitDate: day,
            creditReason: careCreditReason(visit),
            unitPriceMinor: visit.billedMinor,
            amountMinor: -visit.billedMinor,
          }),
        );
      }
      billing.push({ visitId: visit.id, billedMinor: null, stable: final });
    } else if (final) {
      billing.push({ visitId: visit.id, billedMinor: visit.billedMinor, stable: true });
    }
  }

  // Un servizio "una sola vez" si cobra una volta per contratto (anche se segnato due volte).
  const services: PlannedCareChargeLine[] = [];
  const seen = new Set<string>();
  const done = [...input.oneTimeServices].sort(
    (a, b) => compareDates(a.day, b.day) || (a.serviceResultId < b.serviceResultId ? -1 : 1),
  );
  for (const service of done) {
    if (!within(service.day) || service.priceMinor <= 0 || seen.has(service.serviceId)) continue;
    seen.add(service.serviceId);
    services.push(
      line('ONE_TIME_SERVICE', {
        visitDate: service.day,
        serviceResultId: service.serviceResultId,
        serviceId: service.serviceId,
        label: service.name,
        unitPriceMinor: service.priceMinor,
        amountMinor: service.priceMinor,
      }),
    );
  }

  const carried = input.carriedIn
    .filter((credit) => credit.amountMinor > 0)
    .map((credit) =>
      line('CREDIT_CARRIED_IN', {
        sourceChargeId: credit.chargeId,
        unitPriceMinor: credit.amountMinor,
        amountMinor: -credit.amountMinor,
      }),
    );

  const lines: PlannedCareChargeLine[] = [];
  if (visitCount > 0) {
    let amount: number;
    try {
      amount = multiplyMinor(input.unitPriceMinor, visitCount);
    } catch {
      return { ok: false, error: 'amount_too_large' };
    }
    lines.push(
      line('VISITS', {
        quantity: visitCount,
        unitPriceMinor: input.unitPriceMinor,
        amountMinor: amount,
      }),
    );
  }
  lines.push(...debits, ...extras, ...services, ...credits, ...carried);

  let total = 0;
  for (const item of lines) {
    if (Math.abs(item.amountMinor) > MAX_AMOUNT_MINOR)
      return { ok: false, error: 'amount_too_large' };
    total += item.amountMinor;
  }
  if (lines.length > 0 && total < 0 && !input.final) {
    // Il saldo a favore passa al cargo dopo: questo resta a 0.
    lines.push(line('CREDIT_CARRIED_OUT', { unitPriceMinor: -total, amountMinor: -total }));
    total = 0;
  }
  if (Math.abs(total) > MAX_AMOUNT_MINOR) return { ok: false, error: 'amount_too_large' };
  return { ok: true, lines, billing, visitCount, totalMinor: total };
}

// -----------------------------------------------------------------------------
// Scadenza e stato
// -----------------------------------------------------------------------------

/**
 * La scadenza: dal primo del mese (o dal giorno in cui il cargo nasce, se nasce dopo: un lavoro
 * in ritardo o un contratto confermato a metà mese) più i "Días para pagar" della fioreria.
 */
export function careChargeDueDate(
  period: CalendarDate,
  issuedOn: CalendarDate,
  dueDays: number,
): CalendarDate {
  const from = compareDates(issuedOn, period) > 0 ? issuedOn : period;
  return addDays(from, dueDays);
}

/** Quanto manca da pagare: positivo, il cliente deve; negativo, la fioreria deve restituire. */
export function careChargeBalance(totalMinor: number, paidMinor: number): number {
  return totalMinor - paidMinor;
}

/** Lo stato del cargo oggi (calendario della fioreria). */
export function careChargeStatus(input: {
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly dueDate: CalendarDate;
  readonly today: CalendarDate;
}): CareChargeStatus {
  const { totalMinor, paidMinor } = input;
  if (totalMinor === 0) return 'NO_BALANCE';
  if (totalMinor < 0) return paidMinor <= totalMinor ? 'REFUNDED' : 'IN_FAVOR';
  if (paidMinor >= totalMinor) return 'PAID';
  if (compareDates(input.today, input.dueDate) > 0) return 'OVERDUE';
  return paidMinor > 0 ? 'PARTIAL' : 'PENDING';
}

// -----------------------------------------------------------------------------
// Pagamenti
// -----------------------------------------------------------------------------

/** Un cargo con saldo da pagare, per distribuire un pagamento. */
export interface CareOpenCharge {
  readonly id: string;
  readonly period: CalendarDate;
  readonly number: number;
  readonly balanceMinor: number;
}

export type CareAllocationResult =
  | {
      readonly ok: true;
      readonly allocations: readonly { readonly chargeId: string; readonly amountMinor: number }[];
    }
  | { readonly ok: false; readonly error: 'payment_exceeds_balance' };

/**
 * Un pagamento sull'estado de cuenta (decisione del founder del 24/11): va ai cargos più vecchi
 * con saldo, mai oltre il saldo di ognuno. Se supera tutto quanto c'è da pagare si rifiuta.
 */
export function allocateCarePayment(
  amountMinor: number,
  charges: readonly CareOpenCharge[],
): CareAllocationResult {
  const open = charges
    .filter((charge) => charge.balanceMinor > 0)
    .sort((a, b) => compareDates(a.period, b.period) || a.number - b.number);
  let left = amountMinor;
  const allocations: { chargeId: string; amountMinor: number }[] = [];
  for (const charge of open) {
    if (left <= 0) break;
    const amount = Math.min(left, charge.balanceMinor);
    allocations.push({ chargeId: charge.id, amountMinor: amount });
    left -= amount;
  }
  if (amountMinor <= 0 || left > 0) return { ok: false, error: 'payment_exceeds_balance' };
  return { ok: true, allocations };
}

// -----------------------------------------------------------------------------
// Moduli
// -----------------------------------------------------------------------------

/** Un importo maggiore di 0 (`moneyField` accetta anche 0). */
function positiveMoneyField(currency: CurrencyCode) {
  return moneyField(currency).refine((value) => value > 0, { error: 'care_payment_zero' });
}

/** Il giorno del pagamento; vuoto = oggi. Che non sia nel futuro lo controlla il server. */
const paidOnField = z.preprocess(
  toTrimmedString,
  z.string().transform((value, ctx) => {
    if (value === '') return null;
    const parsed = parseDateInput(value);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'invalid_date' });
      return z.NEVER;
    }
    return parsed;
  }),
);

/**
 * "Registrar pago" (su un cargo o sull'estado de cuenta) e "Registrar devolución": quanto, come,
 * quando, referencia e nota. La referencia e la nota non vanno mai nel registro di audit.
 * `submitKey`: la chiave del modulo aperto, così lo stesso invio arrivato due volte (rete lenta,
 * doppio tocco) non raddoppia il pagamento.
 */
export function carePaymentSchema(currency: CurrencyCode) {
  return z.object({
    amount: positiveMoneyField(currency),
    method: z.preprocess(toTrimmedString, z.enum(PAYMENT_METHODS, { error: 'required' })),
    paidOn: paidOnField,
    reference: optionalText(CARE_CHARGE_LIMITS.paymentReference),
    note: optionalText(CARE_CHARGE_LIMITS.paymentNote),
    submitKey: optionalUuidField,
  });
}
export type CarePaymentInput = z.infer<ReturnType<typeof carePaymentSchema>>;

/** Il campo "Días para pagar" di Ajustes → Floral Care: vuoto = 10. */
export const careDueDaysField = optionalInteger({
  min: CARE_CHARGE_LIMITS.dueDaysMin,
  max: CARE_CHARGE_LIMITS.dueDaysMax,
}).transform((value) => value ?? CARE_CHARGE_LIMITS.dueDaysDefault);

/** "No se pudo": perché. Vuoto vale "El cliente no abrió", la scelta proposta. */
export const careNotDoneCauseField = z.preprocess(
  toTrimmedString,
  z.union([z.literal('').transform(() => 'CUSTOMER' as const), z.enum(CARE_NOT_DONE_CAUSES)], {
    error: 'invalid_option',
  }),
);

/** Filtri di "Cobros": pestaña, mese ("AAAA-MM"), ricerca e pagina. */
export const careChargeListFiltersSchema = z.object({
  view: z.preprocess(toTrimmedString, z.enum(CARE_CHARGE_VIEWS).catch('open')),
  month: z.preprocess(
    toTrimmedString,
    z
      .string()
      .catch('')
      .transform((value) => parseCarePeriodKey(value)),
  ),
  q: z.preprocess(toTrimmedString, z.string().max(80).catch('')),
  page: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.int().min(1).max(10_000).catch(1),
  ),
});
export type CareChargeListFilters = z.infer<typeof careChargeListFiltersSchema>;
