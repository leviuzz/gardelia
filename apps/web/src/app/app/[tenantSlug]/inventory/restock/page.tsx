import { MessageCircle, PackageCheck, ShoppingBasket } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getEntitlements, getRestockList, hasPermission } from '@floral/core';
import { getMarket, whatsappLink } from '@floral/domain';
import { Forbidden } from '@/components/forbidden';
import { InventoryTabs } from '@/components/inventory/inventory-ui';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory.restock');
  return { title: t('title') };
}

/**
 * "Por pedir" (ADR-081): i prodotti agotados o por agotarse raggruppati per proveedor habitual. Per
 * ognuno il messaggio di WhatsApp già scritto (nella lingua del mercato, va a un proveedor locale)
 * e "Registrar compra" con proveedor e prodotti già scelti. Le quantità le decide la fioreria.
 */
export default async function RestockPage({
  params,
}: PageProps<'/app/[tenantSlug]/inventory/restock'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:write')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const routes = tenantRoutes(ctx.tenantSlug);
  const header = <PageHeader title={t('restock.title')} description={t('restock.subtitle')} />;
  if (!(await getEntitlements(ctx)).inventory) {
    return (
      <div className="space-y-6">
        {header}
        <InventoryUpsell ctx={ctx} />
      </div>
    );
  }

  const groups = (await getRestockList(ctx)) ?? [];
  const tShop = await getTranslations({ locale: getMarket(ctx.country).defaultLocale });
  const productLabel = (item: { name: string; variety: string | null }) =>
    item.variety ? `${item.name} · ${item.variety}` : item.name;

  return (
    <div className="space-y-6">
      {header}
      <InventoryTabs current="restock" routes={routes} showPurchases={true} />
      {groups.length === 0 ? (
        <EmptyState icon={<PackageCheck />} title={t('restock.empty')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((group) => {
            const message = group.supplier
              ? [
                  tShop('inventory.restock.message.greeting', {
                    supplier: group.supplier.name,
                    shop: ctx.tenantName,
                  }),
                  ...group.items.map((item) =>
                    tShop('inventory.restock.message.line', { product: productLabel(item) }),
                  ),
                  tShop('inventory.restock.message.closing'),
                ].join('\n')
              : null;
            const purchaseHref = routes.inventory.newPurchase({
              proveedor: group.supplier?.id,
              productos: group.items.map((item) => item.inventoryItemId).join(','),
            });
            return (
              <Card key={group.supplier?.id ?? 'none'} data-testid="restock-group">
                <CardHeader>
                  <CardTitle>{group.supplier?.name ?? t('restock.noSupplier')}</CardTitle>
                  <CardDescription>
                    {group.supplier
                      ? t('restock.count', { count: group.items.length })
                      : t('restock.noSupplierHint')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="divide-y text-sm">
                    {group.items.map((item) => (
                      <li
                        key={item.inventoryItemId}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <Link
                          href={routes.inventory.item(item.inventoryItemId)}
                          className="min-w-0 break-words hover:underline"
                        >
                          {productLabel(item)}
                        </Link>
                        <span
                          className={cn(
                            'shrink-0 text-right text-xs font-medium',
                            item.status === 'OUT'
                              ? 'text-[oklch(0.45_0.17_27)]'
                              : 'text-[oklch(0.42_0.1_65)]',
                          )}
                        >
                          {item.status === 'OUT'
                            ? t('alerts.gone')
                            : t('alerts.left', {
                                quantity: t('quantity', {
                                  unit: item.saleUnit,
                                  count: item.available,
                                }),
                              })}
                          {item.minQuantity !== null ? (
                            <span className="block font-normal text-muted-foreground">
                              {t('restock.minimum', {
                                quantity: t('quantity', {
                                  unit: item.saleUnit,
                                  count: item.minQuantity,
                                }),
                              })}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {group.supplier?.phone && message ? (
                      <Button asChild>
                        <a
                          href={whatsappLink(group.supplier.phone, message)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MessageCircle aria-hidden="true" />
                          {t('restock.whatsapp')}
                        </a>
                      </Button>
                    ) : null}
                    <Button asChild variant="outline">
                      <Link href={purchaseHref}>
                        <ShoppingBasket aria-hidden="true" />
                        {t('restock.record')}
                      </Link>
                    </Button>
                  </div>
                  {group.supplier && !group.supplier.phone ? (
                    <p className="text-xs text-muted-foreground">
                      {t('restock.noPhone')}{' '}
                      <Link href={routes.inventory.suppliers()} className="underline">
                        {t('restock.suppliersLink')}
                      </Link>
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
