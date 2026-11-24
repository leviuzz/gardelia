import 'server-only';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCareChargesOverview, type TenantContext } from '@floral/core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';

/**
 * Riquadro "Cobros de Floral Care" del pannello (ADR-082): quanto c'è da cobrar e quanto è
 * vencido, con i link a "Cobros", e gli incassi alla visita "por registrar" (blocco 3b). Solo per
 * chi gestisce i soldi e se la fioreria ha già cargos o incassi da registrare.
 */
export async function CareChargesCard({ ctx }: { readonly ctx: TenantContext }) {
  const overview = await getCareChargesOverview(ctx);
  if (!overview) return null;
  const t = await getTranslations('care.chargesCard');
  const routes = tenantRoutes(ctx.tenantSlug);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle>{t('title')}</CardTitle>
        <Link
          href={routes.subscriptions.charges()}
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {t('link')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {overview.pendingCollections > 0 ? (
          <Link
            href={routes.subscriptions.charges()}
            className="block rounded-xl bg-warning-soft px-3 py-2 font-medium text-[oklch(0.42_0.1_65)] hover:underline"
          >
            {t('pending', { count: overview.pendingCollections })}
          </Link>
        ) : null}
        {overview.openCount === 0 ? (
          <p className="text-muted-foreground">{t('allPaid')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Link
              href={routes.subscriptions.charges()}
              className="rounded-xl border p-3 hover:bg-muted/40"
            >
              <p className="text-xs text-muted-foreground">{t('open')}</p>
              <p className="text-lg font-semibold tabular-nums">
                {money(overview.openMinor, overview.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('detail', { count: overview.openCount })}
              </p>
            </Link>
            <Link
              href={routes.subscriptions.charges({ view: 'overdue' })}
              className="rounded-xl border p-3 hover:bg-muted/40"
            >
              <p className="text-xs text-muted-foreground">{t('overdue')}</p>
              <p
                className={
                  overview.overdueCount > 0
                    ? 'text-lg font-semibold text-[oklch(0.45_0.17_27)] tabular-nums'
                    : 'text-lg font-semibold tabular-nums'
                }
              >
                {money(overview.overdueMinor, overview.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('detail', { count: overview.overdueCount })}
              </p>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
