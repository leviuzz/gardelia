import { CalendarClock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  getEntitlements,
  hasPermission,
  listReservations,
  type ReservationSummaryDto,
} from '@floral/core';
import { RESERVATION_VIEWS, reservationListFiltersSchema } from '@floral/domain';
import { FilterBar } from '@/components/common/list/filter-bar';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ListResults } from '@/components/common/list/list-results';
import { Forbidden } from '@/components/forbidden';
import { InventoryTabs, ReservationStateBadge } from '@/components/inventory/inventory-ui';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('inventory.reservations');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Righe mostrate nell'elenco prima di "y N productos más". */
const VISIBLE_LINES = 2;

/**
 * Apartados (ADR-062): merce messa da parte fino a una data. Vigentes dal primo che scade,
 * vencidos (da extender o liberar) e cerrados. Tutti li vedono; proprietario e manager li creano.
 */
export default async function ReservationsPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory/reservations'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:read')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  if (!(await getEntitlements(ctx)).inventory) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <InventoryUpsell ctx={ctx} />
      </div>
    );
  }

  const raw = await searchParams;
  const query = { view: single(raw.view), q: single(raw.q), page: single(raw.page) };
  const filters = reservationListFiltersSchema.parse(query);
  const result = await listReservations(ctx, query);
  const newButton = result.canWrite ? (
    <Button asChild>
      <Link href={routes.inventory.newReservation()}>
        <CalendarClock />
        {t('reservations.new')}
      </Link>
    </Button>
  ) : null;
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const moment = (date: Date) =>
    format.dateTime(date, { dateStyle: 'medium', timeZone: ctx.timezone });

  function when(reservation: ReservationSummaryDto): string {
    switch (reservation.state) {
      case 'ACTIVE':
        return t('reservations.expiresOn', { date: day(reservation.expiresOn) });
      case 'EXPIRED':
        return t('reservations.expiredOn', { date: day(reservation.expiresOn) });
      case 'USED':
        return reservation.closedAt
          ? t('reservations.usedOn', { date: moment(reservation.closedAt) })
          : '';
      case 'RELEASED':
        return reservation.closedAt
          ? t('reservations.releasedOn', { date: moment(reservation.closedAt) })
          : '';
    }
  }

  function linesSummary(reservation: ReservationSummaryDto): string {
    const shown = reservation.lines.slice(0, VISIBLE_LINES).map((line) =>
      t('reservations.line', {
        quantity: t('quantity', { unit: line.saleUnit, count: line.quantity }),
        name: line.variety ? `${line.name} · ${line.variety}` : line.name,
      }),
    );
    const more = reservation.lines.length - shown.length;
    return more > 0
      ? `${shown.join(', ')} ${t('reservations.moreLines', { count: more })}`
      : shown.join(', ');
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('reservations.subtitle')} actions={newButton} />
      <InventoryTabs current="reservations" routes={routes} showPurchases={result.canWrite} />

      <nav aria-label={t('reservations.viewsLabel')} className="flex flex-wrap gap-2 text-sm">
        {RESERVATION_VIEWS.map((view) => (
          <Link
            key={view}
            href={routes.inventory.reservations({ view: view === 'current' ? undefined : view })}
            aria-current={filters.view === view ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 font-medium transition-colors hover:bg-muted',
              filters.view === view && 'border-foreground/30 bg-muted',
              view === 'expired' && result.counts.expired > 0 && 'text-[oklch(0.45_0.17_27)]',
            )}
          >
            {t(`reservations.views.${view}`, { count: result.counts[view] })}
          </Link>
        ))}
      </nav>

      <FilterBar
        action={routes.inventory.reservations()}
        search={{ defaultValue: filters.q, placeholder: t('reservations.searchPlaceholder') }}
        hasFilters={Boolean(filters.q)}
        className="sm:grid-cols-[minmax(0,1fr)_auto]"
      >
        {filters.view === 'current' ? null : (
          <input type="hidden" name="view" value={filters.view} />
        )}
      </FilterBar>

      <ListResults
        isEmpty={result.items.length === 0}
        hasFilters={Boolean(filters.q)}
        noResults={{
          title: t('reservations.noResultsTitle'),
          body: t('reservations.noResultsBody'),
        }}
        empty={
          <EmptyState
            icon={<CalendarClock />}
            title={t(`reservations.emptyTitle.${filters.view}`)}
            body={
              result.canWrite
                ? t(`reservations.emptyBody.${filters.view}`)
                : t('reservations.emptyBodyStaff')
            }
            action={filters.view === 'current' ? newButton : null}
          />
        }
        count={t('reservations.results', { count: result.total })}
      >
        <ul className="divide-y rounded-2xl border bg-card">
          {result.items.map((reservation) => (
            <li key={reservation.id}>
              <Link
                href={routes.inventory.reservation(reservation.id)}
                className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium">{reservation.label}</p>
                  <p className="text-xs text-muted-foreground">{linesSummary(reservation)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                  <ReservationStateBadge
                    state={reservation.state}
                    daysLeft={reservation.daysLeft}
                  />
                  <span className="text-xs text-muted-foreground">{when(reservation)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <ListPagination
          page={result.page}
          pageCount={result.pageCount}
          href={(page) =>
            routes.inventory.reservations({
              view: filters.view === 'current' ? undefined : filters.view,
              q: filters.q,
              page: page > 1 ? page : undefined,
            })
          }
        />
      </ListResults>
      {!result.canWrite ? (
        <p className="text-sm text-muted-foreground">{t('reservations.staffNote')}</p>
      ) : null}
    </div>
  );
}
