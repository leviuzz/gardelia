import { Contact, Settings, Sprout } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  hasPermission,
  listCareContracts,
  type CareContractListResult,
  type TenantContext,
} from '@floral/core';
import { CARE_CONTRACT_VIEWS, careContractListFiltersSchema } from '@floral/domain';
import { ContractStatusBadge } from '@/components/care/care-ui';
import { CareTabs } from '@/components/care/charge-ui';
import { CareUpsell } from '@/components/care/care-upsell';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.contracts');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function load(
  ctx: TenantContext,
  query: Record<string, string | undefined>,
): Promise<CareContractListResult | null> {
  try {
    return await listCareContracts(ctx, query);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/**
 * Floral Care (ADR-075): i contratti di cura delle piante. Attivi (con la prossima visita),
 * borradores (da completare con le piante e confermare) e chiusi. Un contratto nasce dalla scheda
 * del cliente.
 */
export default async function CareContractsPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/subscriptions'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:read')) return <Forbidden />;
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const raw = await searchParams;
  const query = { view: single(raw.view), q: single(raw.q), page: single(raw.page) };
  const result = await load(ctx, query);
  if (!result) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('care.contracts.title')} description={t('care.contracts.subtitle')} />
        <CareUpsell ctx={ctx} />
      </div>
    );
  }
  const filters = careContractListFiltersSchema.parse(query);
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const actions = (
    <span className="flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link href={routes.settings.care}>
          <Settings />
          {t('care.contracts.offerLink')}
        </Link>
      </Button>
      {result.canWrite ? (
        <Button asChild>
          <Link href={routes.customers.list()}>
            <Contact />
            {t('care.contracts.newFromCustomer')}
          </Link>
        </Button>
      ) : null}
    </span>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('care.contracts.title')}
        description={t('care.contracts.subtitle')}
        actions={actions}
      />
      {/* "Cobros" (ADR-081): solo per chi gestisce i soldi. */}
      {hasPermission(ctx, 'subscriptions:payments') ? (
        <CareTabs routes={routes} current="contracts" />
      ) : null}

      <nav aria-label={t('care.contracts.viewsLabel')} className="flex flex-wrap gap-2 text-sm">
        {CARE_CONTRACT_VIEWS.map((view) => (
          <Link
            key={view}
            href={routes.subscriptions.list({ view: view === 'active' ? undefined : view })}
            aria-current={filters.view === view ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 font-medium transition-colors hover:bg-muted',
              filters.view === view && 'border-foreground/30 bg-muted',
            )}
          >
            {t(`care.contracts.views.${view}`, { count: result.counts[view] })}
          </Link>
        ))}
      </nav>

      <FilterBar
        action={routes.subscriptions.list()}
        search={{ defaultValue: filters.q, placeholder: t('care.contracts.searchPlaceholder') }}
        hasFilters={Boolean(filters.q)}
        className="sm:grid-cols-[minmax(0,1fr)_auto]"
      >
        {filters.view === 'active' ? null : (
          <input type="hidden" name="view" value={filters.view} />
        )}
      </FilterBar>

      <ListResults
        isEmpty={result.items.length === 0}
        hasFilters={Boolean(filters.q)}
        noResults={{
          title: t('care.contracts.noResultsTitle'),
          body: t('care.contracts.noResultsBody'),
        }}
        empty={
          <EmptyState
            icon={<Sprout />}
            title={t(`care.contracts.emptyTitle.${filters.view}`)}
            body={t(`care.contracts.emptyBody.${filters.view}`)}
            action={filters.view === 'active' && result.canWrite ? actions : null}
          />
        }
        count={t('care.contracts.results', { count: result.total })}
      >
        <ul className="divide-y rounded-2xl border bg-card">
          {result.items.map((contract) => (
            <li key={contract.id}>
              <Link
                href={routes.subscriptions.detail(contract.id)}
                className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium break-words">
                    <span className="tabular-nums">{contract.numberLabel}</span> ·{' '}
                    {contract.customerName}
                  </p>
                  {contract.addressLine ? (
                    <p className="truncate text-xs text-muted-foreground">{contract.addressLine}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {[
                      contract.frequency
                        ? t(`care.offer.frequencyNames.${contract.frequency}`)
                        : null,
                      t('care.contracts.plants', { count: contract.plantCount }),
                      contract.perVisitMinor !== null
                        ? t('care.contracts.perVisit', {
                            price: money(contract.perVisitMinor, contract.currency),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                  <ContractStatusBadge status={contract.status} />
                  {contract.overdue ? (
                    <Badge variant="danger">{t('care.contracts.overdue')}</Badge>
                  ) : null}
                  {contract.toReschedule > 0 ? (
                    <Badge variant="danger">
                      {t('care.contracts.toReschedule', { count: contract.toReschedule })}
                    </Badge>
                  ) : null}
                  {contract.nextVisit ? (
                    <span className="text-xs text-muted-foreground">
                      {t('care.contracts.nextVisit', { date: day(contract.nextVisit) })}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <ListPagination
          page={result.page}
          pageCount={result.pageCount}
          href={(page) =>
            routes.subscriptions.list({
              view: filters.view === 'active' ? undefined : filters.view,
              q: filters.q,
              page: page > 1 ? page : undefined,
            })
          }
        />
      </ListResults>
    </div>
  );
}
