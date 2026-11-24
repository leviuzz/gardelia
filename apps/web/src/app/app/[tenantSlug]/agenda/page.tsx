import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Flag,
  MapPin,
  Play,
  Sprout,
  Store,
  Truck,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  getCareAgendaDay,
  getOrdersDay,
  hasPermission,
  type CareAgendaDayDto,
  type TenantContext,
} from '@floral/core';
import { addDays, parseIsoDate, todayInTimeZone, toIsoDate } from '@floral/domain';
import { AgendaTabs, VisitStatusBadge } from '@/components/care/care-ui';
import { CareUpsell } from '@/components/care/care-upsell';
import { OrderStatusBadge } from '@/components/common/status-badges';
import { ActionButton } from '@/components/form/action-button';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { startCareVisitAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.agenda');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function loadCareDay(ctx: TenantContext, date: string | undefined) {
  try {
    return await getCareAgendaDay(ctx, date);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/**
 * Agenda dei lavori (ADR-075, ADR-078): il giorno con le visite di Floral Care per fascia (con i
 * posti) e i pedidos che escono. Dalla visita: "Empezar" o "Continuar" (la visita dal telefono è
 * nella sua pagina, con "No se pudo", spostare, cancellare e assegnare). Chi gestisce vede gli
 * avvisi della squadra ancora aperti. Il calendario delle date dei clienti resta a parte.
 */
export default async function AgendaDayPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/agenda'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const requested = single((await searchParams).date);
  const care: CareAgendaDayDto | null = hasPermission(ctx, 'subscriptions:read')
    ? await loadCareDay(ctx, requested)
    : null;
  const orders = hasPermission(ctx, 'orders:read') ? await getOrdersDay(ctx, requested) : null;
  const date = care?.date ?? orders?.date ?? toIsoDate(todayInTimeZone(ctx.timezone));
  const isToday = date === toIsoDate(todayInTimeZone(ctx.timezone));
  const current = parseIsoDate(date);
  const shift = (days: number) => (current ? toIsoDate(addDays(current, days)) : undefined);
  const longDate = format.dateTime(calendarDate(date), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const shortDay = (iso: string) =>
    format.dateTime(calendarDate(iso), { weekday: 'short', day: 'numeric', timeZone: 'UTC' });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AgendaTabs routes={routes} current="day" toReschedule={care?.toReschedule ?? 0} />
      <PageHeader
        title={isToday ? t('care.agenda.today') : t('care.agenda.title')}
        description={<span className="inline-block first-letter:uppercase">{longDate}</span>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label={t('care.agenda.previous')}>
          <Link href={routes.agenda.day({ date: shift(-1) })}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label={t('care.agenda.next')}>
          <Link href={routes.agenda.day({ date: shift(1) })}>
            <ChevronRight />
          </Link>
        </Button>
        {isToday ? null : (
          <Button asChild variant="outline">
            <Link href={routes.agenda.day()}>{t('care.agenda.goToday')}</Link>
          </Button>
        )}
        <form method="get" action={routes.agenda.day()} className="flex gap-2">
          <Input
            type="date"
            name="date"
            defaultValue={date}
            aria-label={t('care.agenda.pickDate')}
            className="w-44"
          />
          <Button type="submit" variant="secondary">
            {t('care.agenda.show')}
          </Button>
        </form>
      </div>

      {care && care.openFollowUps > 0 && hasPermission(ctx, 'subscriptions:write') ? (
        <Alert variant="warning">
          <Flag aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('care.followUps.alert', { count: care.openFollowUps })}</span>
            <Button asChild size="sm" variant="outline">
              <Link href={routes.agenda.followUps()}>{t('care.followUps.alertLink')}</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {[
          care ? t('care.agenda.visitsCount', { count: care.counts.total }) : null,
          orders ? t('care.agenda.ordersCount', { count: orders.counts.total }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="min-w-0 space-y-4" aria-labelledby="agenda-visits">
          <h2 id="agenda-visits" className="flex items-center gap-2 font-semibold">
            <Sprout className="size-4 text-primary" aria-hidden="true" />
            {t('care.agenda.visitsTitle')}
          </h2>
          {care === null ? (
            hasPermission(ctx, 'subscriptions:read') ? (
              <CareUpsell ctx={ctx} />
            ) : null
          ) : care.groups.length === 0 ? (
            <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
              {t('care.agenda.noSlots')}
            </p>
          ) : (
            care.groups.map((group) => (
              <div key={group.slotId ?? 'none'} className="space-y-2">
                <h3 className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium">
                  <span className="tabular-nums">
                    {group.start && group.end
                      ? t('orders.window', { start: group.start, end: group.end })
                      : t('care.agenda.noTime')}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {group.capacity === null
                      ? t('care.agenda.slotArchived')
                      : t('care.agenda.seats', { used: group.used, capacity: group.capacity })}
                  </span>
                </h3>
                {group.visits.length === 0 ? (
                  <p className="rounded-2xl border border-dashed p-3 text-sm text-muted-foreground">
                    {t('care.agenda.free')}
                  </p>
                ) : (
                  group.visits.map((visit) => {
                    const label = `${visit.numberLabel} · ${visit.customerName}`;
                    return (
                      <article key={visit.id} className="grid gap-3 rounded-2xl border bg-card p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link
                              href={routes.agenda.visit(visit.id)}
                              className="font-medium break-words hover:underline"
                            >
                              {label}
                            </Link>
                            <p className="text-sm text-muted-foreground">
                              {t('care.contracts.plants', { count: visit.plantCount })}
                              {visit.moved
                                ? ` · ${t('care.agenda.movedFrom', { date: shortDay(visit.originalDate) })}`
                                : ''}
                            </p>
                          </div>
                          <VisitStatusBadge status={visit.status} />
                        </div>
                        {visit.addressLine ? (
                          <p className="flex items-start gap-2 text-sm">
                            <MapPin
                              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span>{visit.addressLine}</span>
                          </p>
                        ) : null}
                        {visit.assignee ? (
                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <UserRound className="size-4 shrink-0" aria-hidden="true" />
                            {visit.assignee.name}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {visit.canStart ? (
                            <ActionButton
                              action={startCareVisitAction.bind(null, slug, visit.id)}
                              size="sm"
                              icon={<Play />}
                              aria-label={t('care.visitWork.startLabel', { label })}
                            >
                              {t('care.visitWork.start')}
                            </ActionButton>
                          ) : null}
                          {visit.canContinue ? (
                            <Button asChild size="sm">
                              <Link href={routes.agenda.visit(visit.id)}>
                                {t('care.visitWork.continue')}
                              </Link>
                            </Button>
                          ) : null}
                          <Button asChild size="sm" variant="ghost">
                            <Link href={routes.agenda.visit(visit.id)}>
                              {visit.hasReport ? t('care.agenda.report') : t('care.agenda.details')}
                            </Link>
                          </Button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            ))
          )}
        </section>

        {orders ? (
          <section className="min-w-0 space-y-4" aria-labelledby="agenda-orders">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="agenda-orders" className="flex items-center gap-2 font-semibold">
                <ClipboardList className="size-4 text-primary" aria-hidden="true" />
                {t('care.agenda.ordersTitle')}
              </h2>
              <Button asChild size="sm" variant="outline">
                <Link href={routes.orders.day({ date })}>{t('care.agenda.ordersDay')}</Link>
              </Button>
            </div>
            {orders.counts.total === 0 ? (
              <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
                {t('care.agenda.noOrders')}
              </p>
            ) : (
              <ul className="divide-y rounded-2xl border bg-card text-sm">
                {orders.groups.flatMap((group) =>
                  group.orders.map((order) => (
                    <li key={order.id}>
                      <Link
                        href={routes.orders.detail(order.id)}
                        className="flex items-start justify-between gap-3 p-3 transition-colors hover:bg-muted/30"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            {order.fulfillmentMode === 'DELIVERY' ? (
                              <Truck
                                className="size-4 shrink-0 text-muted-foreground"
                                aria-label={t('orders.modes.DELIVERY')}
                              />
                            ) : (
                              <Store
                                className="size-4 shrink-0 text-muted-foreground"
                                aria-label={t('orders.modes.PICKUP')}
                              />
                            )}
                            <span className="tabular-nums">{order.numberLabel}</span>
                            <span className="truncate">· {order.customerName}</span>
                          </span>
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {group.start && group.end
                              ? t('orders.window', { start: group.start, end: group.end })
                              : t('care.agenda.allDay')}
                          </span>
                        </span>
                        <OrderStatusBadge status={order.status} />
                      </Link>
                    </li>
                  )),
                )}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
