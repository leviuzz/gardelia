import { ArrowLeft, Boxes, PackagePlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getEntitlements, hasPermission, listInventory } from '@floral/core';
import { inventoryListFiltersSchema } from '@floral/domain';
import { PrivateImage } from '@/components/common/private-image';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { Forbidden } from '@/components/forbidden';
import { InventoryTabs, StockStatusBadge } from '@/components/inventory/inventory-ui';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Existencias (ADR-060): i prodotti controllati con quanto ce n'è, gli avvisi ("por agotarse",
 * "agotado") e, per chi vede i costi, il valore della merce. Una sola voce nel menu: i movimenti
 * sono la seconda scheda.
 */
export default async function InventoryPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:read')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const tc = await getTranslations('catalog');
  const routes = tenantRoutes(ctx.tenantSlug);

  const header = <PageHeader title={t('title')} description={t('subtitle')} />;
  if (!(await getEntitlements(ctx)).inventory) {
    return (
      <div className="space-y-6">
        {header}
        <InventoryUpsell ctx={ctx} />
      </div>
    );
  }

  const raw = await searchParams;
  const query = {
    q: single(raw.q),
    status: single(raw.status),
    archived: single(raw.archived),
    page: single(raw.page),
  };
  const filters = inventoryListFiltersSchema.parse(query);
  const result = await listInventory(ctx, query);
  const started = Number(single(raw.started));
  const hasFilters = Boolean(filters.q || filters.status);
  const listHref = (page: number) =>
    routes.inventory.list({
      q: filters.q,
      status: filters.status,
      archived: filters.archived,
      page: page > 1 ? page : undefined,
    });
  const chooseButton = result.canWrite ? (
    <Button asChild>
      <Link href={routes.inventory.start()}>
        <PackagePlus />
        {t('list.choose')}
      </Link>
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} actions={chooseButton} />
      <InventoryTabs
        current="stock"
        stockHref={routes.inventory.list()}
        movementsHref={routes.inventory.movements()}
      />

      {Number.isInteger(started) && single(raw.started) !== undefined ? (
        <Alert variant="success">
          <AlertDescription>
            {started > 0 ? t('start.started', { count: started }) : t('start.nothingStarted')}
          </AlertDescription>
        </Alert>
      ) : null}

      {filters.archived ? (
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={routes.inventory.list()}>
              <ArrowLeft aria-hidden="true" />
              {t('list.backToStock')}
            </Link>
          </Button>
          <h2 className="text-lg font-semibold">{t('list.archivedTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('list.archivedSubtitle')}</p>
        </div>
      ) : result.summary.tracked > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <SummaryLink
            href={routes.inventory.list()}
            active={!filters.status}
            label={t('summary.tracked', { count: result.summary.tracked })}
          />
          <SummaryLink
            href={routes.inventory.list({ status: 'LOW' })}
            active={filters.status === 'LOW'}
            tone={result.summary.low > 0 ? 'warning' : undefined}
            label={t('summary.low', { count: result.summary.low })}
          />
          <SummaryLink
            href={routes.inventory.list({ status: 'OUT' })}
            active={filters.status === 'OUT'}
            tone={result.summary.out > 0 ? 'danger' : undefined}
            label={t('summary.out', { count: result.summary.out })}
          />
          {result.canViewCosts ? (
            <span className="text-muted-foreground sm:ml-auto">
              {result.summary.valueMinor === null
                ? t('summary.valueUnknown')
                : t('summary.value', { amount: money(result.summary.valueMinor, ctx.currency) })}
            </span>
          ) : null}
        </div>
      ) : null}

      {result.summary.tracked > 0 || filters.archived ? (
        <FilterBar
          action={routes.inventory.list()}
          search={{ defaultValue: filters.q, placeholder: t('list.searchPlaceholder') }}
          hasFilters={hasFilters}
          className="sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
        >
          {filters.archived ? (
            <input type="hidden" name="archived" value="1" />
          ) : (
            <NativeSelect
              name="status"
              defaultValue={filters.status ?? ''}
              aria-label={t('list.allStatuses')}
            >
              <option value="">{t('list.allStatuses')}</option>
              <option value="LOW">{t('statuses.LOW')}</option>
              <option value="OUT">{t('statuses.OUT')}</option>
            </NativeSelect>
          )}
        </FilterBar>
      ) : null}

      <ListResults
        isEmpty={result.items.length === 0}
        hasFilters={hasFilters}
        noResults={{ title: t('list.noResultsTitle'), body: t('list.noResultsBody') }}
        empty={
          filters.archived ? (
            <EmptyState icon={<Boxes />} title={t('list.archivedEmpty')} />
          ) : (
            <EmptyState
              icon={<Boxes />}
              title={t('list.emptyTitle')}
              body={result.canWrite ? t('list.emptyBody') : t('list.emptyBodyStaff')}
              action={chooseButton}
            />
          )
        }
        count={t('list.results', { count: result.total })}
      >
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {result.items.map((item) => (
            <li key={item.id} className="min-w-0">
              <Link
                href={routes.inventory.item(item.id)}
                className="flex h-full items-start gap-3 rounded-2xl border bg-card p-4 shadow-xs transition-colors hover:bg-muted/30 active:bg-muted/50"
              >
                {item.coverPhotoId ? (
                  <PrivateImage
                    src={routes.catalog.photo(item.coverPhotoId, 'thumb')}
                    alt=""
                    className="size-12 shrink-0 rounded-lg border object-cover"
                  />
                ) : (
                  <span aria-hidden="true" className="size-12 shrink-0 rounded-lg bg-muted" />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.variety
                          ? `${tc(`types.${item.type}`)} · ${item.variety}`
                          : tc(`types.${item.type}`)}
                      </p>
                    </div>
                    <p
                      className={cn(
                        'shrink-0 text-right font-semibold tabular-nums',
                        item.onHand < 0 && 'text-destructive',
                      )}
                    >
                      {t('quantity', { unit: item.saleUnit, count: item.onHand })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {filters.archived ? null : <StockStatusBadge status={item.status} />}
                    {item.minQuantity !== null ? (
                      <span>
                        {t('list.minimum', {
                          quantity: t('quantity', { unit: item.saleUnit, count: item.minQuantity }),
                        })}
                      </span>
                    ) : null}
                    {item.valueMinor !== null && item.valueMinor > 0 ? (
                      <span>
                        {t('list.value', { amount: money(item.valueMinor, item.currency) })}
                      </span>
                    ) : null}
                    {item.catalogStatus === 'ARCHIVED' ? (
                      <Badge variant="muted">{t('list.catalogArchived')}</Badge>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <ListPagination page={result.page} pageCount={result.pageCount} href={listHref} />
      </ListResults>

      {!filters.archived && result.archivedCount > 0 ? (
        <Link
          href={routes.inventory.list({ archived: true })}
          className="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('list.archivedLink', { count: result.archivedCount })}
        </Link>
      ) : null}
      {!result.canWrite && result.summary.tracked > 0 ? (
        <p className="text-sm text-muted-foreground">{t('list.staffNote')}</p>
      ) : null}
    </div>
  );
}

function SummaryLink({
  href,
  label,
  active,
  tone,
}: {
  readonly href: string;
  readonly label: string;
  readonly active: boolean;
  readonly tone?: 'warning' | 'danger' | undefined;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-full border px-3 py-1 font-medium transition-colors hover:bg-muted',
        active && 'border-foreground/30 bg-muted',
        tone === 'warning' && 'text-[oklch(0.42_0.1_65)]',
        tone === 'danger' && 'text-[oklch(0.45_0.17_27)]',
      )}
    >
      {label}
    </Link>
  );
}
