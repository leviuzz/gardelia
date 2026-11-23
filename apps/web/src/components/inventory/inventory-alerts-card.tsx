import 'server-only';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getInventoryAlerts, hasPermission, type TenantContext } from '@floral/core';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Riquadro "Inventario" del pannello (ADR-063): cosa sta finendo o è finito (sul disponibile) e
 * gli apartados che scadono o sono già vencidos, con i link alle pagine giuste. Non compare
 * senza il piano né per chi non vede l'inventario.
 */
export async function InventoryAlertsCard({ ctx }: { readonly ctx: TenantContext }) {
  if (!hasPermission(ctx, 'inventory:read')) return null;
  const alerts = await getInventoryAlerts(ctx);
  if (!alerts) return null;
  const t = await getTranslations('inventory');
  const routes = tenantRoutes(ctx.tenantSlug);
  const allGood =
    alerts.low === 0 &&
    alerts.out === 0 &&
    alerts.reservationsDueSoon === 0 &&
    alerts.reservationsExpired === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle>{t('alerts.title')}</CardTitle>
        <Link
          href={routes.inventory.list()}
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {t('alerts.open')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {allGood ? <p className="text-muted-foreground">{t('alerts.allGood')}</p> : null}
        {alerts.out > 0 || alerts.low > 0 ? (
          <div className="flex flex-wrap gap-2">
            {alerts.out > 0 ? (
              <Link href={routes.inventory.list({ status: 'OUT' })}>
                <Badge variant="danger">{t('alerts.out', { count: alerts.out })}</Badge>
              </Link>
            ) : null}
            {alerts.low > 0 ? (
              <Link href={routes.inventory.list({ status: 'LOW' })}>
                <Badge variant="warning">{t('alerts.low', { count: alerts.low })}</Badge>
              </Link>
            ) : null}
          </div>
        ) : null}
        {alerts.items.length > 0 ? (
          <ul className="divide-y">
            {alerts.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={routes.inventory.item(item.id)}
                  className="flex items-center justify-between gap-3 py-2 hover:underline"
                >
                  <span className="min-w-0 truncate">
                    {item.variety ? `${item.name} · ${item.variety}` : item.name}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-medium',
                      item.status === 'OUT'
                        ? 'text-[oklch(0.45_0.17_27)]'
                        : 'text-[oklch(0.42_0.1_65)]',
                    )}
                  >
                    {item.status === 'OUT'
                      ? t('alerts.gone')
                      : t('alerts.left', {
                          quantity: t('quantity', { unit: item.saleUnit, count: item.available }),
                        })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {alerts.reservationsDueSoon > 0 ? (
          <Link href={routes.inventory.reservations()} className="block hover:underline">
            {t('alerts.dueSoon', { count: alerts.reservationsDueSoon })}
          </Link>
        ) : null}
        {alerts.reservationsExpired > 0 ? (
          <Link
            href={routes.inventory.reservations({ view: 'expired' })}
            className="block text-[oklch(0.45_0.17_27)] hover:underline"
          >
            {t('alerts.expired', { count: alerts.reservationsExpired })}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
