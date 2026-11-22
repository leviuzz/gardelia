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
  daysBetween,
  monthsInRange,
  toIsoDate,
  yearlyOccurrences,
  type CalendarDate,
  type OccasionType,
} from '@floral/domain';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ValidationError } from '../errors';

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
  const occasions = await withTenantContext(getDb(), ctx, (tx) =>
    tx.customerOccasion.findMany({
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
        customer: { select: { displayName: true, phone: true } },
      },
    }),
  );
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
      });
    }
  }
  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.customerName.localeCompare(b.customerName, ctx.locale),
  );
}
