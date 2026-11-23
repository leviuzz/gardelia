import 'server-only';
import { Boxes } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import {
  getBouquetInventory,
  hasPermission,
  type CatalogItemDto,
  type TenantContext,
} from '@floral/core';
import { costDifferenceBps } from '@floral/domain';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/format';
import { recordBouquetsMadeAction } from '@/app/app/[tenantSlug]/inventory/actions';
import { BouquetsMadeDialog } from './bouquet-forms';

/** "+12 %" / "−8 %": differenza fra costo reale e previsto. */
function signedPercent(bps: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(bps / 10_000);
}

/**
 * Riquadro "Inventario" nella scheda di un ramo del catálogo (ADR-063): quanti ramos si possono
 * fare con la merce disponibile, il costo dei materiali previsto e reale (chi vede i costi) e
 * "Registrar ramos hechos". Non compare senza il piano né per un ramo senza ricetta.
 */
export async function BouquetInventoryBox({
  ctx,
  item,
}: {
  readonly ctx: TenantContext;
  readonly item: CatalogItemDto;
}) {
  if (!hasPermission(ctx, 'inventory:read')) return null;
  const stock = await getBouquetInventory(ctx, item.id);
  if (!stock) return null;
  const t = await getTranslations('inventory');
  const cost = stock.cost;
  const difference =
    cost && cost.realMinor !== null && cost.expectedMinor !== null
      ? costDifferenceBps(cost.realMinor, cost.expectedMinor)
      : null;
  const amount = (count: number, line: (typeof stock.lines)[number]) =>
    t('quantity', { unit: line.saleUnit, count });

  return (
    <Card>
      <CardContent className="space-y-4 p-4 text-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground [&_svg]:size-4">
              <Boxes aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{t('bouquet.title')}</p>
              <p>
                {stock.possible === null
                  ? t('bouquet.noneTracked')
                  : t('bouquet.possible', { count: stock.possible })}
              </p>
            </div>
          </div>
          {stock.canRecord && stock.possible !== null ? (
            <BouquetsMadeDialog
              action={recordBouquetsMadeAction.bind(null, ctx.tenantSlug, stock.bouquetId)}
              bouquetName={stock.name}
              ingredients={stock.lines.map((line) => ({
                name: line.name,
                saleUnit: line.saleUnit,
                quantity: line.quantity,
                available: line.available,
              }))}
            />
          ) : null}
        </div>

        <ul className="divide-y rounded-xl border">
          {stock.lines.map((line) => (
            <li
              key={line.catalogItemId}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2"
            >
              <span className="min-w-0 font-medium">
                {line.variety ? `${line.name} · ${line.variety}` : line.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('bouquet.perBouquet', { quantity: amount(line.quantity, line) })}
                {' · '}
                {line.available === null
                  ? t('bouquet.notTracked')
                  : t('bouquet.available', { quantity: amount(line.available, line) })}
              </span>
            </li>
          ))}
        </ul>

        {cost ? (
          <div className="space-y-1">
            <p className="font-medium">{t('bouquet.costTitle')}</p>
            {cost.expectedMinor === null || cost.realMinor === null ? (
              <p className="text-muted-foreground">{t('bouquet.costUnknown')}</p>
            ) : (
              <>
                <p>
                  {t('bouquet.expected', { amount: money(cost.expectedMinor, stock.currency) })}
                </p>
                <p>
                  {t('bouquet.real', { amount: money(cost.realMinor, stock.currency) })}
                  {difference !== null && difference !== 0
                    ? ` · ${t('bouquet.diff', { diff: signedPercent(difference, ctx.locale) })}`
                    : ''}
                </p>
              </>
            )}
            {cost.catalogFallbackLines > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('bouquet.fallback', { count: cost.catalogFallbackLines })}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
