import { ArrowLeft, Boxes } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  getEntitlements,
  hasPermission,
  listSuppliers,
  listTrackedProductOptions,
} from '@floral/core';
import { isCurrencyCode, todayInTimeZone } from '@floral/domain';
import { Forbidden } from '@/components/forbidden';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { PurchaseForm } from '@/components/inventory/purchase-form';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { recordPurchaseAction } from '../../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory.purchases.form');
  return { title: t('title') };
}

/** "Nueva compra" (ADR-061): i prodotti controllati, i proveedores attivi e la data di oggi. */
export default async function NewPurchasePage({
  params,
}: PageProps<'/app/[tenantSlug]/inventory/purchases/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:write')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const tc = await getTranslations('catalog');
  const routes = tenantRoutes(ctx.tenantSlug);
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.inventory.purchases()}>
        <ArrowLeft aria-hidden="true" />
        {t('purchases.form.back')}
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

  const [products, suppliers] = [await listTrackedProductOptions(ctx), await listSuppliers(ctx)];
  const today = todayInTimeZone(ctx.timezone);
  const todayIso = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
  const currency = isCurrencyCode(ctx.currency) ? ctx.currency : 'MXN';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader title={t('purchases.form.title')} description={t('purchases.form.subtitle')} />
      </div>
      {products.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title={t('purchases.form.noProducts')}
          action={
            <Button asChild>
              <Link href={routes.inventory.start()}>{t('list.choose')}</Link>
            </Button>
          }
        />
      ) : (
        <PurchaseForm
          action={recordPurchaseAction.bind(null, ctx.tenantSlug)}
          products={products.map((product) => ({
            id: product.inventoryItemId,
            label: `${product.variety ? `${product.name} · ${product.variety}` : product.name} (${t(
              `unitName.${product.saleUnit}`,
            )})`,
            groupLabel: tc(`types.${product.type}`),
            unitLabel: tc(`units.${product.saleUnit}`),
          }))}
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
          today={todayIso}
          currency={currency}
          locale="es-MX"
        />
      )}
    </div>
  );
}
