import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Info,
  Sprout,
  Trash2,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getSalesReport, hasPermission } from '@floral/core';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { SalesChart } from './sales-chart';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reports');
  return { title: t('title') };
}

/**
 * Reportes [BI-01] (ADR-080): come è andato il mese (o l'anno) — vendite e confronto, cobrado,
 * prodotti più venduti, margine solo dove ci sono i costi, mermas, Floral Care e i prossimi giorni.
 * Solo chi gestisce.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/reports'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'reports:read')) return <Forbidden />;
  const query = await searchParams;
  const report = await getSalesReport(ctx, { mes: query.mes, ano: query.ano });
  const t = await getTranslations('reports');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const { period } = report;
  const fmt = (minor: number) => money(minor, report.currency);

  const monthName = (param: string, style: 'long' | 'short') => {
    const [year, month] = param.split('-').map(Number);
    return format.dateTime(new Date(Date.UTC(year!, month! - 1, 15)), {
      month: style,
      ...(style === 'long' ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });
  };
  const periodLabel = period.kind === 'year' ? period.param : monthName(period.param, 'long');
  const previousLabel =
    period.kind === 'year' ? period.previousParam : monthName(period.previousParam, 'long');
  const linkTo = (param: string) =>
    period.kind === 'year' ? routes.reports({ ano: param }) : routes.reports({ mes: param });
  const dayLabel = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });

  const bars = report.chart.map((bar) => {
    const day = period.kind === 'month' ? Number(bar.key.slice(8, 10)) : 0;
    return {
      key: bar.key,
      tick:
        period.kind === 'year'
          ? monthName(bar.key, 'short')
          : day === 1 || day % 5 === 0
            ? String(day)
            : '',
      label: period.kind === 'year' ? monthName(bar.key, 'long') : dayLabel(bar.key),
      totalMinor: bar.totalMinor,
      amount: fmt(bar.totalMinor),
    };
  });
  const { sales, margin } = report;
  const empty = sales.orders === 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-1" aria-label={t('periodNav')}>
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label={t('previous', { period: previousLabel })}
          >
            <Link href={linkTo(period.previousParam)}>
              <ChevronLeft />
            </Link>
          </Button>
          <h2 className="min-w-40 text-center font-display text-lg font-semibold first-letter:uppercase">
            {periodLabel}
          </h2>
          {period.nextParam ? (
            <Button asChild variant="ghost" size="icon" aria-label={t('next')}>
              <Link href={linkTo(period.nextParam)}>
                <ChevronRight />
              </Link>
            </Button>
          ) : (
            <span className="size-10" aria-hidden="true" />
          )}
        </nav>
        <div className="flex rounded-xl border p-1 text-sm" role="group" aria-label={t('viewBy')}>
          <Link
            href={routes.reports()}
            aria-current={period.kind === 'month' ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-1.5',
              period.kind === 'month' ? 'bg-secondary font-medium' : 'text-muted-foreground',
            )}
          >
            {t('month')}
          </Link>
          <Link
            href={routes.reports({ ano: period.from.year.toString() })}
            aria-current={period.kind === 'year' ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-1.5',
              period.kind === 'year' ? 'bg-secondary font-medium' : 'text-muted-foreground',
            )}
          >
            {t('year')}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="report-kpis">
        <Kpi
          label={t('kpi.sales')}
          value={fmt(sales.totalMinor)}
          change={sales.totalChange}
          changeLabel={t('vsPrevious', { period: previousLabel })}
          hint={
            report.toDeliver.orders > 0
              ? t('kpi.toDeliver', {
                  amount: fmt(report.toDeliver.totalMinor),
                  count: report.toDeliver.orders,
                })
              : null
          }
        />
        <Kpi
          label={t('kpi.orders')}
          value={format.number(sales.orders)}
          change={sales.ordersChange}
          changeLabel={t('vsPrevious', { period: previousLabel })}
        />
        <Kpi
          label={t('kpi.average')}
          value={sales.averageMinor === null ? '—' : fmt(sales.averageMinor)}
        />
        <Kpi
          label={t('kpi.collected')}
          value={fmt(report.collectedMinor)}
          hint={t('kpi.collectedHint')}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{period.kind === 'year' ? t('chart.byMonth') : t('chart.byDay')}</CardTitle>
          <CardDescription>{t('chart.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {empty ? (
            <p
              className="py-8 text-center text-sm text-muted-foreground"
              data-testid="report-empty"
            >
              {t('empty')}
            </p>
          ) : (
            <SalesChart
              bars={bars}
              caption={t('chart.caption', { period: periodLabel })}
              columnLabel={period.kind === 'year' ? t('chart.monthColumn') : t('chart.dayColumn')}
              valueLabel={t('kpi.sales')}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('top.title')}</CardTitle>
            <CardDescription>{t('top.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            {report.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('top.empty')}</p>
            ) : (
              <ol className="divide-y" data-testid="report-top-products">
                {report.topProducts.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-baseline justify-between gap-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {item.key === 'builder' ? t('top.builder') : item.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('top.quantity', { count: item.quantity })}
                      </span>
                    </span>
                    <span className="tabular-nums">{fmt(item.revenueMinor)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card data-testid="report-margin">
          <CardHeader>
            <CardTitle>{t('margin.title')}</CardTitle>
            <CardDescription>{t('margin.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {margin.marginMinor === null ? (
              <p className="text-muted-foreground">
                {empty ? t('margin.noSales') : t('margin.noCosts')}{' '}
                {empty ? null : (
                  <Link
                    href={routes.catalog.list()}
                    className="font-medium text-primary hover:underline"
                  >
                    {t('margin.toCatalog')}
                  </Link>
                )}
              </p>
            ) : (
              <>
                <p className="font-display text-3xl font-semibold tabular-nums">
                  {fmt(margin.marginMinor)}
                  {margin.marginPercent !== null ? (
                    <span className="ml-2 text-base font-normal text-muted-foreground">
                      {t('margin.percent', { percent: margin.marginPercent })}
                    </span>
                  ) : null}
                </p>
                <p className={cn(margin.coveragePercent < 100 && 'text-[oklch(0.42_0.1_65)]')}>
                  {margin.coveragePercent < 100
                    ? t('margin.partial', {
                        percent: margin.coveragePercent,
                        covered: fmt(margin.coveredSalesMinor),
                        total: fmt(margin.productSalesMinor),
                        count: margin.linesWithoutCost,
                      })
                    : t('margin.complete', { cost: fmt(margin.costMinor) })}
                </p>
                <p className="text-xs text-muted-foreground">{t('margin.note')}</p>
              </>
            )}
          </CardContent>
        </Card>

        {report.waste ? (
          <Card data-testid="report-waste">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="size-4 text-muted-foreground" aria-hidden="true" />
                {t('waste.title')}
              </CardTitle>
              <CardDescription>{t('waste.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {report.waste.items.length === 0 ? (
                <p className="text-muted-foreground">{t('waste.none')}</p>
              ) : (
                <>
                  <p className="font-display text-2xl font-semibold tabular-nums">
                    {fmt(report.waste.costMinor)}
                  </p>
                  <ul className="divide-y">
                    {report.waste.items.map((item) => (
                      <li key={item.name} className="flex justify-between gap-3 py-1.5">
                        <span className="min-w-0 truncate">
                          {item.name} · {format.number(item.quantity)}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {item.costMinor === null ? t('waste.noCost') : fmt(item.costMinor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {report.waste.withoutCost > 0 ? (
                    <p className="text-xs text-muted-foreground">{t('waste.partial')}</p>
                  ) : null}
                </>
              )}
              <Link
                href={routes.inventory.list()}
                className="font-medium text-primary hover:underline"
              >
                {t('waste.toInventory')}
              </Link>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
              {t('upcoming.title')}
            </CardTitle>
            <CardDescription>
              {t('upcoming.subtitle', {
                from: dayLabel(report.upcoming.from),
                to: dayLabel(report.upcoming.to),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm" data-testid="report-upcoming">
            <p>
              <Link
                href={routes.orders.calendar()}
                className="font-medium text-primary hover:underline"
              >
                {t('upcoming.orders', { count: report.upcoming.orders })}
              </Link>
            </p>
            {report.upcoming.visits !== null ? (
              <p>
                <Link
                  href={routes.agenda.day()}
                  className="font-medium text-primary hover:underline"
                >
                  {t('upcoming.visits', { count: report.upcoming.visits })}
                </Link>
              </p>
            ) : null}
            {report.recurring ? (
              <p className="flex items-start gap-2 border-t pt-3 text-muted-foreground">
                <Sprout className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {report.recurring.contracts === 0
                    ? t('recurring.none')
                    : report.recurring.minMinor === report.recurring.maxMinor
                      ? t('recurring.exact', {
                          amount: fmt(report.recurring.minMinor),
                          count: report.recurring.contracts,
                        })
                      : t('recurring.range', {
                          min: fmt(report.recurring.minMinor),
                          max: fmt(report.recurring.maxMinor),
                          count: report.recurring.contracts,
                        })}
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {t('footnote')}
      </p>
    </div>
  );
}

function Kpi({
  label,
  value,
  change,
  changeLabel,
  hint,
}: {
  label: string;
  value: string;
  change?: number | null;
  changeLabel?: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {change !== undefined && change !== null ? (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant={change >= 0 ? 'success' : 'warning'} className="gap-0.5">
            {change >= 0 ? (
              <ArrowUpRight className="size-3" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="size-3" aria-hidden="true" />
            )}
            {change >= 0 ? '+' : ''}
            {change}%
          </Badge>
          {changeLabel}
        </p>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
