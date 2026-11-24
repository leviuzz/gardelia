import {
  ChevronLeft,
  ChevronRight,
  KeyRound,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Play,
  Sprout,
  Truck,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getDayRoute, hasPermission, type DayRouteStop } from '@floral/core';
import {
  addDays,
  mapsPlaceUrl,
  mapsRouteLinks,
  parseIsoDate,
  toIsoDate,
  whatsappLink,
} from '@floral/domain';
import { AgendaTabs, VisitStatusBadge } from '@/components/care/care-ui';
import { OrderStatusBadge } from '@/components/common/status-badges';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money, phoneForInput } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { startCareVisitAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.route');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Ruta del día dell'Agenda (ADR-076): consegne a domicilio e visite di Floral Care in un solo
 * giro, per fascia e (con le coordinate) per vicinanza, con "Ir", "Llamar", WhatsApp e, per le
 * visite, "Empezar" o "Continuar". "Míos": solo le fermate di chi guarda. Le azioni sugli ordini
 * restano nella ruta dei Pedidos.
 */
export default async function AgendaRoutePage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/agenda/route'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'orders:read')) return <Forbidden />;
  const raw = await searchParams;
  const mine = single(raw.mine) === '1';
  const route = await getDayRoute(ctx, single(raw.date), { mine });
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const current = parseIsoDate(route.date);
  const shift = (days: number) => (current ? toIsoDate(addDays(current, days)) : undefined);
  const longDate = format.dateTime(calendarDate(route.date), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const addressOf = (stop: DayRouteStop) =>
    stop.kind === 'delivery' ? stop.delivery.address : stop.visit.address;
  const legs = mapsRouteLinks(
    route.origin,
    route.stops.map(addressOf).filter((address): address is string => Boolean(address)),
  );
  const link = (query: { date?: string; mine?: boolean }) =>
    routes.agenda.route({ date: query.date ?? route.date, mine: query.mine ?? mine });

  const contactButtons = (phone: string | null, address: string | null) => (
    <div className="flex flex-wrap gap-2">
      {address ? (
        <Button asChild variant="secondary" size="sm">
          <a href={mapsPlaceUrl(address)} target="_blank" rel="noopener noreferrer">
            <Navigation />
            {t('care.route.go')}
          </a>
        </Button>
      ) : null}
      {phone ? (
        <>
          <Button asChild variant="outline" size="sm">
            <a href={`tel:${phone}`}>
              <Phone />
              {t('care.route.call')}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer">
              <MessageCircle />
              {t('care.route.whatsapp')}
            </a>
          </Button>
        </>
      ) : null}
    </div>
  );

  const renderStop = (stop: DayRouteStop, position: number | null) => {
    const marker =
      position !== null ? (
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
          aria-label={t('care.route.stop', { position })}
        >
          {position}
        </span>
      ) : null;
    if (stop.kind === 'delivery') {
      const delivery = stop.delivery;
      const phone = delivery.recipientPhone ?? delivery.customerPhone;
      return (
        <article className="grid gap-3 rounded-2xl border bg-card p-4">
          <div className="flex items-start gap-3">
            {marker}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
                <Truck className="size-4 text-primary" aria-hidden="true" />
                {delivery.windowStart && delivery.windowEnd
                  ? t('orders.window', { start: delivery.windowStart, end: delivery.windowEnd })
                  : t('orders.allDay')}
              </p>
              <Link
                href={routes.orders.detail(delivery.id)}
                className="font-medium break-words hover:underline"
              >
                <span className="tabular-nums">{delivery.numberLabel}</span> ·{' '}
                {delivery.customerName}
              </Link>
            </div>
            <span className="flex flex-col items-end gap-1.5">
              <OrderStatusBadge status={delivery.status} />
              {delivery.balanceMinor > 0 ? (
                <Badge variant="warning">
                  {t('orders.route.collect', {
                    amount: money(delivery.balanceMinor, delivery.currency),
                  })}
                </Badge>
              ) : null}
            </span>
          </div>
          <p className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 break-words">{delivery.address}</span>
          </p>
          {delivery.recipientName || phone ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {delivery.recipientName ? (
                <span>{t('orders.route.receives', { name: delivery.recipientName })}</span>
              ) : null}
              {phone ? (
                <span className="text-muted-foreground tabular-nums">{phoneForInput(phone)}</span>
              ) : null}
            </p>
          ) : null}
          {delivery.deliveryNotes ? (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm whitespace-pre-line">
              {delivery.deliveryNotes}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {delivery.assigneeName ?? t('orders.route.unassignedOne')}
          </p>
          {contactButtons(phone, delivery.address)}
        </article>
      );
    }
    const visit = stop.visit;
    return (
      <article className="grid gap-3 rounded-2xl border bg-card p-4">
        <div className="flex items-start gap-3">
          {marker}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
              <Sprout className="size-4 text-primary" aria-hidden="true" />
              {visit.windowStart && visit.windowEnd
                ? t('orders.window', { start: visit.windowStart, end: visit.windowEnd })
                : t('orders.allDay')}
            </p>
            <Link
              href={routes.agenda.visit(visit.id)}
              className="font-medium break-words hover:underline"
            >
              <span className="tabular-nums">{visit.numberLabel}</span> · {visit.customerName}
            </Link>
            <p className="text-sm text-muted-foreground">
              {t('care.contracts.plants', { count: visit.plantCount })}
            </p>
          </div>
          <VisitStatusBadge status={visit.status} />
        </div>
        {visit.address ? (
          <p className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 break-words">{visit.address}</span>
          </p>
        ) : null}
        {visit.contactName || visit.contactPhone ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {visit.contactName ? <span>{visit.contactName}</span> : null}
            {visit.contactPhone ? (
              <span className="text-muted-foreground tabular-nums">
                {phoneForInput(visit.contactPhone)}
              </span>
            ) : null}
          </p>
        ) : null}
        {visit.accessNotes ? (
          <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm whitespace-pre-line">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{visit.accessNotes}</span>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {visit.assigneeName ?? t('care.route.unassignedVisit')}
        </p>
        {contactButtons(visit.contactPhone, visit.address)}
        {visit.canStart ? (
          <ActionButton
            action={startCareVisitAction.bind(null, slug, visit.id)}
            icon={<Play />}
            className="w-full sm:w-auto"
          >
            {t('care.visitWork.start')}
          </ActionButton>
        ) : visit.canContinue ? (
          <Button asChild className="w-full sm:w-auto">
            <Link href={routes.agenda.visit(visit.id)}>{t('care.visitWork.continue')}</Link>
          </Button>
        ) : null}
      </article>
    );
  };

  const keyOf = (stop: DayRouteStop) =>
    stop.kind === 'delivery' ? `d-${stop.delivery.id}` : `v-${stop.visit.id}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AgendaTabs routes={routes} current="route" toReschedule={null} />
      <PageHeader
        title={t('care.route.title')}
        description={<span className="inline-block first-letter:uppercase">{longDate}</span>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label={t('care.agenda.previous')}>
          <Link href={link({ date: shift(-1) })}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label={t('care.agenda.next')}>
          <Link href={link({ date: shift(1) })}>
            <ChevronRight />
          </Link>
        </Button>
        {route.isToday ? null : (
          <Button asChild variant="outline">
            <Link href={routes.agenda.route({ mine })}>{t('care.agenda.goToday')}</Link>
          </Button>
        )}
        <nav
          aria-label={t('care.route.filter')}
          className="ml-auto flex gap-1 rounded-xl bg-muted p-1"
        >
          {[
            { key: 'all', active: !mine, href: link({ mine: false }) },
            { key: 'mine', active: mine, href: link({ mine: true }) },
          ].map((option) => (
            <Link
              key={option.key}
              href={option.href}
              aria-current={option.active ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1 text-sm font-medium',
                option.active ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`care.route.${option.key as 'all' | 'mine'}`)}
            </Link>
          ))}
        </nav>
      </div>

      {route.stops.length === 0 && route.done.length === 0 ? (
        <EmptyState
          icon={<MapPin />}
          title={mine ? t('care.route.emptyMine') : t('care.route.emptyTitle')}
          body={route.includesVisits ? t('care.route.emptyBody') : t('care.route.emptyBodyOrders')}
        />
      ) : (
        <>
          {route.stops.length > 0 ? (
            <section className="grid gap-3 rounded-2xl border bg-secondary/40 p-4">
              <p className="text-sm">
                {route.orderedByDistance
                  ? t('care.route.summaryByDistance', { count: route.stops.length })
                  : t('care.route.summary', { count: route.stops.length })}
                {!mine && route.unassigned > 0
                  ? ` · ${t('care.route.unassigned', { count: route.unassigned })}`
                  : ''}
              </p>
              {legs.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {legs.map((leg) => (
                    <Button key={leg.from} asChild>
                      <a href={leg.url} target="_blank" rel="noopener noreferrer">
                        <Navigation />
                        {legs.length === 1
                          ? t('orders.route.openAll')
                          : t('orders.route.openLeg', { from: leg.from, to: leg.to })}
                      </a>
                    </Button>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">{t('care.route.orderHint')}</p>
            </section>
          ) : null}
          {route.origin === null && route.stops.length > 0 ? (
            <Alert variant="info">
              <AlertDescription>{t('orders.route.noOrigin')}</AlertDescription>
            </Alert>
          ) : null}

          <ol className="grid gap-3">
            {route.stops.map((stop, index) => (
              <li key={keyOf(stop)}>{renderStop(stop, index + 1)}</li>
            ))}
          </ol>

          {route.done.length > 0 ? (
            <details className="rounded-2xl border bg-muted/30 p-4">
              <summary className="cursor-pointer font-medium">
                {t('care.route.done', { count: route.done.length })}
              </summary>
              <ul className="mt-3 grid gap-3">
                {route.done.map((stop) => (
                  <li key={keyOf(stop)}>{renderStop(stop, null)}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
