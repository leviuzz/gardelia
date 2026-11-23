import { ShoppingBasket, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getEntitlements, hasPermission, listPurchases } from '@floral/core';
import { purchaseListFiltersSchema } from '@floral/domain';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { Forbidden } from '@/components/forbidden';
import { InventoryTabs } from '@/components/inventory/inventory-ui';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory.purchases');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Compras al mayorista (ADR-061): solo proprietario e manager, perché hanno i prezzi. */
export default async function PurchasesPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory/purchases'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:write')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  if (!(await getEntitlements(ctx)).inventory) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <InventoryUpsell ctx={ctx} />
      </div>
    );
  }

  const raw = await searchParams;
  const query = { q: single(raw.q), page: single(raw.page) };
  const filters = purchaseListFiltersSchema.parse(query);
  const result = await listPurchases(ctx, query);
  const newButton = (
    <Button asChild>
      <Link href={routes.inventory.newPurchase}>
        <ShoppingBasket />
        {t('purchases.new')}
      </Link>
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('purchases.subtitle')}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={routes.inventory.suppliers()}>
                <Truck />
                {t('purchases.suppliersLink')}
              </Link>
            </Button>
            {newButton}
          </>
        }
      />
      <InventoryTabs current="purchases" routes={routes} showPurchases={true} />
      <FilterBar
        action={routes.inventory.purchases()}
        search={{ defaultValue: filters.q, placeholder: t('purchases.searchPlaceholder') }}
        hasFilters={Boolean(filters.q)}
        className="sm:grid-cols-[minmax(0,1fr)_auto]"
      />
      <ListResults
        isEmpty={result.purchases.length === 0}
        hasFilters={Boolean(filters.q)}
        noResults={{
          title: t('purchases.noResultsTitle'),
          body: t('purchases.noResultsBody'),
        }}
        empty={
          <EmptyState
            icon={<ShoppingBasket />}
            title={t('purchases.emptyTitle')}
            body={t('purchases.emptyBody')}
            action={newButton}
          />
        }
        count={t('purchases.results', { count: result.total })}
      >
        <ul className="divide-y rounded-2xl border bg-card">
          {result.purchases.map((purchase) => (
            <li key={purchase.entryId}>
              <Link
                href={routes.inventory.purchase(purchase.entryId)}
                className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium">
                    {purchase.supplierName ?? t('purchases.noSupplier')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(`${purchase.purchasedOn}T12:00:00Z`), {
                      dateStyle: 'medium',
                      timeZone: 'UTC',
                    })}
                    {' · '}
                    {t('purchases.lines', { count: purchase.lines })}
                    {purchase.reference ? ` · ${purchase.reference}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {purchase.reversed ? (
                    <Badge variant="muted">{t('purchases.reversed')}</Badge>
                  ) : null}
                  <span className="font-semibold tabular-nums">
                    {money(purchase.totalMinor, purchase.currency)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <ListPagination
          page={result.page}
          pageCount={result.pageCount}
          href={(page) =>
            routes.inventory.purchases({ q: filters.q, page: page > 1 ? page : undefined })
          }
        />
      </ListResults>
    </div>
  );
}
