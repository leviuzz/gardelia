import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { hasPermission, listCalendarOccasions, type CalendarOccasionDto } from '@floral/core';
import {
  CALENDAR_VIEWS,
  calendarRange,
  getMarket,
  parseCalendarQuery,
  parseIsoDate,
  resolveLocale,
  shiftDate,
  toIsoDate,
  todayInTimeZone,
  weekStartsOn,
  whatsappLink,
  type CalendarDate,
  type CalendarView,
} from '@floral/domain';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import {
  DayList,
  DayView,
  MonthView,
  WeekView,
  type CalendarLinks,
  type CalendarText,
} from './calendar-views';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('calendar');
  return { title: t('title') };
}

/** Data di calendario come istante a mezzogiorno UTC: si formatta senza slittare di giorno. */
function asDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
}

/**
 * Calendario della fioreria: le date speciali dei clienti per mese, settimana, giorno o agenda,
 * come un calendario classico. Vista e data stanno nell'URL (?view=…&date=…): si condividono,
 * funzionano senza JavaScript e il tasto indietro del browser torna alla vista precedente.
 */
export default async function CalendarPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/calendar'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const query = await searchParams;
  const routes = tenantRoutes(ctx.tenantSlug);
  const t = await getTranslations('calendar');
  const tOccasions = await getTranslations('customers.occasions');
  const format = await getFormatter();
  const locale = resolveLocale(await getLocale());
  // Il messaggio WhatsApp va al cliente: nella lingua del mercato della fioreria (ADR-042).
  const shopLocale = getMarket(ctx.country).defaultLocale;
  const tShop = await getTranslations({ locale: shopLocale, namespace: 'calendar' });
  const tShopOccasions = await getTranslations({
    locale: shopLocale,
    namespace: 'customers.occasions',
  });

  const today = todayInTimeZone(ctx.timezone);
  const { view, date } = parseCalendarQuery({ view: query.view, date: query.date }, today);
  const firstDay = weekStartsOn(locale);
  const range = calendarRange(view, date, firstDay);
  const events = await listCalendarOccasions(ctx, range);

  const href = (nextView: CalendarView, nextDate: CalendarDate) =>
    routes.calendar({ view: nextView, date: toIsoDate(nextDate) });

  const titleWith = (
    event: CalendarOccasionDto,
    translate: (key: string, values?: Record<string, string>) => string,
  ) => {
    const base =
      event.type === 'CUSTOM' && event.label ? event.label : translate(`types.${event.type}`);
    return event.personName ? `${base} · ${translate('of', { name: event.personName })}` : base;
  };

  const todayIso = toIsoDate(today);
  const shortDate = (iso: string) => {
    const day = parseIsoDate(iso) ?? today;
    return format.dateTime(asDate(day), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const promoLine: CalendarText['promo'] = (event) => {
    const promo = event.promo;
    if (!promo) return null;
    switch (promo.status) {
      case 'SENT':
        return {
          tone: 'ok',
          label: t('promo.sent', {
            date: format.dateTime(new Date(promo.sentAt), {
              day: 'numeric',
              month: 'short',
              timeZone: ctx.timezone,
            }),
          }),
        };
      case 'SENDING':
        return { tone: 'muted', label: t('promo.sending') };
      case 'FAILED':
        return { tone: 'warn', label: t('promo.failed') };
      case 'SCHEDULED': {
        const label =
          promo.sendOn <= todayIso
            ? t('promo.scheduledNext')
            : t('promo.scheduled', { date: shortDate(promo.sendOn) });
        // Florería demo: si vede cosa succederebbe, ma non parte nulla (ADR-016).
        return {
          tone: 'muted',
          label: ctx.mode === 'DEMO' ? `${label} ${t('promo.demo')}` : label,
        };
      }
      case 'NO_EMAIL':
        return { tone: 'muted', label: t('promo.noEmail') };
      case 'NO_CONSENT':
        return { tone: 'muted', label: t('promo.noConsent') };
    }
  };

  const text: CalendarText = {
    title: (event) => titleWith(event, tOccasions),
    years: (event) =>
      event.years === null
        ? null
        : event.type === 'BIRTHDAY'
          ? t('yearsBirthday', { count: event.years })
          : t('yearsOther', { count: event.years }),
    longDate: (day) =>
      format.dateTime(asDate(day), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    shortDay: (day) =>
      format.dateTime(asDate(day), { weekday: 'short', day: 'numeric', timeZone: 'UTC' }),
    relative: (days) => (days === 0 ? tOccasions('today') : tOccasions('inDays', { count: days })),
    more: (count) => t('more', { count }),
    dayCount: (count) => t('dayCount', { count }),
    emptyDay: t('emptyDay'),
    promo: promoLine,
    viewCustomer: t('viewCustomer'),
    whatsapp: t('whatsapp'),
    newQuote: t('newQuote'),
  };

  const links: CalendarLinks = {
    day: (day) => href('day', day),
    customer: (customerId) => routes.customers.detail(customerId),
    newQuote: hasPermission(ctx, 'quotes:write')
      ? (customerId) => routes.quotes.new({ customerId })
      : null,
    whatsapp: (event) =>
      event.customerPhone
        ? whatsappLink(
            event.customerPhone,
            tShop('whatsappText', {
              name: event.customerName,
              occasion: titleWith(event, tShopOccasions),
            }),
          )
        : null,
  };

  const heading =
    view === 'month'
      ? format.dateTime(asDate(date), { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : view === 'day'
        ? text.longDate(date)
        : format.dateTimeRange(asDate(range.from), asDate(range.to), {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          });
  const weekdays = range.days
    .slice(0, 7)
    .map((day) => format.dateTime(asDate(day), { weekday: 'short', timeZone: 'UTC' }));
  const emptyText = t('emptyRange');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="sm">
            <Link href={href(view, today)}>{t('today')}</Link>
          </Button>
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={href(view, shiftDate(view, date, -1))} aria-label={t('previous')}>
              <ChevronLeft aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={href(view, shiftDate(view, date, 1))} aria-label={t('next')}>
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <h2 className="font-display text-xl first-letter:uppercase" aria-live="polite">
          {heading}
        </h2>
        <nav
          aria-label={t('viewLabel')}
          className="flex w-full rounded-lg border bg-card p-0.5 sm:ml-auto sm:w-auto"
        >
          {CALENDAR_VIEWS.map((option) => (
            <Link
              key={option}
              href={href(option, date)}
              aria-current={option === view ? 'page' : undefined}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium sm:flex-none',
                option === view
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(`views.${option}`)}
            </Link>
          ))}
        </nav>
      </div>

      {view === 'month' ? (
        <MonthView
          month={date}
          days={range.days}
          events={events}
          today={today}
          weekdays={weekdays}
          text={text}
          links={links}
          listTitle={t('monthList')}
          emptyText={emptyText}
        />
      ) : view === 'week' ? (
        <WeekView days={range.days} events={events} today={today} text={text} links={links} />
      ) : view === 'day' ? (
        <DayView day={date} events={events} text={text} links={links} />
      ) : (
        <DayList
          days={range.days}
          events={events}
          today={today}
          text={text}
          links={links}
          emptyText={emptyText}
        />
      )}

      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          {t('addHint')}{' '}
          <Link href={routes.customers.list()} className="font-medium text-primary hover:underline">
            {t('goToCustomers')}
          </Link>
        </p>
        {hasPermission(ctx, 'promotions:manage') ? (
          <p>
            {t('promoHint')}{' '}
            <Link href={routes.promotions} className="font-medium text-primary hover:underline">
              {t('goToPromotions')}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
