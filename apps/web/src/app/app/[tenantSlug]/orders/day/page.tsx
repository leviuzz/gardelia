import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Mail,
  Printer,
  Store,
  Truck,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getOrdersDay, hasPermission } from '@floral/core';
import { addDays, parseIsoDate, toIsoDate } from '@floral/domain';
import { OrderStatusBadge } from '@/components/common/status-badges';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { money } from '@/lib/format';
import { isBackStep } from '@/lib/order-ui';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { changeOrderStatusAction } from '../actions';
import { OrderStepActions } from '../order-forms';
import { OrdersTabs } from '../orders-tabs';
import { ProductionList } from '../production-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders.day');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Il giorno dei pedidos (ADR-057): "Hoy salen" per fascia con i passi rapidi e la Producción del
 * día. Pensata per il banco e per il telefono: ogni ordine è una scheda con il prossimo passo.
 */
export default async function OrdersDayPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/orders/day'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const view = await getOrdersDay(ctx, single(raw.date));
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const current = parseIsoDate(view.date);
  const shift = (days: number) => (current ? toIsoDate(addDays(current, days)) : undefined);
  const longDate = format.dateTime(calendarDate(view.date), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const canWrite = hasPermission(ctx, 'orders:write');
  type DayOrder = (typeof view.groups)[number]['orders'][number];
  // Un solo pulsante per scheda: il prossimo passo. Salti e correzioni si fanno dalla scheda.
  const nextStep = (order: DayOrder) =>
    order.nextSteps.filter((step) => !isBackStep(order.status, step)).slice(0, 1);
  const isDone = (order: DayOrder) => order.status === 'DELIVERED' || order.status === 'PICKED_UP';
  // Da fare per fascia; quelli già usciti in fondo, chiusi.
  const openGroups = view.groups
    .map((group) => ({ ...group, orders: group.orders.filter((order) => !isDone(order)) }))
    .filter((group) => group.orders.length > 0);
  const doneOrders = view.groups.flatMap((group) => group.orders.filter(isDone));
  const renderOrder = (order: DayOrder) => (
    <article className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={routes.orders.detail(order.id)} className="font-medium hover:underline">
            <span className="tabular-nums">{order.numberLabel}</span> · {order.customerName}
          </Link>
          {order.recipientName ? (
            <p className="text-sm text-muted-foreground">
              {t('orders.forRecipient', { name: order.recipientName })}
            </p>
          ) : null}
        </div>
        <span className="flex flex-wrap gap-1.5">
          <OrderStatusBadge status={order.status} />
          {order.balanceMinor > 0 ? (
            <Badge variant="warning">
              {t('orders.day.toCollect', {
                amount: money(order.balanceMinor, order.currency),
              })}
            </Badge>
          ) : null}
        </span>
      </div>
      <p className="flex items-start gap-2 text-sm">
        {order.fulfillmentMode === 'DELIVERY' ? (
          <Truck
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-label={t('orders.modes.DELIVERY')}
          />
        ) : (
          <Store
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-label={t('orders.modes.PICKUP')}
          />
        )}
        <span>{order.addressLine ?? t('orders.modes.PICKUP')}</span>
      </p>
      <p className="text-sm text-muted-foreground">
        {format.list(order.lines.map((line) => `${line.quantity} × ${line.description}`))}
        {order.hasCard ? (
          <span className="ml-2 inline-flex items-center gap-1 text-foreground">
            <Mail className="size-3.5" aria-hidden="true" />
            {t('orders.day.withCard')}
          </span>
        ) : null}
      </p>
      {nextStep(order).length > 0 ? (
        <OrderStepActions
          action={changeOrderStatusAction.bind(null, slug, order.id)}
          current={order.status}
          steps={nextStep(order)}
        />
      ) : null}
    </article>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <OrdersTabs routes={routes} current="day" />
      <PageHeader
        title={view.isToday ? t('orders.day.today') : t('orders.day.title')}
        description={<span className="inline-block first-letter:uppercase">{longDate}</span>}
        actions={
          canWrite ? (
            <Button asChild>
              <Link href={routes.orders.new()}>
                <ClipboardList />
                {t('orders.newOrder')}
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label={t('orders.day.previous')}>
          <Link href={routes.orders.day({ date: shift(-1) })}>
            <ChevronLeft />
          </Link>
        </Button>
        <Button asChild variant="outline" size="icon" aria-label={t('orders.day.next')}>
          <Link href={routes.orders.day({ date: shift(1) })}>
            <ChevronRight />
          </Link>
        </Button>
        {view.isToday ? null : (
          <Button asChild variant="outline">
            <Link href={routes.orders.day()}>{t('orders.day.goToday')}</Link>
          </Button>
        )}
        <form method="get" action={routes.orders.day()} className="flex gap-2">
          <Input
            type="date"
            name="date"
            defaultValue={view.date}
            aria-label={t('orders.day.pickDate')}
            className="w-44"
          />
          <Button type="submit" variant="secondary">
            {t('orders.day.show')}
          </Button>
        </form>
      </div>

      {view.counts.total === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t('orders.day.emptyTitle')}
          body={t('orders.day.emptyBody')}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('orders.day.summary', {
              total: view.counts.total,
              deliveries: view.counts.deliveries,
              pickups: view.counts.pickups,
              pending: view.counts.pending,
            })}
          </p>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="min-w-0 space-y-6">
              {openGroups.length === 0 ? (
                <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
                  {t('orders.day.allDone')}
                </p>
              ) : null}
              {openGroups.map((group) => (
                <section key={`${group.start ?? 'all'}-${group.end ?? ''}`} className="space-y-3">
                  <h2 className="font-display text-lg font-semibold tabular-nums">
                    {group.start && group.end
                      ? t('orders.window', { start: group.start, end: group.end })
                      : t('orders.allDay')}
                  </h2>
                  <ul className="grid gap-3">
                    {group.orders.map((order) => (
                      <li key={order.id}>{renderOrder(order)}</li>
                    ))}
                  </ul>
                </section>
              ))}
              {doneOrders.length > 0 ? (
                <details className="rounded-2xl border bg-muted/30 p-4">
                  <summary className="cursor-pointer font-medium">
                    {t('orders.day.done', { count: doneOrders.length })}
                  </summary>
                  <ul className="mt-3 grid gap-3">
                    {doneOrders.map((order) => (
                      <li key={order.id}>{renderOrder(order)}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>

            <div className="min-w-0">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <CardTitle>{t('orders.production.title')}</CardTitle>
                    <CardDescription>
                      {t('orders.production.summary', {
                        bouquets: view.production.bouquets,
                        orders: view.productionOrders,
                      })}
                    </CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={routes.orders.production({ date: view.date })}>
                      <Printer />
                      {t('orders.production.print')}
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  <ProductionList production={view.production} />
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
