import { History } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getEntitlements, hasPermission, listInventoryMovements } from '@floral/core';
import { INVENTORY_ENTRY_KINDS, inventoryMovementFiltersSchema } from '@floral/domain';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { Forbidden } from '@/components/forbidden';
import { InventoryTabs } from '@/components/inventory/inventory-ui';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { MovementList } from '@/components/inventory/movement-list';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { reverseInventoryEntryAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory.movements');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Tutti i movimenti dell'inventario (ADR-060), filtrabili per tipo. */
export default async function InventoryMovementsPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory/movements'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:read')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const tc = await getTranslations('common');
  const routes = tenantRoutes(ctx.tenantSlug);
  const header = <PageHeader title={t('title')} description={t('movements.subtitle')} />;

  if (!(await getEntitlements(ctx)).inventory) {
    return (
      <div className="space-y-6">
        {header}
        <InventoryUpsell ctx={ctx} />
      </div>
    );
  }

  const raw = await searchParams;
  const query = { kind: single(raw.kind), page: single(raw.page) };
  const filters = inventoryMovementFiltersSchema.parse(query);
  const result = await listInventoryMovements(ctx, query);
  const hasFilters = Boolean(filters.kind);
  const slug = ctx.tenantSlug;

  return (
    <div className="space-y-6">
      {header}
      <InventoryTabs
        current="movements"
        routes={routes}
        showPurchases={hasPermission(ctx, 'inventory:write')}
      />
      <form
        method="get"
        action={routes.inventory.movements()}
        className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row"
      >
        <NativeSelect
          name="kind"
          defaultValue={filters.kind ?? ''}
          aria-label={t('movements.allKinds')}
          className="sm:max-w-xs"
        >
          <option value="">{t('movements.allKinds')}</option>
          {INVENTORY_ENTRY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`kinds.${kind}`)}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary">
          {tc('filter')}
        </Button>
      </form>

      <ListResults
        isEmpty={result.movements.length === 0}
        hasFilters={hasFilters}
        noResults={{
          title: t('movements.noResultsTitle'),
          body: t('movements.noResultsBody'),
          icon: <History />,
        }}
        empty={
          <EmptyState
            icon={<History />}
            title={t('movements.emptyTitle')}
            body={t('movements.emptyBody')}
          />
        }
        count={t('movements.results', { count: result.total })}
      >
        <MovementList
          movements={result.movements}
          timezone={ctx.timezone}
          itemHref={(inventoryItemId) => routes.inventory.item(inventoryItemId)}
          reverseAction={(entryId) => reverseInventoryEntryAction.bind(null, slug, entryId)}
        />
        <ListPagination
          page={result.page}
          pageCount={result.pageCount}
          href={(page) =>
            routes.inventory.movements({
              kind: filters.kind,
              page: page > 1 ? page : undefined,
            })
          }
        />
      </ListResults>
    </div>
  );
}
