import { ChevronLeft, ChevronRight, Plus, Search, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listCustomers, type CustomerSummaryDto } from '@floral/core';
import { CUSTOMER_TYPES, customerListFiltersSchema } from '@floral/domain';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { initials, phoneForInput } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('customers');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CustomersPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/customers'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const query = {
    q: single(raw.q),
    type: single(raw.type),
    status: single(raw.status),
    page: single(raw.page),
  };
  const filters = customerListFiltersSchema.parse(query);
  const result = await listCustomers(ctx, query);
  const t = await getTranslations('customers');
  const tc = await getTranslations('common');
  const base = `/app/${ctx.tenantSlug}/customers`;
  const hasFilters = Boolean(filters.q || filters.type || filters.status !== 'ACTIVE');

  function pageHref(page: number): string {
    const search = new URLSearchParams();
    if (filters.q) search.set('q', filters.q);
    if (filters.type) search.set('type', filters.type);
    if (filters.status !== 'ACTIVE') search.set('status', filters.status);
    if (page > 1) search.set('page', String(page));
    const qs = search.toString();
    return qs ? `${base}?${qs}` : base;
  }

  const newButton = result.canWrite ? (
    <Button asChild>
      <Link href={`${base}/new`}>
        <Plus />
        {t('newCustomer')}
      </Link>
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} actions={newButton} />

      <form
        method="get"
        action={base}
        className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto]"
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
        <NativeSelect name="type" defaultValue={filters.type ?? ''} aria-label={t('form.type')}>
          <option value="">{t('allTypes')}</option>
          {CUSTOMER_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`types.${type}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={filters.status} aria-label={tc('filter')}>
          <option value="ACTIVE">{t('statusActive')}</option>
          <option value="ARCHIVED">{t('statusArchived')}</option>
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
            icon={<Users />}
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
            {result.items.map((customer) => (
              <li key={customer.id}>
                <CustomerRow
                  customer={customer}
                  href={`${base}/${customer.id}`}
                  typeLabel={t(`types.${customer.type}`)}
                  archivedLabel={t('archivedBadge')}
                />
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

function CustomerRow({
  customer,
  href,
  typeLabel,
  archivedLabel,
}: {
  customer: CustomerSummaryDto;
  href: string;
  typeLabel: string;
  archivedLabel: string;
}) {
  const contact = [phoneForInput(customer.phone), customer.email].filter(Boolean).join(' · ');
  return (
    <Link
      href={href}
      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
        aria-hidden="true"
      >
        {initials(customer.displayName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{customer.displayName}</span>
        {contact ? (
          <span className="block truncate text-sm text-muted-foreground">{contact}</span>
        ) : null}
      </span>
      <span className="hidden flex-wrap justify-end gap-1.5 sm:flex">
        <Badge variant="outline">{typeLabel}</Badge>
        {customer.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="muted">
            {tag}
          </Badge>
        ))}
        {customer.status === 'ARCHIVED' ? <Badge variant="muted">{archivedLabel}</Badge> : null}
      </span>
    </Link>
  );
}
