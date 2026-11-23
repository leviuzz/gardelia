import 'server-only';
import { Boxes } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  getCatalogItemInventory,
  hasPermission,
  type CatalogItemDto,
  type TenantContext,
} from '@floral/core';
import { isInventoryItemType } from '@floral/domain';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { StockStatusBadge } from './inventory-ui';

/**
 * Riquadro "Inventario" nella scheda di un prodotto del catalogo (ADR-060): quanto ce n'è, o il
 * link per cominciare a controllarlo. Non compare senza il piano, per i tipi senza giacenza
 * (ramos, servizi) né per chi non vede l'inventario.
 */
export async function CatalogInventoryBox({
  ctx,
  item,
}: {
  readonly ctx: TenantContext;
  readonly item: CatalogItemDto;
}) {
  if (!isInventoryItemType(item.type) || !hasPermission(ctx, 'inventory:read')) return null;
  const inventory = await getCatalogItemInventory(ctx, item.id);
  if (!inventory) return null;
  const t = await getTranslations('inventory');
  const routes = tenantRoutes(ctx.tenantSlug);
  const stock = inventory.item;
  const tracked = stock?.tracking === 'ACTIVE';
  const quantity = (count: number) => t('quantity', { unit: item.saleUnit, count });

  let action: React.ReactNode = null;
  if (stock) {
    action = (
      <Button asChild variant="outline" size="sm">
        <Link href={routes.inventory.item(stock.id)}>{t('catalogBox.open')}</Link>
      </Button>
    );
  } else if (inventory.canWrite && item.status === 'ACTIVE') {
    action = (
      <Button asChild variant="outline" size="sm">
        <Link href={routes.inventory.start({ q: item.name })}>{t('catalogBox.start')}</Link>
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground [&_svg]:size-4">
            <Boxes aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium">{t('catalogBox.title')}</p>
            {stock && tracked ? (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <span>{t('catalogBox.tracked', { quantity: quantity(stock.onHand) })}</span>
                  <StockStatusBadge status={stock.status} />
                </p>
                {stock.reserved > 0 ? (
                  <p className="text-muted-foreground">
                    {t('catalogBox.reserved', {
                      quantity: quantity(stock.reserved),
                      available: quantity(stock.available),
                    })}
                  </p>
                ) : null}
                {stock.minQuantity !== null ? (
                  <p className="text-muted-foreground">
                    {t('catalogBox.minimum', { quantity: quantity(stock.minQuantity) })}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">
                {stock ? t('catalogBox.archived') : t('catalogBox.untracked')}
              </p>
            )}
          </div>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
