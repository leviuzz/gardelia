/**
 * Calendario della fioreria (richiesta del founder, 22/11/2026): le date speciali dei clienti
 * attivi (compleanni, anniversari, altre date) che cadono nei giorni mostrati. Le date si
 * ripetono ogni anno; il 29 febbraio, negli anni non bisestili, cade il 28.
 *
 * Lettura per chi vede i clienti (anche lo staff: serve per preparare i fiori). È pensato per
 * accogliere altre fonti (consegne, manutenzioni) con lo stesso intervallo.
 */
import { getDb, withTenantContext } from '@floral/db';
import {
  compareDates,
  daysBetween,
  monthsInRange,
  promoSendDate,
  toIsoDate,
  todayInTimeZone,
  yearlyOccurrences,
  type CalendarDate,
  type OccasionType,
} from '@floral/domain';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ValidationError } from '../errors';

/**
 * Email della promo per una data (ADR-047): com'è andata, o se e quando partirà. Le date senza
 * promo (spenta, data passata senza email) non ne hanno.
 */
export type CalendarPromo =
  | { readonly status: 'SENT'; readonly sentAt: string }
  | { readonly status: 'SENDING' | 'FAILED' }
  /** `sendOn` è oggi se il momento è già arrivato: parte col prossimo invio giornaliero. */
  | { readonly status: 'SCHEDULED'; readonly sendOn: string }
  | { readonly status: 'NO_EMAIL' | 'NO_CONSENT' };

export interface CalendarOccasionDto {
  /** Unica nell'elenco: data speciale + giorno. */
  readonly key: string;
  /** Giorno in cui cade ("AAAA-MM-GG", nel calendario della fioreria). */
  readonly date: string;
  readonly occasionId: string;
  readonly customerId: string;
  readonly customerName: string;
  /** Per il link a WhatsApp (formato E.164). */
  readonly customerPhone: string | null;
  readonly type: OccasionType;
  readonly label: string | null;
  readonly personName: string | null;
  /** Anni compiuti o di anniversario quel giorno, se l'anno è noto. */
  readonly years: number | null;
  readonly promo: CalendarPromo | null;
}

function dbDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

/** Giorni letti al massimo in una volta (griglia del mese: fino a 42; agenda: 60). */
export const CALENDAR_MAX_DAYS = 93;

export async function listCalendarOccasions(
  ctx: TenantContext,
  range: { readonly from: CalendarDate; readonly to: CalendarDate },
): Promise<readonly CalendarOccasionDto[]> {
  requirePermission(ctx, 'customers:read');
  const span = daysBetween(range.from, range.to);
  if (span < 0 || span > CALENDAR_MAX_DAYS) throw new ValidationError({ range: 'out_of_range' });
  const { occasions, promoOn, promoEmails } = await withTenantContext(getDb(), ctx, async (tx) => {
    const tenant = await tx.tenant.findFirstOrThrow({
      where: { id: ctx.tenantId },
      select: { occasionPromoEnabled: true, occasionPromoValue: true },
    });
    const occasions = await tx.customerOccasion.findMany({
      where: {
        tenantId: ctx.tenantId,
        month: { in: monthsInRange(range.from, range.to) },
        customer: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        customerId: true,
        type: true,
        label: true,
        personName: true,
        month: true,
        day: true,
        year: true,
        remindDaysBefore: true,
        customer: {
          select: { displayName: true, phone: true, email: true, marketingConsent: true },
        },
      },
    });
    const promoEmails = await tx.occasionPromoEmail.findMany({
      where: {
        tenantId: ctx.tenantId,
        occurrenceDate: { gte: dbDate(range.from), lte: dbDate(range.to) },
      },
      select: { occasionId: true, occurrenceDate: true, status: true, sentAt: true },
    });
    return {
      occasions,
      promoOn: tenant.occasionPromoEnabled && tenant.occasionPromoValue !== null,
      promoEmails,
    };
  });
  const emailsByKey = new Map(
    promoEmails.map((row) => [
      `${row.occasionId}:${row.occurrenceDate.toISOString().slice(0, 10)}`,
      row,
    ]),
  );
  const today = todayInTimeZone(ctx.timezone);

  const promoFor = (
    occasion: (typeof occasions)[number],
    date: CalendarDate,
    iso: string,
  ): CalendarPromo | null => {
    const email = emailsByKey.get(`${occasion.id}:${iso}`);
    if (email) {
      return email.status === 'SENT' && email.sentAt
        ? { status: 'SENT', sentAt: email.sentAt.toISOString() }
        : { status: email.status === 'SENDING' ? 'SENDING' : 'FAILED' };
    }
    if (!promoOn || compareDates(date, today) < 0) return null;
    if (!occasion.customer.email) return { status: 'NO_EMAIL' };
    if (!occasion.customer.marketingConsent) return { status: 'NO_CONSENT' };
    const sendOn = promoSendDate(date, occasion.remindDaysBefore);
    return {
      status: 'SCHEDULED',
      sendOn: toIsoDate(compareDates(sendOn, today) < 0 ? today : sendOn),
    };
  };

  const events: CalendarOccasionDto[] = [];
  for (const occasion of occasions) {
    for (const date of yearlyOccurrences(occasion.month, occasion.day, range.from, range.to)) {
      const iso = toIsoDate(date);
      events.push({
        key: `${occasion.id}:${iso}`,
        date: iso,
        occasionId: occasion.id,
        customerId: occasion.customerId,
        customerName: occasion.customer.displayName,
        customerPhone: occasion.customer.phone,
        type: occasion.type,
        label: occasion.label,
        personName: occasion.personName,
        years:
          occasion.year !== null && date.year > occasion.year ? date.year - occasion.year : null,
        promo: promoFor(occasion, date, iso),
      });
    }
  }
  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.customerName.localeCompare(b.customerName, ctx.locale),
  );
}
