import 'server-only';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getInventoryMonthSummary, hasPermission, type TenantContext } from '@floral/core';
import { costDifferenceBps } from '@floral/domain';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';

/** "+12 %" / "−8 %". */
function signedPercent(bps: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(bps / 10_000);
}

/**
 * Riepilogo del mese per chi vede i costi (ADR-063): compras, usato e mermas al costo reale, e
 * l'usato ai costi del catalogo (costo previsto e reale della fioreria). Mesi precedenti con i link.
 */
export async function InventoryMonthSummary({
  ctx,
  month,
}: {
  readonly ctx: TenantContext;
  readonly month: string | undefined;
}) {
  if (!hasPermission(ctx, 'catalog:costs:read')) return null;
  const summary = await getInventoryMonthSummary(ctx, month);
  const t = await getTranslations('inventory.monthSummary');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const monthName = format.dateTime(new Date(`${summary.monthStart}T12:00:00Z`), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const amount = (minor: number | null) =>
    minor === null ? t('unknown') : money(minor, summary.currency);
  const difference =
    summary.used.realMinor !== null && summary.used.expectedMinor !== null
      ? costDifferenceBps(summary.used.realMinor, summary.used.expectedMinor)
      : null;

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t('title', { month: monthName })}</h2>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href={routes.inventory.movements({ month: summary.previousMonth })}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {t('previous')}
          </Link>
          {summary.nextMonth ? (
            <Link
              href={routes.inventory.movements({ month: summary.nextMonth })}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {t('next')}
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </nav>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="space-y-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('purchases')}
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {money(summary.purchases.totalMinor, summary.currency)}
          </dd>
          <dd className="text-xs text-muted-foreground">
            {t('purchasesCount', { count: summary.purchases.entries })}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('used')}
          </dt>
          <dd className="text-lg font-semibold tabular-nums">{amount(summary.used.realMinor)}</dd>
          <dd className="text-xs text-muted-foreground">
            {t('usedExpected', { amount: amount(summary.used.expectedMinor) })}
            {difference !== null && difference !== 0
              ? ` (${signedPercent(difference, ctx.locale)})`
              : ''}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('waste')}
          </dt>
          <dd className="text-lg font-semibold tabular-nums">{amount(summary.waste.realMinor)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </section>
  );
}
