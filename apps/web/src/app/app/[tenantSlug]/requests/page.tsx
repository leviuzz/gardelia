import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { hasPermission, listServiceRequests } from '@floral/core';
import { SERVICE_REQUEST_FILTERS } from '@floral/domain';
import { ListPagination } from '@/components/common/list/list-pagination';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { SERVICE_REQUEST_STATUS_BADGE } from '@/lib/service-request-ui';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('requests');
  return { title: t('title') };
}

/**
 * «Richieste» (M5, ADR-089): le richieste dei servizi arrivate dalla vetrina, prima le più vecchie
 * da gestire. Filtri «Aperte», «Nuove», «Con preventivo», «Chiuse», «Tutte»; le nuove sono le
 * stesse del numero nel menu e di «Da gestire». Tutta la squadra le vede.
 */
export default async function ServiceRequestsPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/requests'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'requests:read')) return <Forbidden />;
  const result = await listServiceRequests(ctx, await searchParams);
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const counts: Partial<Record<(typeof SERVICE_REQUEST_FILTERS)[number], number>> = {
    new: result.newCount,
    quoted: result.quotedCount,
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('requests.title')} description={t('requests.subtitle')} />

      <nav aria-label={t('requests.filtersLabel')} className="flex flex-wrap gap-2 text-sm">
        {SERVICE_REQUEST_FILTERS.map((filter) => (
          <Link
            key={filter}
            href={routes.requests.list({ filter: filter === 'open' ? undefined : filter })}
            aria-current={result.filter === filter ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 font-medium transition-colors hover:bg-muted',
              result.filter === filter && 'border-foreground/30 bg-muted',
            )}
            data-testid={`requests-filter-${filter}`}
          >
            {counts[filter] !== undefined
              ? t('requests.filterCount', {
                  label: t(`requests.filters.${filter}`),
                  count: counts[filter],
                })
              : t(`requests.filters.${filter}`)}
          </Link>
        ))}
      </nav>

      {result.items.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={t(`requests.empty.${result.filter}`)}
          body={t('requests.emptyBody')}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t('requests.results', { count: result.total })}
          </p>
          <ul className="divide-y rounded-2xl border bg-card" data-testid="requests-list">
            {result.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={routes.requests.detail(item.id)}
                  className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium break-words">
                      <span className="tabular-nums">{item.numberLabel}</span> ·{' '}
                      {item.serviceName ?? t(`serviceNames.${item.kind}`)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {[
                        item.customerName ?? t('requests.deletedBuyer'),
                        item.city,
                        item.preferredDate
                          ? format.dateTime(calendarDate(item.preferredDate), {
                              day: 'numeric',
                              month: 'short',
                              timeZone: 'UTC',
                            })
                          : null,
                        item.photoCount > 0
                          ? t('requests.photos', { count: item.photoCount })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                    <Badge variant={SERVICE_REQUEST_STATUS_BADGE[item.status]}>
                      {t(`requests.statuses.${item.status}`)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t('requests.received', {
                        date: format.dateTime(item.createdAt, {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: ctx.timezone,
                        }),
                      })}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <ListPagination
            page={result.page}
            pageCount={result.pageCount}
            href={(page) =>
              routes.requests.list({
                filter: result.filter === 'open' ? undefined : result.filter,
                page: page > 1 ? page : undefined,
              })
            }
          />
        </>
      )}
    </div>
  );
}
