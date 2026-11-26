import {
  ChevronLeft,
  ChevronRight,
  Globe,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Truck,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getDeliveryRoute, type RouteStopDto } from '@floral/core';
import {
  addDays,
  mapsPlaceUrl,
  mapsRouteLinks,
  parseIsoDate,
  toIsoDate,
  whatsappLink,
} from '@floral/domain';
import { OrderStatusBadge } from '@/components/common/status-badges';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money, phoneForInput } from '@/lib/format';
import { isBackStep } from '@/lib/order-ui';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { changeOrderStatusAction } from '../actions';
import { OrderStepActions } from '../order-forms';
import { OrdersTabs } from '../orders-tabs';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders.route');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Ruta del día (ADR-058, D-27 gratis): le consegne a domicilio in ordine di fascia, con "Ir" per
 * ogni fermata e il giro aperto in Google Maps a tratti. Pensata per il telefono del repartidor:
 * "Mis entregas" mostra solo le sue.
 */
export default async function DeliveryRoutePage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/orders/route'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const mine = single(raw.mine) === '1';
  const route = await getDeliveryRoute(ctx, single(raw.date), { mine });
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
  const legs = mapsRouteLinks(
    route.origin,
    route.stops.map((stop) => stop.address),
  );
  const link = (query: { date?: string; mine?: boolean }) =>
    routes.orders.route({ date: query.date ?? route.date, mine: query.mine ?? mine });

  const renderStop = (stop: RouteStopDto, position: number | null) => {
    const nextStep = stop.nextSteps.filter((step) => !isBackStep(stop.status, step)).slice(0, 1);
    const phone = stop.recipientPhone ?? stop.customerPhone;
    return (
      <article className="grid gap-3 rounded-2xl border bg-card p-4">
        <div className="flex items-start gap-3">
          {position !== null ? (
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
              aria-label={t('orders.route.stop', { position })}
            >
              {position}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium tabular-nums">
              {stop.windowStart && stop.windowEnd
                ? t('orders.window', { start: stop.windowStart, end: stop.windowEnd })
                : t('orders.allDay')}
            </p>
            <Link href={routes.orders.detail(stop.id)} className="font-medium hover:underline">
              <span className="tabular-nums">{stop.numberLabel}</span> · {stop.customerName}
            </Link>
          </div>
          <span className="flex flex-col items-end gap-1.5">
            <OrderStatusBadge status={stop.status} />
            {/* Fatto dalla tienda en línea (M3). */}
            {stop.placedOnline ? (
              <Badge variant="secondary">
                <Globe aria-hidden="true" />
                {t('orders.online.badge')}
              </Badge>
            ) : null}
            {stop.balanceMinor > 0 ? (
              <Badge variant="warning">
                {t('orders.route.collect', { amount: money(stop.balanceMinor, stop.currency) })}
              </Badge>
            ) : null}
          </span>
        </div>

        <p className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{stop.address}</span>
        </p>
        {stop.recipientName || phone ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {stop.recipientName ? (
              <span>{t('orders.route.receives', { name: stop.recipientName })}</span>
            ) : null}
            {phone ? (
              <span className="text-muted-foreground tabular-nums">{phoneForInput(phone)}</span>
            ) : null}
          </p>
        ) : null}
        {stop.deliveryNotes ? (
          <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm whitespace-pre-line">
            {stop.deliveryNotes}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          <Truck className="mr-1 inline size-3.5" aria-hidden="true" />
          {stop.assigneeName ?? t('orders.route.unassignedOne')}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <a href={mapsPlaceUrl(stop.address)} target="_blank" rel="noopener noreferrer">
              <Navigation />
              {t('orders.route.go')}
            </a>
          </Button>
          {phone ? (
            <>
              <Button asChild variant="outline" size="sm">
                <a href={`tel:${phone}`}>
                  <Phone />
                  {t('orders.route.call')}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={whatsappLink(phone)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle />
                  {t('orders.route.whatsapp')}
                </a>
              </Button>
            </>
          ) : null}
        </div>
        {nextStep.length > 0 ? (
          <OrderStepActions
            action={changeOrderStatusAction.bind(null, slug, stop.id)}
            current={stop.status}
            steps={nextStep}
          />
        ) : null}
      </article>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <OrdersTabs routes={routes} current="route" />
      <PageHeader
        title={t('orders.route.title')}
        description={<span className="inline-block first-letter:uppercase">{longDate}</span>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label={t('orders.day.previous')}>
          <Link href={link({ date: shift(-1) })}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label={t('orders.day.next')}>
          <Link href={link({ date: shift(1) })}>
            <ChevronRight />
          </Link>
        </Button>
        {route.isToday ? null : (
          <Button asChild variant="outline">
            <Link href={routes.orders.route({ mine })}>{t('orders.day.goToday')}</Link>
          </Button>
        )}
        <nav
          aria-label={t('orders.route.filter')}
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
              {t(`orders.route.${option.key as 'all' | 'mine'}`)}
            </Link>
          ))}
        </nav>
      </div>

      {route.stops.length === 0 && route.delivered.length === 0 ? (
        <EmptyState
          icon={<Truck />}
          title={mine ? t('orders.route.emptyMine') : t('orders.route.emptyTitle')}
          body={t('orders.route.emptyBody')}
        />
      ) : (
        <>
          {route.stops.length > 0 ? (
            <section className="grid gap-3 rounded-2xl border bg-secondary/40 p-4">
              <p className="text-sm">
                {/* Con le coordinate di Google Places le fermate di ogni fascia vanno per vicinanza. */}
                {route.orderedByDistance
                  ? t('orders.route.summaryByDistance', { count: route.stops.length })
                  : t('orders.route.summary', { count: route.stops.length })}
                {!mine && route.unassigned > 0
                  ? ` · ${t('orders.route.unassigned', { count: route.unassigned })}`
                  : ''}
              </p>
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
              <p className="text-xs text-muted-foreground">{t('orders.route.orderHint')}</p>
            </section>
          ) : null}
          {route.origin === null && route.stops.length > 0 ? (
            <Alert variant="info">
              <AlertDescription>{t('orders.route.noOrigin')}</AlertDescription>
            </Alert>
          ) : null}

          <ol className="grid gap-3">
            {route.stops.map((stop, index) => (
              <li key={stop.id}>{renderStop(stop, index + 1)}</li>
            ))}
          </ol>

          {route.delivered.length > 0 ? (
            <details className="rounded-2xl border bg-muted/30 p-4">
              <summary className="cursor-pointer font-medium">
                {t('orders.route.delivered', { count: route.delivered.length })}
              </summary>
              <ul className="mt-3 grid gap-3">
                {route.delivered.map((stop) => (
                  <li key={stop.id}>{renderStop(stop, null)}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
