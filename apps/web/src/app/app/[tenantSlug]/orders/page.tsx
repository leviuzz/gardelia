import { ClipboardList, FileText, Plus, Store, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { listOrders } from '@floral/core';
import { ORDER_STATUSES, ORDER_WHEN_FILTERS, orderListFiltersSchema } from '@floral/domain';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/common/status-badges';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox, NativeSelect } from '@/components/ui/input';
import { money } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

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
    page: single(raw.page),
  };
  const filters = orderListFiltersSchema.parse(query);
  const result = await listOrders(ctx, query);
  const t = await getTranslations('orders');
  const tc = await getTranslations('common');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const hasFilters = Boolean(filters.q || filters.status || filters.unpaid);
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
      page: next.page > 1 ? next.page : undefined,
    });
  }

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
      <PageHeader title={t('title')} description={t('subtitle')} actions={actions} />

      <nav aria-label={tc('filter')} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {ORDER_WHEN_FILTERS.map((when) => (
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
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <OrderStatusBadge status={order.status} />
                  {order.status === 'CANCELLED' || order.status === 'DRAFT' ? null : (
                    <PaymentStatusBadge status={order.paymentStatus} />
                  )}
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
