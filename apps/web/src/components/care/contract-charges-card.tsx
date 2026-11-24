import 'server-only';
import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { listContractCharges, type TenantContext } from '@floral/core';
import { ChargeStatusBadge } from '@/components/care/charge-ui';
import { CareAdjustmentDialog, RemoveAdjustmentButton } from '@/components/care/collection-forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import {
  addCareChargeAdjustmentAction,
  removeCareChargeAdjustmentAction,
} from '@/app/app/[tenantSlug]/subscriptions/charges/actions';

/**
 * Card "Cargos" della scheda del contratto (ADR-082): gli ultimi sei, con lo stato e quanto manca,
 * e il link all'estado de cuenta del cliente (tutte le sedi). Sotto, gli "Ajustes para el próximo
 * cargo" in attesa (blocco 3b), da aggiungere o togliere. Solo per chi gestisce i soldi.
 */
export async function ContractChargesCard({
  ctx,
  subscriptionId,
  customerId,
}: {
  readonly ctx: TenantContext;
  readonly subscriptionId: string;
  readonly customerId: string;
}) {
  const [charges, t, format] = await Promise.all([
    listContractCharges(ctx, subscriptionId),
    getTranslations('care'),
    getFormatter(),
  ]);
  const routes = tenantRoutes(ctx.tenantSlug);
  const price = (minor: number) => money(minor, charges.currency);
  const signed = (minor: number) => (minor < 0 ? `−${price(-minor)}` : `+${price(minor)}`);
  const shortDay = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', timeZone: ctx.timezone });
  const month = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-5 text-primary" aria-hidden="true" />
          {t('contractCharges.title')}
        </CardTitle>
        <Button asChild size="sm" variant="outline">
          <Link href={routes.customers.statement(customerId)}>
            {t('contractCharges.statement')}
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {charges.items.length === 0 ? (
          <p className="text-muted-foreground">{t('contractCharges.empty')}</p>
        ) : (
          <>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="font-medium">
                {t('contractCharges.balance', { amount: price(charges.balanceMinor) })}
              </span>
              {charges.overdueCount > 0 ? (
                <span className="font-medium text-[oklch(0.45_0.17_27)]">
                  {t('contractCharges.overdue', { count: charges.overdueCount })}
                </span>
              ) : null}
            </p>
            <ul className="divide-y rounded-xl border">
              {charges.items.map((charge) => (
                <li key={charge.id}>
                  <Link
                    href={routes.subscriptions.charge(subscriptionId, charge.id)}
                    className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/30"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium tabular-nums">{charge.numberLabel}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {month(charge.period)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <ChargeStatusBadge status={charge.status} />
                      <span className="text-xs tabular-nums">{price(charge.totalMinor)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {charges.total > charges.items.length ? (
              <Link
                href={routes.customers.statement(customerId)}
                className="block text-xs text-muted-foreground hover:underline"
              >
                {t('contractCharges.more', { count: charges.total - charges.items.length })}
              </Link>
            ) : null}
          </>
        )}

        {charges.canAdjust || charges.adjustments.length > 0 ? (
          <section className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">{t('adjustments.title')}</h3>
              {charges.canAdjust ? (
                <CareAdjustmentDialog
                  action={addCareChargeAdjustmentAction.bind(null, ctx.tenantSlug, subscriptionId)}
                  currency={charges.currency}
                />
              ) : null}
            </div>
            {charges.adjustments.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('adjustments.hint')}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {charges.adjustments.map((adjustment) => (
                  <li
                    key={adjustment.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block break-words">{adjustment.reason}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('adjustments.by', {
                          name: adjustment.createdByName ?? '—',
                          date: shortDay(adjustment.createdAt),
                        })}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span
                        className={
                          adjustment.amountMinor < 0
                            ? 'font-medium text-[oklch(0.42_0.12_150)] tabular-nums'
                            : 'font-medium tabular-nums'
                        }
                      >
                        {signed(adjustment.amountMinor)}
                      </span>
                      <RemoveAdjustmentButton
                        action={removeCareChargeAdjustmentAction.bind(
                          null,
                          ctx.tenantSlug,
                          subscriptionId,
                          adjustment.id,
                        )}
                        label={t('adjustments.removeLabel', { reason: adjustment.reason })}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
