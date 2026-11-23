import { ArrowLeft, Undo2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  getEntitlements,
  getPurchase,
  hasPermission,
  type PurchaseDetailDto,
  type TenantContext,
} from '@floral/core';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { Forbidden } from '@/components/forbidden';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { reverseInventoryEntryAction } from '../../actions';

async function loadPurchase(ctx: TenantContext, entryId: string): Promise<PurchaseDetailDto> {
  try {
    return await getPurchase(ctx, entryId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory.purchases');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Scheda di una compra (ADR-061): righe con quantità e costi, e "Anular compra". */
export default async function PurchasePage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory/purchases/[entryId]'>) {
  const { tenantSlug, entryId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:write')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.inventory.purchases()}>
        <ArrowLeft aria-hidden="true" />
        {t('purchases.detail.back')}
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
  const purchase = await loadPurchase(ctx, entryId);
  const created = single((await searchParams).created) === '1';
  const date = format.dateTime(new Date(`${purchase.purchasedOn}T12:00:00Z`), {
    dateStyle: 'long',
    timeZone: 'UTC',
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader
          title={t('purchases.detail.title', { date })}
          description={
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <span>
                {t('purchases.detail.supplier')}:{' '}
                {purchase.supplierName ?? t('purchases.noSupplier')}
              </span>
              {purchase.reference ? (
                <span>
                  {t('purchases.detail.reference')}: {purchase.reference}
                </span>
              ) : null}
              {purchase.actorName ? (
                <span>{t('purchases.detail.recordedBy', { name: purchase.actorName })}</span>
              ) : null}
            </span>
          }
          actions={
            purchase.canReverse ? (
              <ConfirmActionDialog
                action={reverseInventoryEntryAction.bind(null, ctx.tenantSlug, purchase.entryId)}
                trigger={
                  <Button variant="outline">
                    <Undo2 aria-hidden="true" />
                    {t('purchases.detail.reverse')}
                  </Button>
                }
                title={t('purchases.detail.reverseTitle')}
                description={t('purchases.detail.reverseBody')}
                confirmLabel={t('purchases.detail.reverseConfirm')}
              />
            ) : null
          }
        />
      </div>

      {created && !purchase.reversed ? (
        <Alert variant="success">
          <AlertDescription>{t('purchases.detail.created')}</AlertDescription>
        </Alert>
      ) : null}
      {purchase.reversed ? (
        <Alert variant="warning">
          <AlertDescription>{t('purchases.detail.reversedNotice')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="px-4 py-3">
                {t('purchases.detail.product')}
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                {t('purchases.detail.quantity')}
              </th>
              <th scope="col" className="hidden px-4 py-3 text-right sm:table-cell">
                {t('purchases.detail.unitCost')}
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                {t('purchases.detail.total')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {purchase.purchaseLines.map((line) => (
              <tr key={line.inventoryItemId}>
                <td className="px-4 py-3">
                  <Link
                    href={routes.inventory.item(line.inventoryItemId)}
                    className="font-medium hover:underline"
                  >
                    {line.variety ? `${line.name} · ${line.variety}` : line.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {t('quantity', { unit: line.saleUnit, count: line.quantity })}
                </td>
                <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                  {line.unitCostMinor === null ? '—' : money(line.unitCostMinor, purchase.currency)}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {money(line.totalCostMinor, purchase.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/20">
            <tr>
              <th scope="row" colSpan={2} className="px-4 py-3 text-left sm:hidden">
                {t('purchases.detail.purchaseTotal')}
              </th>
              <th scope="row" colSpan={3} className="hidden px-4 py-3 text-left sm:table-cell">
                {t('purchases.detail.purchaseTotal')}
              </th>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {money(purchase.totalMinor, purchase.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
