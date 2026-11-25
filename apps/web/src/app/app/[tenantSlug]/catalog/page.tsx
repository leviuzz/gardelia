import { CameraOff, Flower2, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listCatalogItems, type CatalogItemDto } from '@floral/core';
import {
  AVAILABILITY_STATES,
  CATALOG_ITEM_TYPES,
  CATALOG_ONLINE_FILTERS,
  canShowOnline,
  catalogListFiltersSchema,
} from '@floral/domain';
import { AvailabilityBadge } from '@/components/common/status-badges';
import { ColorSwatch } from '@/components/common/color-swatch';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { money } from '@/lib/format';
import { tenantRoutes, type TenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { PrivateImage } from '@/components/common/private-image';
import { setItemFeaturedAction, setItemOnlineAction, setItemsOnlineAction } from './actions';
import { CatalogBulkSelection, SelectItemCheckbox, SelectPageCheckbox } from './bulk-online';
import { FeaturedToggle } from './featured-toggle';
import { OnlineToggle } from './online-toggle';

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
    online: single(raw.online),
    page: single(raw.page),
  };
  const filters = catalogListFiltersSchema.parse(query);
  const result = await listCatalogItems(ctx, query);
  const t = await getTranslations('catalog');
  const routes = tenantRoutes(ctx.tenantSlug);
  const hasFilters = Boolean(
    filters.q ||
    filters.type ||
    filters.availability ||
    filters.online ||
    filters.status !== 'ACTIVE',
  );

  // L'interruttore "Tienda en línea" c'è per chi modifica il catalogo, sui prodotti che la tienda
  // può vendere e solo se attivi (stesse regole della scheda del prodotto).
  const canToggleOnline = (item: CatalogItemDto) =>
    result.canWrite && canShowOnline(item.type) && item.status === 'ACTIVE';
  const onlineToggle = (item: CatalogItemDto) => (
    <span className="flex items-center gap-3">
      <OnlineToggle
        action={setItemOnlineAction.bind(null, ctx.tenantSlug, item.id)}
        isOnline={item.isOnline}
        name={item.name}
      />
      {/* «In evidenza» nella vetrina (M1): solo per chi è online. */}
      {item.isOnline ? (
        <FeaturedToggle
          action={setItemFeaturedAction.bind(null, ctx.tenantSlug, item.id)}
          featured={item.featured}
          name={item.name}
        />
      ) : null}
    </span>
  );

  // Più prodotti insieme (M1-2): le righe che l'interruttore può cambiare.
  const selectableIds = result.items.filter(canToggleOnline).map((item) => item.id);
  const select = (item: CatalogItemDto) =>
    canToggleOnline(item) ? <SelectItemCheckbox id={item.id} name={item.name} /> : null;
  const noPhoto = (item: CatalogItemDto) =>
    item.isOnline && item.coverPhotoId === null ? (
      <Badge variant="warning" className="gap-1">
        <CameraOff className="size-3" aria-hidden="true" />
        {t('noPhotoBadge')}
      </Badge>
    ) : null;

  function pageHref(page: number): string {
    return routes.catalog.list({
      q: filters.q,
      type: filters.type,
      availability: filters.availability,
      online: filters.online,
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
        className="sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]"
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
        <NativeSelect
          name="online"
          defaultValue={filters.online ?? ''}
          aria-label={t('filterOnline')}
        >
          <option value="">{t('onlineAll')}</option>
          {CATALOG_ONLINE_FILTERS.map((value) => (
            <option key={value} value={value}>
              {t(value === 'yes' ? 'onlineYes' : value === 'no' ? 'onlineNo' : 'onlineNoPhoto')}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>

      {/* Prodotti online senza foto (M1-2): chi compra vede solo un'icona. */}
      {result.canWrite && result.onlineWithoutPhoto > 0 && filters.online !== 'no_photo' ? (
        <Alert variant="warning" data-testid="catalog-no-photo">
          <CameraOff aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t('noPhotoWarning', { count: result.onlineWithoutPhoto })}</span>
            <Link
              href={routes.catalog.list({ online: 'no_photo' })}
              className="font-medium underline-offset-4 hover:underline"
            >
              {t('noPhotoAction')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

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
        <CatalogBulkSelection action={setItemsOnlineAction.bind(null, ctx.tenantSlug)}>
          {/* Mobile: schede */}
          {result.canWrite && selectableIds.length > 0 ? (
            <div className="flex items-center gap-3 px-1 text-sm text-muted-foreground md:hidden">
              <SelectPageCheckbox ids={selectableIds} />
              <span aria-hidden="true">{t('bulk.selectPage')}</span>
            </div>
          ) : null}
          <ul className="space-y-3 md:hidden">
            {result.items.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-2xl border bg-card shadow-xs">
                <Link href={routes.catalog.item(item.id)} className="block p-4 active:bg-muted/50">
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
                    {item.isOnline && !canToggleOnline(item) ? (
                      <Badge variant="info">{t('onlineBadge')}</Badge>
                    ) : null}
                    {noPhoto(item)}
                    {item.status === 'ARCHIVED' ? (
                      <Badge variant="muted">{t('archivedBadge')}</Badge>
                    ) : null}
                  </div>
                </Link>
                {/* Fuori dal link: un interruttore dentro un link non si può premere da solo. */}
                {canToggleOnline(item) ? (
                  <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-sm">
                    <span className="flex items-center gap-3">
                      {select(item)}
                      {t('onlineRow')}
                    </span>
                    {onlineToggle(item)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {/* Desktop: tabella */}
          <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <tr>
                  {result.canWrite ? (
                    <th scope="col" className="w-10 py-3 pl-4">
                      <SelectPageCheckbox ids={selectableIds} />
                    </th>
                  ) : null}
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
                  <th scope="col" className="px-4 py-3">
                    {t('columnOnline')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.items.map((item) => (
                  <tr key={item.id} className="group transition-colors hover:bg-muted/30">
                    {result.canWrite ? <td className="w-10 py-3 pl-4">{select(item)}</td> : null}
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
                        {noPhoto(item)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {canToggleOnline(item) ? (
                        onlineToggle(item)
                      ) : item.isOnline ? (
                        <Badge variant="info">{t('onlineBadge')}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CatalogBulkSelection>
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
