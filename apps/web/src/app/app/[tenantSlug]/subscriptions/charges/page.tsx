import { Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { hasPermission, listCareCharges } from '@floral/core';
import {
  CARE_CHARGE_VIEWS,
  addCarePeriods,
  carePeriodKey,
  carePeriodOf,
  todayInTimeZone,
} from '@floral/domain';
import { CareTabs, ChargeStatusBadge } from '@/components/care/charge-ui';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { NativeSelect } from '@/components/ui/input';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.charges');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Mesi proposti nel filtro: gli ultimi 12 e il prossimo. */
const MONTH_CHOICES = 13;

/**
 * "Cobros" di Floral Care (ADR-081): tutti i cargos della fioreria per stato (por cobrar,
 * vencidos, pagados, a favor del cliente) e per mese, con i totali. Per chi gestisce i soldi; non
 * chiede il piano (i contratti firmati si cobran lo stesso).
 */
export default async function CareChargesPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/subscriptions/charges'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:payments')) return <Forbidden />;
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const raw = await searchParams;
  const query = {
    view: single(raw.view),
    month: single(raw.month),
    q: single(raw.q),
    page: single(raw.page),
  };
  const result = await listCareCharges(ctx, query);
  const monthLabel = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const price = (minor: number) => money(minor, result.currency);
  const current = carePeriodOf(todayInTimeZone(ctx.timezone));
  const months = Array.from({ length: MONTH_CHOICES }, (_, index) =>
    carePeriodKey(addCarePeriods(current, 1 - index)),
  );
  if (result.month && !months.includes(result.month)) months.push(result.month);
  const hasFilters = Boolean(result.q || result.month);
  const viewQuery = (view: string) => ({
    view: view === 'open' ? undefined : view,
    month: result.month,
    q: result.q,
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t('care.charges.title')} description={t('care.charges.subtitle')} />
      <CareTabs routes={routes} current="charges" />

      <nav aria-label={t('care.charges.viewsLabel')} className="flex flex-wrap gap-2 text-sm">
        {CARE_CHARGE_VIEWS.map((view) => (
          <Link
            key={view}
            href={routes.subscriptions.charges(viewQuery(view))}
            aria-current={result.view === view ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 font-medium transition-colors hover:bg-muted',
              result.view === view && 'border-foreground/30 bg-muted',
              view === 'overdue' &&
                result.counts.overdue > 0 &&
                'border-[oklch(0.45_0.17_27)]/40 text-[oklch(0.45_0.17_27)]',
            )}
          >
            {t(`care.charges.views.${view}`, { count: result.counts[view] })}
          </Link>
        ))}
      </nav>

      <FilterBar
        action={routes.subscriptions.charges()}
        search={{ defaultValue: result.q, placeholder: t('care.charges.searchPlaceholder') }}
        hasFilters={hasFilters}
        className="sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center"
      >
        {result.view === 'open' ? null : <input type="hidden" name="view" value={result.view} />}
        <NativeSelect
          name="month"
          defaultValue={result.month ?? ''}
          aria-label={t('care.charges.month')}
        >
          <option value="">{t('care.charges.allMonths')}</option>
          {months.map((month) => (
            <option key={month} value={month}>
              {monthLabel(`${month}-01`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>

      <ListResults
        isEmpty={result.items.length === 0}
        hasFilters={hasFilters}
        noResults={{
          title: t('care.charges.noResultsTitle'),
          body: t('care.charges.noResultsBody'),
        }}
        empty={
          <EmptyState
            icon={<Receipt />}
            title={t(`care.charges.emptyTitle.${result.view}`)}
            body={t(`care.charges.emptyBody.${result.view}`)}
          />
        }
        count={t('care.charges.results', { count: result.total })}
      >
        <p className="text-sm text-muted-foreground">
          {result.view === 'credit'
            ? t('care.charges.sumsCredit', { balance: price(-result.sums.balanceMinor) })
            : t('care.charges.sums', {
                total: price(result.sums.totalMinor),
                paid: price(result.sums.paidMinor),
                balance: price(result.sums.balanceMinor),
              })}
        </p>
        <ul className="divide-y rounded-2xl border bg-card">
          {result.items.map((charge) => {
            const overdue = charge.status === 'OVERDUE';
            return (
              <li key={charge.id}>
                <Link
                  href={routes.subscriptions.charge(charge.subscriptionId, charge.id)}
                  className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium break-words">
                      <span className="tabular-nums">{charge.numberLabel}</span> ·{' '}
                      {charge.customerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[monthLabel(charge.period), charge.contractLabel, charge.addressLine]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                    <ChargeStatusBadge status={charge.status} />
                    <span className="text-sm font-semibold tabular-nums">
                      {charge.balanceMinor > 0
                        ? t('care.charges.balance', { amount: price(charge.balanceMinor) })
                        : charge.balanceMinor < 0
                          ? t('care.charges.inFavor', { amount: price(-charge.balanceMinor) })
                          : price(charge.totalMinor)}
                    </span>
                    {charge.balanceMinor > 0 ? (
                      <span
                        className={cn(
                          'text-xs text-muted-foreground',
                          overdue && 'font-medium text-[oklch(0.45_0.17_27)]',
                        )}
                      >
                        {overdue
                          ? t('care.charges.dueWas', { date: day(charge.dueDate) })
                          : t('care.charges.dueOn', { date: day(charge.dueDate) })}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        <ListPagination
          page={result.page}
          pageCount={result.pageCount}
          href={(page) =>
            routes.subscriptions.charges({
              ...viewQuery(result.view),
              page: page > 1 ? page : undefined,
            })
          }
        />
      </ListResults>
    </div>
  );
}
