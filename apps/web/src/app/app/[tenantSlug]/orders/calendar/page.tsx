import { ChevronLeft, ChevronRight, Store, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { getOrdersMonth } from '@floral/core';
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
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { OrdersTabs } from '../orders-tabs';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders.calendar');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function monthParam(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}`;
}

/** Il mese dei pedidos (ADR-057): quante consegne e quanti ritiri per giorno; un clic apre il giorno. */
export default async function OrdersCalendarPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/orders/calendar'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const month = await getOrdersMonth(ctx, single(raw.month));
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = resolveLocale(await getLocale());
  const routes = tenantRoutes(ctx.tenantSlug);
  const today = toIsoDate(todayInTimeZone(ctx.timezone));
  const first: CalendarDate = { year: month.year, month: month.month, day: 1 };
  const firstDay = weekStartsOn(locale);
  const gridStart = startOfWeek(first, firstDay);
  const total = daysInMonth(month.year, month.month);
  const leading =
    (Date.UTC(first.year, first.month - 1, 1) -
      Date.UTC(gridStart.year, gridStart.month - 1, gridStart.day)) /
    86_400_000;
  const cells = Math.ceil((leading + total) / 7) * 7;
  const byDate = new Map(month.days.map((day) => [day.date, day]));
  const title = format.dateTime(new Date(Date.UTC(month.year, month.month - 1, 15)), {
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
      <OrdersTabs routes={routes} current="calendar" />
      <PageHeader
        title={<span className="inline-block first-letter:uppercase">{title}</span>}
        description={t('orders.calendar.subtitle')}
        actions={
          <span className="flex gap-2">
            <Button
              asChild
              variant="outline"
              size="icon"
              aria-label={t('orders.calendar.previous')}
            >
              <Link href={routes.orders.calendar({ month: monthParam(addMonths(first, -1)) })}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button asChild variant="outline" size="icon" aria-label={t('orders.calendar.next')}>
              <Link href={routes.orders.calendar({ month: monthParam(addMonths(first, 1)) })}>
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
            const iso = toIsoDate({ year: month.year, month: month.month, day: dayNumber });
            const counts = byDate.get(iso);
            const label = format.dateTime(new Date(`${iso}T12:00:00Z`), {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: 'UTC',
            });
            return (
              <li key={index} className="min-h-20 border-r border-b">
                <Link
                  href={routes.orders.day({ date: iso })}
                  aria-label={
                    counts
                      ? t('orders.calendar.dayLabel', {
                          date: label,
                          deliveries: counts.deliveries,
                          pickups: counts.pickups,
                        })
                      : label
                  }
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
