import { Cake, CalendarHeart, FileText, Heart, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import type { CalendarOccasionDto } from '@floral/core';
import {
  daysBetween,
  sameDate,
  toIsoDate,
  type CalendarDate,
  type OccasionType,
} from '@floral/domain';
import { cn } from '@/lib/utils';

/** Testi e formati già pronti (lingua di chi usa l'app), calcolati dalla pagina. */
export interface CalendarText {
  /** "Cumpleaños · de Su mamá", "Día de las madres". */
  readonly title: (event: CalendarOccasionDto) => string;
  /** "cumple 36", "7 años", o null. */
  readonly years: (event: CalendarOccasionDto) => string | null;
  /** "lunes, 14 de diciembre de 2026". */
  readonly longDate: (date: CalendarDate) => string;
  /** "lun 14". */
  readonly shortDay: (date: CalendarDate) => string;
  /** "en 22 días", "¡Hoy!". */
  readonly relative: (days: number) => string;
  readonly more: (count: number) => string;
  readonly dayCount: (count: number) => string;
  readonly emptyDay: string;
  readonly viewCustomer: string;
  readonly whatsapp: string;
  readonly newQuote: string;
}

export interface CalendarLinks {
  readonly day: (date: CalendarDate) => string;
  readonly customer: (customerId: string) => string;
  /** null se chi guarda non può creare preventivi. */
  readonly newQuote: ((customerId: string) => string) | null;
  /** Link "clic per chattare" (testo nella lingua della fioreria), null senza telefono. */
  readonly whatsapp: (event: CalendarOccasionDto) => string | null;
}

const TYPE_STYLE: Readonly<Record<OccasionType, string>> = {
  BIRTHDAY: 'bg-accent text-accent-foreground',
  ANNIVERSARY: 'bg-secondary text-secondary-foreground',
  CUSTOM: 'bg-muted text-foreground',
};

const TYPE_DOT: Readonly<Record<OccasionType, string>> = {
  BIRTHDAY: 'bg-accent-foreground',
  ANNIVERSARY: 'bg-primary',
  CUSTOM: 'bg-muted-foreground',
};

function TypeIcon({ type, className }: { type: OccasionType; className?: string }) {
  const Icon = type === 'BIRTHDAY' ? Cake : type === 'ANNIVERSARY' ? Heart : CalendarHeart;
  return <Icon className={className} aria-hidden="true" />;
}

function eventsOn(events: readonly CalendarOccasionDto[], date: CalendarDate) {
  const iso = toIsoDate(date);
  return events.filter((event) => event.date === iso);
}

/** Data speciale con dettagli e azioni (vista giorno e agenda). */
export function EventCard({
  event,
  text,
  links,
}: {
  event: CalendarOccasionDto;
  text: CalendarText;
  links: CalendarLinks;
}) {
  const years = text.years(event);
  const whatsapp = links.whatsapp(event);
  return (
    <article className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full',
            TYPE_STYLE[event.type],
          )}
        >
          <TypeIcon type={event.type} className="size-4" />
        </span>
        <div className="min-w-0 text-sm">
          <h3 className="font-medium break-words">
            {text.title(event)}
            {years ? <span className="font-normal text-muted-foreground"> · {years}</span> : null}
          </h3>
          <Link
            href={links.customer(event.customerId)}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            {event.customerName}
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {whatsapp ? (
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
          >
            <MessageCircle className="size-3.5" aria-hidden="true" />
            {text.whatsapp}
          </a>
        ) : null}
        {links.newQuote ? (
          <Link
            href={links.newQuote(event.customerId)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted"
          >
            <FileText className="size-3.5" aria-hidden="true" />
            {text.newQuote}
          </Link>
        ) : null}
        <Link
          href={links.customer(event.customerId)}
          className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-primary hover:underline"
        >
          {text.viewCustomer}
        </Link>
      </div>
    </article>
  );
}

/** Blocco di una data nella settimana: tipo e cliente su due righe, come in un'agenda. */
function EventBlock({
  event,
  text,
  href,
}: {
  event: CalendarOccasionDto;
  text: CalendarText;
  href: string;
}) {
  return (
    <Link
      href={href}
      title={`${text.title(event)} · ${event.customerName}`}
      className={cn(
        'block rounded-lg px-2 py-1.5 text-xs hover:opacity-80',
        TYPE_STYLE[event.type],
      )}
    >
      <span className="flex min-w-0 items-center gap-1 font-medium">
        <TypeIcon type={event.type} className="size-3 shrink-0" />
        <span className="truncate">{text.title(event)}</span>
      </span>
      <span className="line-clamp-2 break-words">{event.customerName}</span>
    </Link>
  );
}

/** Pillola compatta di una data (griglia del mese). */
function EventPill({
  event,
  text,
  href,
}: {
  event: CalendarOccasionDto;
  text: CalendarText;
  href: string;
}) {
  return (
    <Link
      href={href}
      title={`${text.title(event)} · ${event.customerName}`}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs hover:opacity-80',
        TYPE_STYLE[event.type],
      )}
    >
      <TypeIcon type={event.type} className="size-3 shrink-0" />
      <span className="truncate">{event.customerName}</span>
    </Link>
  );
}

/** Elenco di giorni con le loro date (agenda e, su telefono, sotto il mese). */
export function DayList({
  days,
  events,
  today,
  text,
  links,
  emptyText,
}: {
  days: readonly CalendarDate[];
  events: readonly CalendarOccasionDto[];
  today: CalendarDate;
  text: CalendarText;
  links: CalendarLinks;
  emptyText: string;
}) {
  const withEvents = days.filter((day) => eventsOn(events, day).length > 0);
  if (withEvents.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  return (
    <ol className="space-y-5">
      {withEvents.map((day) => {
        const offset = daysBetween(today, day);
        return (
          <li key={toIsoDate(day)} className="space-y-2">
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
              <Link href={links.day(day)} className="first-letter:uppercase hover:underline">
                {text.longDate(day)}
              </Link>
              {offset >= 0 ? (
                <span className="text-xs font-normal text-muted-foreground">
                  {text.relative(offset)}
                </span>
              ) : null}
            </h3>
            <div className="space-y-2">
              {eventsOn(events, day).map((event) => (
                <EventCard key={event.key} event={event} text={text} links={links} />
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Mese: griglia di settimane intere; su telefono solo i pallini, con l'elenco sotto. */
export function MonthView({
  month,
  days,
  events,
  today,
  weekdays,
  text,
  links,
  listTitle,
  emptyText,
}: {
  month: CalendarDate;
  days: readonly CalendarDate[];
  events: readonly CalendarOccasionDto[];
  today: CalendarDate;
  /** Nomi brevi dei giorni, nell'ordine della griglia. */
  weekdays: readonly string[];
  text: CalendarText;
  links: CalendarLinks;
  listTitle: string;
  emptyText: string;
}) {
  const weeks: CalendarDate[][] = [];
  days.forEach((day, index) => {
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]?.push(day);
  });
  const inMonth = (day: CalendarDate) => day.month === month.month && day.year === month.year;
  return (
    <div className="space-y-6">
      <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-2xl border bg-card">
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <th
                key={weekday}
                scope="col"
                className="border-b py-2 text-center text-xs font-medium text-muted-foreground capitalize"
              >
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={toIsoDate(week[0]!)}>
              {week.map((day) => {
                const dayEvents = eventsOn(events, day);
                const isToday = sameDate(day, today);
                const label = `${text.longDate(day)}: ${text.dayCount(dayEvents.length)}`;
                return (
                  <td
                    key={toIsoDate(day)}
                    className={cn(
                      'h-14 border-t border-l p-1 align-top first:border-l-0 sm:h-28 sm:p-1.5',
                      !inMonth(day) && 'bg-muted/40',
                    )}
                  >
                    <Link
                      href={links.day(day)}
                      aria-label={label}
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full text-xs tabular-nums hover:bg-muted',
                        isToday &&
                          'bg-primary font-semibold text-primary-foreground hover:bg-primary',
                        !isToday && !inMonth(day) && 'text-muted-foreground',
                      )}
                    >
                      {day.day}
                    </Link>
                    {dayEvents.length > 0 ? (
                      <>
                        {/* Telefono: pallini per tipo. */}
                        <span
                          className="mt-1 flex justify-center gap-0.5 sm:hidden"
                          aria-hidden="true"
                        >
                          {dayEvents.slice(0, 3).map((event) => (
                            <span
                              key={event.key}
                              className={cn('size-1.5 rounded-full', TYPE_DOT[event.type])}
                            />
                          ))}
                        </span>
                        {/* Desktop: pillole con il nome del cliente. */}
                        <div className="mt-1 hidden space-y-1 sm:block">
                          {dayEvents.slice(0, 2).map((event) => (
                            <EventPill
                              key={event.key}
                              event={event}
                              text={text}
                              href={links.day(day)}
                            />
                          ))}
                          {dayEvents.length > 2 ? (
                            <Link
                              href={links.day(day)}
                              className="block px-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                            >
                              {text.more(dayEvents.length - 2)}
                            </Link>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <section className="space-y-3 sm:hidden" aria-label={listTitle}>
        <h2 className="text-sm font-semibold">{listTitle}</h2>
        <DayList
          days={days.filter(inMonth)}
          events={events}
          today={today}
          text={text}
          links={links}
          emptyText={emptyText}
        />
      </section>
    </div>
  );
}

/** Settimana: sette colonne su desktop, un giorno sotto l'altro su telefono. */
export function WeekView({
  days,
  events,
  today,
  text,
  links,
}: {
  days: readonly CalendarDate[];
  events: readonly CalendarOccasionDto[];
  today: CalendarDate;
  text: CalendarText;
  links: CalendarLinks;
}) {
  return (
    <ol className="grid gap-2 sm:grid-cols-7">
      {days.map((day) => {
        const dayEvents = eventsOn(events, day);
        const isToday = sameDate(day, today);
        return (
          <li
            key={toIsoDate(day)}
            className={cn(
              'min-w-0 space-y-2 rounded-2xl border bg-card p-2 sm:min-h-40',
              isToday && 'border-primary',
            )}
          >
            <Link
              href={links.day(day)}
              aria-label={`${text.longDate(day)}: ${text.dayCount(dayEvents.length)}`}
              className={cn(
                'block rounded-lg px-1.5 py-1 text-sm font-medium capitalize hover:bg-muted',
                isToday && 'text-primary',
              )}
            >
              {text.shortDay(day)}
            </Link>
            {dayEvents.length === 0 ? (
              <p className="px-1.5 text-xs text-muted-foreground sm:hidden">{text.emptyDay}</p>
            ) : (
              <div className="space-y-1">
                {dayEvents.map((event) => (
                  <EventBlock key={event.key} event={event} text={text} href={links.day(day)} />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Giorno: le date con tutti i dettagli e le azioni. */
export function DayView({
  day,
  events,
  text,
  links,
}: {
  day: CalendarDate;
  events: readonly CalendarOccasionDto[];
  text: CalendarText;
  links: CalendarLinks;
}) {
  const dayEvents = eventsOn(events, day);
  if (dayEvents.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
        {text.emptyDay}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {dayEvents.map((event) => (
        <EventCard key={event.key} event={event} text={text} links={links} />
      ))}
    </div>
  );
}
