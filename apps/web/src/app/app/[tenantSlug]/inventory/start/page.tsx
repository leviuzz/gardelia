import { ArrowLeft, Boxes } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getEntitlements, hasPermission, listProductsToTrack } from '@floral/core';
import { INVENTORY_LIMITS, inventoryStartFiltersSchema } from '@floral/domain';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListResults } from '@/components/common/list/list-results';
import { Forbidden } from '@/components/forbidden';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { StartTrackingForm, type StartRowView } from '@/components/inventory/start-tracking-form';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { startInventoryAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory.start');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * "Elegir productos" (ADR-060): i prodotti fisici del catalogo che oggi non si controllano; si
 * scrive quanti ce ne sono e, se si vuole, quando avvisare. Solo proprietario e manager.
 */
export default async function StartInventoryPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory/start'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:write')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const tc = await getTranslations('catalog');
  const routes = tenantRoutes(ctx.tenantSlug);
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.inventory.list()}>
        <ArrowLeft aria-hidden="true" />
        {t('start.back')}
      </Link>
    </Button>
  );
  if (!(await getEntitlements(ctx)).inventory) {
    return (
      <div className="space-y-6">
        {back}
        <InventoryUpsell ctx={ctx} />
      </div>
    );
  }

  const raw = await searchParams;
  const query = { q: single(raw.q) };
  const filters = inventoryStartFiltersSchema.parse(query);
  const products = await listProductsToTrack(ctx, query);
  const rows: StartRowView[] = products.map((product) => ({
    catalogItemId: product.catalogItemId,
    name: product.name,
    detail: product.variety
      ? `${tc(`types.${product.type}`)} · ${product.variety}`
      : tc(`types.${product.type}`),
    unitLabel: t(`unitName.${product.saleUnit}`),
    previous:
      product.previousOnHand === null
        ? null
        : t('start.previous', {
            quantity: t('quantity', { unit: product.saleUnit, count: product.previousOnHand }),
          }),
    photoSrc: product.coverPhotoId ? routes.catalog.photo(product.coverPhotoId, 'thumb') : null,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader title={t('start.title')} description={t('start.subtitle')} />
      </div>
      <FilterBar
        action={routes.inventory.start()}
        search={{ defaultValue: filters.q, placeholder: t('start.searchPlaceholder') }}
        hasFilters={Boolean(filters.q)}
        className="sm:grid-cols-[minmax(0,1fr)_auto]"
      />
      <ListResults
        isEmpty={rows.length === 0}
        hasFilters={Boolean(filters.q)}
        noResults={{ title: t('start.noResultsTitle'), body: t('start.noResultsBody') }}
        empty={
          <EmptyState icon={<Boxes />} title={t('start.emptyTitle')} body={t('start.emptyBody')} />
        }
      >
        {rows.length >= INVENTORY_LIMITS.startRows ? (
          <p className="text-sm text-muted-foreground">
            {t('start.limitNote', { max: INVENTORY_LIMITS.startRows })}
          </p>
        ) : null}
        <StartTrackingForm action={startInventoryAction.bind(null, ctx.tenantSlug)} rows={rows} />
      </ListResults>
    </div>
  );
}
