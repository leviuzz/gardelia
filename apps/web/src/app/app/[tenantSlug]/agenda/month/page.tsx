import { ChevronLeft, ChevronRight, Sprout, Store, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  getCareAgendaMonth,
  getOrdersMonth,
  hasPermission,
  type TenantContext,
} from '@floral/core';
import {
  addMonths,
  daysInMonth,
  resolveLocale,
  startOfWeek,
  todayInTimeZone,
  toIsoDate,
  weekStartsOn,
  type CalendarDate,
} from '@floral/domain';
import { AgendaTabs } from '@/components/care/care-ui';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.agenda');
  return { title: t('monthTitle') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function monthParam(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}`;
}

async function loadCareMonth(ctx: TenantContext, month: string | undefined) {
  if (!hasPermission(ctx, 'subscriptions:read')) return null;
  try {
    return await getCareAgendaMonth(ctx, month);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/** Il mese dell'Agenda (ADR-074): visite di Floral Care, consegne e ritiri per giorno. */
export default async function AgendaMonthPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/agenda/month'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const requested = single((await searchParams).month);
  const [care, orders] = await Promise.all([
    loadCareMonth(ctx, requested),
    hasPermission(ctx, 'orders:read') ? getOrdersMonth(ctx, requested) : Promise.resolve(null),
  ]);
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = resolveLocale(await getLocale());
  const routes = tenantRoutes(ctx.tenantSlug);
  const now = todayInTimeZone(ctx.timezone);
  const today = toIsoDate(now);
  const target = care ?? orders ?? { year: now.year, month: now.month };
  const first: CalendarDate = { year: target.year, month: target.month, day: 1 };
  const gridStart = startOfWeek(first, weekStartsOn(locale));
  const total = daysInMonth(target.year, target.month);
  const leading =
    (Date.UTC(first.year, first.month - 1, 1) -
      Date.UTC(gridStart.year, gridStart.month - 1, gridStart.day)) /
    86_400_000;
  const cells = Math.ceil((leading + total) / 7) * 7;
  const visitsBy = new Map((care?.days ?? []).map((day) => [day.date, day.visits]));
  const ordersBy = new Map((orders?.days ?? []).map((day) => [day.date, day]));
  const title = format.dateTime(new Date(Date.UTC(target.year, target.month - 1, 15)), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const weekdayNames = Array.from({ length: 7 }, (_, index) =>
    format.dateTime(
      new Date(Date.UTC(gridStart.year, gridStart.month - 1, gridStart.day + index, 12)),
      { weekday: 'short', timeZone: 'UTC' },
    ),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AgendaTabs routes={routes} current="month" toReschedule={care?.toReschedule ?? 0} />
      <PageHeader
        title={<span className="inline-block first-letter:uppercase">{title}</span>}
        description={t('care.agenda.monthSubtitle')}
        actions={
          <span className="flex gap-2">
            <Button
              asChild
              variant="outline"
              size="icon"
              aria-label={t('care.agenda.previousMonth')}
            >
              <Link href={routes.agenda.month({ month: monthParam(addMonths(first, -1)) })}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon" aria-label={t('care.agenda.nextMonth')}>
              <Link href={routes.agenda.month({ month: monthParam(addMonths(first, 1)) })}>
                <ChevronRight />
              </Link>
            </Button>
          </span>
        }
      />

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
          {weekdayNames.map((name) => (
            <div key={name} className="py-2 first-letter:uppercase">
              {name}
            </div>
          ))}
        </div>
        <ol className="grid grid-cols-7">
          {Array.from({ length: cells }, (_, index) => {
            const dayNumber = index - leading + 1;
            if (dayNumber < 1 || dayNumber > total) {
              return (
                <li
                  key={index}
                  className="min-h-20 border-r border-b bg-muted/20"
                  aria-hidden="true"
                />
              );
            }
            const iso = toIsoDate({ year: target.year, month: target.month, day: dayNumber });
            const visits = visitsBy.get(iso) ?? 0;
            const counts = ordersBy.get(iso);
            const label = format.dateTime(new Date(`${iso}T12:00:00Z`), {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            });
            return (
              <li key={index} className="min-h-20 border-r border-b">
                <Link
                  href={routes.agenda.day({ date: iso })}
                  aria-label={t('care.agenda.dayLabel', {
                    date: label,
                    visits,
                    deliveries: counts?.deliveries ?? 0,
                    pickups: counts?.pickups ?? 0,
                  })}
                  className={cn(
                    'flex h-full flex-col gap-1 p-1.5 text-xs transition-colors hover:bg-muted/50 sm:p-2',
                    iso === today && 'bg-secondary/60',
                  )}
                >
                  <span
                    className={cn(
                      'text-sm tabular-nums',
                      iso === today ? 'font-semibold text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {dayNumber}
                  </span>
                  {visits > 0 ? (
                    <span
                      className="flex items-center gap-1 font-medium text-primary"
                      aria-hidden="true"
                    >
                      <Sprout className="size-3.5" />
                      {visits}
                    </span>
                  ) : null}
                  {counts && counts.deliveries > 0 ? (
                    <span className="flex items-center gap-1 font-medium" aria-hidden="true">
                      <Truck className="size-3.5" />
                      {counts.deliveries}
                    </span>
                  ) : null}
                  {counts && counts.pickups > 0 ? (
                    <span className="flex items-center gap-1 font-medium" aria-hidden="true">
                      <Store className="size-3.5" />
                      {counts.pickups}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Sprout className="size-3.5" aria-hidden="true" />
          {t('care.agenda.legendVisits')}
        </span>
        <span className="flex items-center gap-1">
          <Truck className="size-3.5" aria-hidden="true" />
          {t('orders.modes.DELIVERY')}
        </span>
        <span className="flex items-center gap-1">
          <Store className="size-3.5" aria-hidden="true" />
          {t('orders.modes.PICKUP')}
        </span>
      </p>
    </div>
  );
}
