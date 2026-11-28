import {
  Banknote,
  ClipboardList,
  FileText,
  Globe,
  Hourglass,
  MessageSquare,
  Plus,
  Receipt,
  Store,
  Truck,
  X,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { listOrders } from '@floral/core';
import {
  ORDER_STATUSES,
  ORDER_WHEN_FILTERS,
  orderListFiltersSchema,
  pendingOrderDeadlineShown,
} from '@floral/domain';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/common/status-badges';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, NativeSelect } from '@/components/ui/input';
import { money } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { OrdersTabs } from './orders-tabs';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrdersPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/orders'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const query = {
    q: single(raw.q),
    status: single(raw.status),
    when: single(raw.when),
    unpaid: single(raw.unpaid),
    messages: single(raw.messages),
    changes: single(raw.changes),
    money: single(raw.money),
    page: single(raw.page),
  };
  const filters = orderListFiltersSchema.parse(query);
  const result = await listOrders(ctx, query);
  const t = await getTranslations('orders');
  const tc = await getTranslations('common');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const hasFilters = Boolean(
    filters.q ||
    filters.status ||
    filters.unpaid ||
    filters.messages ||
    filters.changes ||
    filters.money,
  );
  const date = (value: string) =>
    format.dateTime(calendarDate(value), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

  function href(overrides: Partial<typeof filters>): string {
    const next = { ...filters, ...overrides };
    return routes.orders.list({
      q: next.q,
      status: next.status,
      when: next.when === 'upcoming' ? undefined : next.when,
      unpaid: next.unpaid,
      // «Con messaggi da leggere» (M3).
      messages: next.messages ? 'unread' : undefined,
      // M3-2: «No ai cambi» (tornati dopo un «No, gracias») e «In attesa del cliente».
      changes: next.changes ?? undefined,
      // M3-3: «Prove da controllare» e «Contanti da confermare».
      money: next.money ?? undefined,
      page: next.page > 1 ? next.page : undefined,
    });
  }
  // I filtri dei soldi (M3-3): solo quando c'è qualcosa (o è il filtro scelto); i numeri arrivano
  // solo a chi gestisce i soldi.
  const moneyFilters = [
    {
      value: 'proofs' as const,
      count: result.pendingProofsCount,
      icon: <Receipt className="size-3.5" aria-hidden="true" />,
    },
    {
      value: 'cash' as const,
      count: result.pendingCashCount,
      icon: <Banknote className="size-3.5" aria-hidden="true" />,
    },
  ].filter((item) => item.count > 0 || filters.money === item.value);
  const deadline = (value: Date) =>
    format.dateTime(value, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: ctx.timezone,
    });

  const quotesButton = (
    <Button asChild variant="outline">
      <Link href={routes.quotes.list({ status: 'ACCEPTED' })}>
        <FileText />
        {t('goToQuotes')}
      </Link>
    </Button>
  );
  const newButton = result.canWrite ? (
    <Button asChild>
      <Link href={routes.orders.new()}>
        <Plus />
        {t('newOrder')}
      </Link>
    </Button>
  ) : null;
  const actions = (
    <>
      {quotesButton}
      {newButton}
    </>
  );

  return (
    <div className="space-y-6">
      <OrdersTabs routes={routes} current="list" />
      <PageHeader title={t('title')} description={t('subtitle')} actions={actions} />

      {result.pendingCount > 0 && filters.when !== 'pending' ? (
        <Alert variant="warning">
          <Globe aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {t('online.pendingAlert', { count: result.pendingCount })}
            <Link
              href={href({ when: 'pending', page: 1 })}
              className="font-medium underline-offset-4 hover:underline"
            >
              {t('online.review')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <nav aria-label={tc('filter')} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {/* "Por aceptar" solo quando c'è qualcosa da accettare (o è il filtro scelto). */}
        {ORDER_WHEN_FILTERS.filter(
          (when) => when !== 'pending' || result.pendingCount > 0 || filters.when === 'pending',
        ).map((when) => (
          <Link
            key={when}
            href={href({ when, page: 1 })}
            aria-current={filters.when === when ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              filters.when === when
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-muted',
            )}
          >
            {t(`when.${when}`)}
            {when === 'pending' ? ` (${result.pendingCount})` : null}
          </Link>
        ))}
        {/* «Con messaggi da leggere» (M3): solo quando ce ne sono (o è il filtro scelto). */}
        {result.unreadOrdersCount > 0 || filters.messages ? (
          <Link
            href={href({ messages: !filters.messages, when: 'all', page: 1 })}
            aria-current={filters.messages ? 'page' : undefined}
            data-testid="filter-unread-messages"
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              filters.messages
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-muted',
            )}
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {t('messages.filter', { count: result.unreadOrdersCount })}
          </Link>
        ) : null}
        {result.declinedChangesCount > 0 || filters.changes === 'declined' ? (
          <Link
            href={href({
              changes: filters.changes === 'declined' ? null : 'declined',
              when: 'all',
              page: 1,
            })}
            aria-current={filters.changes === 'declined' ? 'page' : undefined}
            data-testid="filter-declined-changes"
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              filters.changes === 'declined'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-muted',
            )}
          >
            <X className="size-3.5" aria-hidden="true" />
            {t('changes.filter', { count: result.declinedChangesCount })}
          </Link>
        ) : null}
        {/* M3-2: chi aspetta la conferma di chi compra non è «Por aceptar»: ha il suo filtro. */}
        {result.askedChangesCount > 0 || filters.changes === 'asked' ? (
          <Link
            href={href({
              changes: filters.changes === 'asked' ? null : 'asked',
              when: 'all',
              page: 1,
            })}
            aria-current={filters.changes === 'asked' ? 'page' : undefined}
            data-testid="filter-asked-changes"
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              filters.changes === 'asked'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-muted',
            )}
          >
            <Hourglass className="size-3.5" aria-hidden="true" />
            {t('changes.askedFilter', { count: result.askedChangesCount })}
          </Link>
        ) : null}
        {moneyFilters.map((item) => (
          <Link
            key={item.value}
            href={href({
              money: filters.money === item.value ? null : item.value,
              when: 'all',
              page: 1,
            })}
            aria-current={filters.money === item.value ? 'page' : undefined}
            data-testid={`filter-money-${item.value}`}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              filters.money === item.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-muted',
            )}
          >
            {item.icon}
            {t(`money.filter.${item.value}`, { count: item.count })}
          </Link>
        ))}
      </nav>

      <FilterBar
        action={routes.orders.list()}
        search={{ defaultValue: filters.q, placeholder: t('searchPlaceholder') }}
        hasFilters={hasFilters}
        className="sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] sm:items-center"
      >
        <input type="hidden" name="when" value={filters.when} />
        {filters.messages ? <input type="hidden" name="messages" value="unread" /> : null}
        {filters.changes ? <input type="hidden" name="changes" value={filters.changes} /> : null}
        {filters.money ? <input type="hidden" name="money" value={filters.money} /> : null}
        <NativeSelect name="status" defaultValue={filters.status ?? ''} aria-label={tc('filter')}>
          <option value="">{t('allStatuses')}</option>
          {/* I borradores hanno il loro filtro rapido. */}
          {ORDER_STATUSES.filter((status) => status !== 'DRAFT').map((status) => (
            <option key={status} value={status}>
              {t(`statuses.${status}`)}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          <Checkbox name="unpaid" value="1" defaultChecked={filters.unpaid} />
          {t('unpaidOnly')}
        </label>
      </FilterBar>

      <ListResults
        isEmpty={result.items.length === 0}
        hasFilters={hasFilters || filters.when !== 'upcoming'}
        noResults={{ title: t('noResultsTitle'), body: t('noResultsBody') }}
        empty={
          <EmptyState
            icon={<ClipboardList />}
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={actions}
          />
        }
        count={t('results', { count: result.total })}
      >
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {result.items.map((order) => (
            <li key={order.id}>
              <Link
                href={routes.orders.detail(order.id)}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="w-28 shrink-0">
                  {order.scheduledDate ? (
                    <>
                      <span className="block text-sm font-medium first-letter:uppercase">
                        {date(order.scheduledDate)}
                      </span>
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {order.windowStart && order.windowEnd
                          ? t('window', { start: order.windowStart, end: order.windowEnd })
                          : t('allDay')}
                      </span>
                    </>
                  ) : (
                    <span className="block text-sm text-muted-foreground">{t('noDate')}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 basis-48">
                  <span className="flex items-center gap-2">
                    {/* Il borrador non ha ancora un modo di consegna. */}
                    {order.status === 'DRAFT' ? null : order.fulfillmentMode === 'DELIVERY' ? (
                      <Truck
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-label={t('modes.DELIVERY')}
                      />
                    ) : (
                      <Store
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-label={t('modes.PICKUP')}
                      />
                    )}
                    <span className="truncate font-medium">{order.customerName}</span>
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    <span className="tabular-nums">{order.numberLabel}</span>
                    {order.recipientName
                      ? ` · ${t('forRecipient', { name: order.recipientName })}`
                      : ''}
                  </span>
                  {/* Da accettare: fino a quando, poi si annulla da solo (M3). */}
                  {order.onlineDeadline ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-[oklch(0.38_0.09_65)]">
                      <Hourglass className="size-3.5 shrink-0" aria-hidden="true" />
                      {t('online.deadlineShort', {
                        date: deadline(pendingOrderDeadlineShown(order.onlineDeadline)),
                      })}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <OrderStatusBadge status={order.status} />
                  {order.status === 'CANCELLED' || order.status === 'DRAFT' ? null : (
                    <PaymentStatusBadge status={order.paymentStatus} />
                  )}
                  {order.placedOnline ? (
                    <Badge variant="secondary">
                      <Globe aria-hidden="true" />
                      {t('online.badge')}
                    </Badge>
                  ) : null}
                  {order.changeStatus === 'ASKED' ? (
                    <Badge variant="warning" data-testid="row-change-asked">
                      <Hourglass aria-hidden="true" />
                      {t('changes.waitingBadge')}
                    </Badge>
                  ) : order.changeStatus === 'DECLINED' ? (
                    <Badge variant="danger" data-testid="row-change-declined">
                      <X aria-hidden="true" />
                      {t('changes.declinedBadge')}
                    </Badge>
                  ) : null}
                  {order.unreadMessages > 0 ? (
                    <Badge variant="info" data-testid="row-unread">
                      <MessageSquare aria-hidden="true" />
                      {t('messages.unreadBadge', { count: order.unreadMessages })}
                    </Badge>
                  ) : null}
                </span>
                <span className="ml-auto w-28 text-right font-semibold tabular-nums">
                  {money(order.totalMinor, order.currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <ListPagination
          page={result.page}
          pageCount={result.pageCount}
          href={(page) => href({ page })}
        />
      </ListResults>
    </div>
  );
}
