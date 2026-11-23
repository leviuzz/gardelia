import { ArrowLeft, Boxes } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getEntitlements, hasPermission, listTrackedProductOptions } from '@floral/core';
import { reservationExpiryRange, toIsoDate, todayInTimeZone } from '@floral/domain';
import { Forbidden } from '@/components/forbidden';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { ReservationForm } from '@/components/inventory/reservation-forms';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { createReservationAction } from '../../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory.reservations.form');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * "Nuevo apartado" (ADR-062): i prodotti controllati con quanto è disponibile oggi e le date
 * ammesse nel calendario della fioreria. `?item=` preseleziona un prodotto (dalla sua scheda).
 */
export default async function NewReservationPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory/reservations/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:write')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const tc = await getTranslations('catalog');
  const routes = tenantRoutes(ctx.tenantSlug);
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.inventory.reservations()}>
        <ArrowLeft aria-hidden="true" />
        {t('reservations.form.back')}
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

  const products = await listTrackedProductOptions(ctx);
  const range = reservationExpiryRange(todayInTimeZone(ctx.timezone));
  const requestedItem = single((await searchParams).item);
  const initialItemId = products.some((product) => product.inventoryItemId === requestedItem)
    ? requestedItem
    : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader
          title={t('reservations.form.title')}
          description={t('reservations.form.subtitle')}
        />
      </div>
      {products.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title={t('reservations.form.noProducts')}
          action={
            <Button asChild>
              <Link href={routes.inventory.start()}>{t('list.choose')}</Link>
            </Button>
          }
        />
      ) : (
        <ReservationForm
          action={createReservationAction.bind(null, ctx.tenantSlug)}
          products={products.map((product) => ({
            id: product.inventoryItemId,
            label: `${product.variety ? `${product.name} · ${product.variety}` : product.name} (${t(
              `unitName.${product.saleUnit}`,
            )})`,
            groupLabel: tc(`types.${product.type}`),
            saleUnit: product.saleUnit,
            available: product.available,
          }))}
          expiry={{
            min: toIsoDate(range.min),
            max: toIsoDate(range.max),
            suggested: toIsoDate(range.suggested),
          }}
          initialItemId={initialItemId}
        />
      )}
    </div>
  );
}
