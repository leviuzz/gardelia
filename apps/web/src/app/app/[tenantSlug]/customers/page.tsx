import { FileUp, Plus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listCustomerTags, listCustomers, type CustomerSummaryDto } from '@floral/core';
import {
  CUSTOMER_CONSENT_FILTERS,
  CUSTOMER_TYPES,
  customerListFiltersSchema,
} from '@floral/domain';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { CustomerBulkTags, CustomerSelectBox } from '@/components/customers/customer-bulk-tags';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { initials, phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { updateCustomerTagsAction } from './actions';

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
    tag: single(raw.tag),
    consent: single(raw.consent),
    upcoming: single(raw.upcoming),
    page: single(raw.page),
  };
  const filters = customerListFiltersSchema.parse(query);
  const [result, tags] = await Promise.all([listCustomers(ctx, query), listCustomerTags(ctx)]);
  const t = await getTranslations('customers');
  const tc = await getTranslations('common');
  const routes = tenantRoutes(ctx.tenantSlug);
  const hasFilters = Boolean(
    filters.q ||
    filters.type ||
    filters.status !== 'ACTIVE' ||
    filters.tag ||
    filters.consent ||
    filters.upcoming,
  );
  // L'etichetta filtrata resta fra le scelte anche se nessun cliente la usa più.
  const tagOptions = filters.tag && !tags.includes(filters.tag) ? [filters.tag, ...tags] : tags;

  function pageHref(page: number): string {
    return routes.customers.list({
      q: filters.q,
      type: filters.type,
      status: filters.status === 'ACTIVE' ? undefined : filters.status,
      tag: filters.tag || undefined,
      consent: filters.consent,
      upcoming: filters.upcoming ? 1 : undefined,
      page: page > 1 ? page : undefined,
    });
  }

  const list = (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
      {result.items.map((customer) => (
        <li key={customer.id} className="flex">
          {result.canWrite ? (
            <CustomerSelectBox
              customerId={customer.id}
              label={t('bulk.select', { name: customer.displayName })}
            />
          ) : null}
          <CustomerRow
            customer={customer}
            href={routes.customers.detail(customer.id)}
            typeLabel={t(`types.${customer.type}`)}
            archivedLabel={t('archivedBadge')}
          />
        </li>
      ))}
    </ul>
  );

  const newButton = result.canWrite ? (
    <Button asChild>
      <Link href={routes.customers.new}>
        <Plus />
        {t('newCustomer')}
      </Link>
    </Button>
  ) : null;
  // Import da CSV (ADR-070): accanto a "Nuevo cliente", per chi può crearli.
  const importButton = result.canWrite ? (
    <Button asChild variant="outline">
      <Link href={routes.customers.import.new}>
        <FileUp />
        {t('import.open')}
      </Link>
    </Button>
  ) : null;
  const headerActions = result.canWrite ? (
    <div className="flex flex-wrap gap-2">
      {importButton}
      {newButton}
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} actions={headerActions} />

      <FilterBar
        action={routes.customers.list()}
        search={{ defaultValue: filters.q, placeholder: t('searchPlaceholder') }}
        hasFilters={hasFilters}
        className="sm:grid-cols-2 lg:grid-cols-4"
        searchClassName="sm:col-span-2"
      >
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
        <NativeSelect name="tag" defaultValue={filters.tag} aria-label={t('filters.tag')}>
          <option value="">{t('filters.allTags')}</option>
          {tagOptions.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="consent"
          defaultValue={filters.consent ?? ''}
          aria-label={t('filters.consent')}
        >
          <option value="">{t('filters.anyConsent')}</option>
          {CUSTOMER_CONSENT_FILTERS.map((consent) => (
            <option key={consent} value={consent}>
              {t(`filters.consentOptions.${consent}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="upcoming"
          defaultValue={filters.upcoming ? '1' : ''}
          aria-label={t('filters.upcoming')}
        >
          <option value="">{t('filters.anyDate')}</option>
          <option value="1">{t('filters.upcomingOption')}</option>
        </NativeSelect>
      </FilterBar>

      <ListResults
        isEmpty={result.items.length === 0}
        hasFilters={hasFilters}
        noResults={{ title: t('noResultsTitle'), body: t('noResultsBody') }}
        empty={
          <EmptyState
            icon={<Users />}
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={headerActions}
          />
        }
        count={t('results', { count: result.total })}
      >
        {result.canWrite ? (
          <CustomerBulkTags
            key={routes.customers.list(query)}
            action={updateCustomerTagsAction.bind(null, ctx.tenantSlug)}
            customerIds={result.items.map((customer) => customer.id)}
            tags={tags}
          >
            {list}
          </CustomerBulkTags>
        ) : (
          list
        )}
        <ListPagination page={result.page} pageCount={result.pageCount} href={pageHref} />
      </ListResults>
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
      className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
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
