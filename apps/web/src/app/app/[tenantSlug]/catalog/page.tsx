import { Flower2, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listCatalogItems, type CatalogItemDto } from '@floral/core';
import { AVAILABILITY_STATES, CATALOG_ITEM_TYPES, catalogListFiltersSchema } from '@floral/domain';
import { AvailabilityBadge } from '@/components/common/status-badges';
import { ColorSwatch } from '@/components/common/color-swatch';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { money } from '@/lib/format';
import { tenantRoutes, type TenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { PrivateImage } from '@/components/common/private-image';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('catalog');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CatalogPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/catalog'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const query = {
    q: single(raw.q),
    type: single(raw.type),
    status: single(raw.status),
    availability: single(raw.availability),
    page: single(raw.page),
  };
  const filters = catalogListFiltersSchema.parse(query);
  const result = await listCatalogItems(ctx, query);
  const t = await getTranslations('catalog');
  const routes = tenantRoutes(ctx.tenantSlug);
  const hasFilters = Boolean(
    filters.q || filters.type || filters.availability || filters.status !== 'ACTIVE',
  );

  function pageHref(page: number): string {
    return routes.catalog.list({
      q: filters.q,
      type: filters.type,
      availability: filters.availability,
      status: filters.status === 'ACTIVE' ? undefined : filters.status,
      page: page > 1 ? page : undefined,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          result.canWrite ? (
            <Button asChild>
              <Link href={routes.catalog.new}>
                <Plus />
                {t('newItem')}
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        action={routes.catalog.list()}
        search={{ defaultValue: filters.q, placeholder: t('searchPlaceholder') }}
        hasFilters={hasFilters}
        className="sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]"
        searchClassName="sm:col-span-2 lg:col-span-1"
        submitClassName="lg:flex-none"
      >
        <NativeSelect name="type" defaultValue={filters.type ?? ''} aria-label={t('filterType')}>
          <option value="">{t('allTypes')}</option>
          {CATALOG_ITEM_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`types.${type}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="availability"
          defaultValue={filters.availability ?? ''}
          aria-label={t('filterAvailability')}
        >
          <option value="">{t('allAvailability')}</option>
          {AVAILABILITY_STATES.map((state) => (
            <option key={state} value={state}>
              {t(`availability.${state}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={filters.status} aria-label={t('filterStatus')}>
          <option value="ACTIVE">{t('statusActive')}</option>
          <option value="ARCHIVED">{t('statusArchived')}</option>
        </NativeSelect>
      </FilterBar>

      <ListResults
        isEmpty={result.items.length === 0}
        hasFilters={hasFilters}
        noResults={{ title: t('noResultsTitle'), body: t('noResultsBody') }}
        empty={
          <EmptyState
            icon={<Flower2 />}
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={
              result.canWrite ? (
                <Button asChild>
                  <Link href={routes.catalog.new}>
                    <Plus />
                    {t('newItem')}
                  </Link>
                </Button>
              ) : null
            }
          />
        }
        count={t('results', { count: result.total })}
      >
        {/* Mobile: schede */}
        <ul className="space-y-3 md:hidden">
          {result.items.map((item) => (
            <li key={item.id}>
              <Link
                href={routes.catalog.item(item.id)}
                className="block rounded-2xl border bg-card p-4 shadow-xs active:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <ItemName item={item} routes={routes} />
                  <span className="shrink-0 text-right font-semibold tabular-nums">
                    {money(item.priceMinor, item.currency)}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t('perUnit', { unit: t(`units.${item.saleUnit}`) })}
                    </span>
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">{t(`types.${item.type}`)}</Badge>
                  <AvailabilityBadge availability={item.availability} />
                  {item.status === 'ARCHIVED' ? (
                    <Badge variant="muted">{t('archivedBadge')}</Badge>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {/* Desktop: tabella */}
        <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">
                  {t('columnName')}
                </th>
                <th scope="col" className="px-4 py-3">
                  {t('columnType')}
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  {t('columnPrice')}
                </th>
                {result.canViewCosts ? (
                  <th scope="col" className="px-4 py-3 text-right">
                    {t('columnCost')}
                  </th>
                ) : null}
                <th scope="col" className="px-4 py-3">
                  {t('columnAvailability')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.items.map((item) => (
                <tr key={item.id} className="group transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={routes.catalog.item(item.id)}
                      className="block focus-visible:outline-none"
                    >
                      <ItemName item={item} routes={routes} />
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-muted-foreground">{t(`types.${item.type}`)}</span>
                    {item.type === 'BOUQUET' && item.recipeLineCount !== null ? (
                      <span className="block text-xs text-muted-foreground/80">
                        {t('recipeLines', { count: item.recipeLineCount })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="font-medium">{money(item.priceMinor, item.currency)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('perUnit', { unit: t(`units.${item.saleUnit}`) })}
                    </span>
                  </td>
                  {result.canViewCosts ? (
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.costMinor !== null ? (
                        money(item.costMinor, item.currency)
                      ) : item.type === 'BOUQUET' || item.type === 'SERVICE' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge variant="warning">{t('noCost')}</Badge>
                      )}
                    </td>
                  ) : null}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <AvailabilityBadge availability={item.availability} />
                      {item.status === 'ARCHIVED' ? (
                        <Badge variant="muted">{t('archivedBadge')}</Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ListPagination page={result.page} pageCount={result.pageCount} href={pageHref} />
      </ListResults>
    </div>
  );
}

function ItemName({ item, routes }: { item: CatalogItemDto; routes: TenantRoutes }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {item.coverPhotoId ? (
        <PrivateImage
          src={routes.catalog.photo(item.coverPhotoId, 'thumb')}
          alt=""
          className="size-10 shrink-0 rounded-lg border bg-muted object-cover"
        />
      ) : null}
      <span className="flex -space-x-1" aria-hidden="true">
        {(item.colors.length > 0 ? item.colors.slice(0, 3) : ['__none']).map((color) => (
          <ColorSwatch
            key={color}
            color={color === '__none' ? null : color}
            className="ring-2 ring-card"
          />
        ))}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{item.name}</span>
        {item.variety || item.sku ? (
          <span className="block truncate text-xs text-muted-foreground">
            {[item.variety, item.sku].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </span>
    </span>
  );
}
