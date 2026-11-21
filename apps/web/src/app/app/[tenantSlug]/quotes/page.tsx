import { ChevronLeft, ChevronRight, FileText, Plus, Search, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getEntitlements, hasPermission, listQuotes } from '@floral/core';
import { QUOTE_STATUSES, quoteListFiltersSchema } from '@floral/domain';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { money } from '@/lib/format';
import { QUOTE_STATUS_BADGE, calendarDate } from '@/lib/quote-ui';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

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
  const base = `/app/${ctx.tenantSlug}/quotes`;
  const hasFilters = Boolean(filters.q || filters.status);
  const date = (value: string) =>
    format.dateTime(calendarDate(value), { dateStyle: 'medium', timeZone: 'UTC' });

  function pageHref(page: number): string {
    const search = new URLSearchParams();
    if (filters.q) search.set('q', filters.q);
    if (filters.status) search.set('status', filters.status);
    if (page > 1) search.set('page', String(page));
    const qs = search.toString();
    return qs ? `${base}?${qs}` : base;
  }

  const newButton = result.canWrite ? (
    <Button asChild>
      <Link href={`${base}/new`}>
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
          <Link href={`/app/${ctx.tenantSlug}/builder/new`}>
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

      <form
        method="get"
        action={base}
        className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder={t('searchPlaceholder')}
            aria-label={tc('search')}
            className="pl-9"
          />
        </div>
        <NativeSelect name="status" defaultValue={filters.status ?? ''} aria-label={tc('filter')}>
          <option value="">{t('allStatuses')}</option>
          {QUOTE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`statuses.${status}`)}
            </option>
          ))}
        </NativeSelect>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" className="flex-1">
            {tc('filter')}
          </Button>
          {hasFilters ? (
            <Button asChild variant="ghost">
              <Link href={base}>{tc('clearFilters')}</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {result.items.length === 0 ? (
        hasFilters ? (
          <EmptyState icon={<Search />} title={t('noResultsTitle')} body={t('noResultsBody')} />
        ) : (
          <EmptyState
            icon={<FileText />}
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={newButton}
          />
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('results', { count: result.total })}
          </p>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {result.items.map((quote) => (
              <li key={quote.id}>
                <Link
                  href={`${base}/${quote.id}`}
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
                  <Badge variant={QUOTE_STATUS_BADGE[quote.status]}>
                    {t(`statuses.${quote.status}`)}
                  </Badge>
                  <span className="w-28 text-right font-semibold tabular-nums">
                    {money(quote.totalMinor, quote.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {result.pageCount > 1 ? (
            <nav
              className="flex items-center justify-between"
              aria-label={tc('pageOf', { page: result.page, pageCount: result.pageCount })}
            >
              <Button
                asChild
                variant="outline"
                size="sm"
                className={cn(result.page <= 1 && 'pointer-events-none opacity-50')}
              >
                <Link href={pageHref(result.page - 1)} aria-disabled={result.page <= 1}>
                  <ChevronLeft />
                  {tc('previous')}
                </Link>
              </Button>
              <span className="text-sm text-muted-foreground">
                {tc('pageOf', { page: result.page, pageCount: result.pageCount })}
              </span>
              <Button
                asChild
                variant="outline"
                size="sm"
                className={cn(result.page >= result.pageCount && 'pointer-events-none opacity-50')}
              >
                <Link
                  href={pageHref(result.page + 1)}
                  aria-disabled={result.page >= result.pageCount}
                >
                  {tc('next')}
                  <ChevronRight />
                </Link>
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
