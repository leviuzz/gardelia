import { FileText, Plus, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getEntitlements, hasPermission, listQuotes } from '@floral/core';
import { QUOTE_STATUSES, quoteListFiltersSchema } from '@floral/domain';
import { QuoteStatusBadge } from '@/components/common/status-badges';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { money } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('quotes');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function QuotesPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/quotes'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const query = { q: single(raw.q), status: single(raw.status), page: single(raw.page) };
  const filters = quoteListFiltersSchema.parse(query);
  const result = await listQuotes(ctx, query);
  const t = await getTranslations('quotes');
  const tc = await getTranslations('common');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const hasFilters = Boolean(filters.q || filters.status);
  const date = (value: string) =>
    format.dateTime(calendarDate(value), { dateStyle: 'medium', timeZone: 'UTC' });

  function pageHref(page: number): string {
    return routes.quotes.list({
      q: filters.q,
      status: filters.status,
      page: page > 1 ? page : undefined,
    });
  }

  const newButton = result.canWrite ? (
    <Button asChild>
      <Link href={routes.quotes.new()}>
        <Plus />
        {t('newQuote')}
      </Link>
    </Button>
  ) : null;
  const canDesign =
    result.canWrite &&
    hasPermission(ctx, 'builder:use') &&
    (await getEntitlements(ctx)).bouquetBuilder;
  const headerActions = (
    <>
      {canDesign ? (
        <Button asChild variant="outline">
          <Link href={routes.builder.new}>
            <Sparkles />
            {t('designRamo')}
          </Link>
        </Button>
      ) : null}
      {newButton}
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} actions={headerActions} />

      <FilterBar
        action={routes.quotes.list()}
        search={{ defaultValue: filters.q, placeholder: t('searchPlaceholder') }}
        hasFilters={hasFilters}
        className="sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
      >
        <NativeSelect name="status" defaultValue={filters.status ?? ''} aria-label={tc('filter')}>
          <option value="">{t('allStatuses')}</option>
          {QUOTE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`statuses.${status}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>

      <ListResults
        isEmpty={result.items.length === 0}
        hasFilters={hasFilters}
        noResults={{ title: t('noResultsTitle'), body: t('noResultsBody') }}
        empty={
          <EmptyState
            icon={<FileText />}
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={newButton}
          />
        }
        count={t('results', { count: result.total })}
      >
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {result.items.map((quote) => (
            <li key={quote.id}>
              <Link
                href={routes.quotes.detail(quote.id)}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="w-24 shrink-0 text-sm font-medium tabular-nums">
                  {quote.numberLabel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{quote.customerName}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {quote.title ??
                      (quote.validUntil
                        ? t('validUntil', { date: date(quote.validUntil) })
                        : t('noValidity'))}
                  </span>
                </span>
                <QuoteStatusBadge status={quote.status} />
                <span className="w-28 text-right font-semibold tabular-nums">
                  {money(quote.totalMinor, quote.currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <ListPagination page={result.page} pageCount={result.pageCount} href={pageHref} />
      </ListResults>
    </div>
  );
}
