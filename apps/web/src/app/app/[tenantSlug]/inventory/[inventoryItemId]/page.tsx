import { ArrowLeft, Ban, CalendarClock, TriangleExclamationPoint } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getEntitlements,
  getInventoryItem,
  hasPermission,
  listInventoryMovements,
  type InventoryItemDetailDto,
  type TenantContext,
} from '@floral/core';
import {
  costDifferenceBps,
  inventoryMovementFiltersSchema,
  parseIsoDate,
  reservationDaysLeft,
  suggestedAvailability,
  todayInTimeZone,
} from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ListPagination } from '@/components/common/list/list-pagination';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { ReservationStateBadge, StockStatusBadge } from '@/components/inventory/inventory-ui';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import { MovementList } from '@/components/inventory/movement-list';
import {
  MinimumDialog,
  StockCountDialog,
  StockOutDialog,
  type StockFormItem,
} from '@/components/inventory/stock-forms';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import {
  recordStockCountAction,
  recordStockOutAction,
  reverseInventoryEntryAction,
  setCatalogAvailabilityAction,
  stopInventoryTrackingAction,
  updateInventorySettingsAction,
  applyRealCostAction,
} from '../actions';

/** "+12 %" / "−8 %": differenza fra costo reale e costo del catalogo. */
function signedPercent(bps: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(bps / 10_000);
}

async function loadItem(ctx: TenantContext, id: string): Promise<InventoryItemDetailDto | null> {
  try {
    return await getInventoryItem(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/inventory/[inventoryItemId]'>): Promise<Metadata> {
  const { tenantSlug, inventoryItemId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations('inventory');
  if (!hasPermission(ctx, 'inventory:read')) return { title: t('title') };
  const item = await loadItem(ctx, inventoryItemId);
  return { title: item?.name ?? t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Scheda di un prodotto controllato (ADR-060): giacenza, avviso, costi (solo chi li vede), le
 * azioni del giorno (uso, merma, conteggio) e lo storico con "Anular". Se la giacenza contraddice
 * il catalogo, propone il clic per cambiarne la disponibilità (mai da sola).
 */
export default async function InventoryItemPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory/[inventoryItemId]'>) {
  const { tenantSlug, inventoryItemId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:read')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const tCatalog = await getTranslations('catalog');
  const routes = tenantRoutes(ctx.tenantSlug);
  const slug = ctx.tenantSlug;
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.inventory.list()}>
        <ArrowLeft aria-hidden="true" />
        {t('item.back')}
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
  const item = await loadItem(ctx, inventoryItemId);
  if (!item) notFound();

  const raw = await searchParams;
  const filters = inventoryMovementFiltersSchema.parse({ page: single(raw.page) });
  const history = await listInventoryMovements(
    ctx,
    { page: filters.page },
    { inventoryItemId: item.id },
  );
  const canWrite = hasPermission(ctx, 'inventory:write');
  const active = item.tracking === 'ACTIVE';
  const today = todayInTimeZone(ctx.timezone);
  const quantity = (count: number) => t('quantity', { unit: item.saleUnit, count });
  const formItem: StockFormItem = {
    name: item.name,
    saleUnit: item.saleUnit,
    onHand: item.onHand,
    available: item.available,
    minQuantity: item.minQuantity,
  };
  const suggestion =
    active && hasPermission(ctx, 'catalog:write') && item.catalogStatus === 'ACTIVE'
      ? suggestedAvailability(item.status, item.catalogAvailability)
      : null;
  const costsVisible = hasPermission(ctx, 'catalog:costs:read');
  const difference = costDifferenceBps(item.avgUnitCostMinor, item.catalogCostMinor);
  // "Usar este costo": il costo reale delle compras diventa il costo del catalogo, con un clic.
  const canUseRealCost =
    item.hasPurchases &&
    item.avgUnitCostMinor !== null &&
    item.avgUnitCostMinor !== item.catalogCostMinor &&
    item.catalogStatus === 'ACTIVE' &&
    canWrite &&
    hasPermission(ctx, 'catalog:write');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader
          title={item.variety ? `${item.name} · ${item.variety}` : item.name}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{tCatalog(`types.${item.type}`)}</Badge>
              {active ? <StockStatusBadge status={item.status} /> : null}
              <Link
                href={routes.catalog.item(item.catalogItemId)}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('item.catalogLink')}
              </Link>
            </span>
          }
        />
      </div>

      {!active ? (
        <Alert variant="info">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('item.notTracked')}</span>
            {canWrite && item.catalogStatus === 'ACTIVE' ? (
              <Button asChild size="sm" variant="outline">
                <Link href={routes.inventory.start({ q: item.name })}>{t('item.restart')}</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {item.catalogStatus === 'ARCHIVED' ? (
        <Alert variant="warning">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{t('item.catalogArchived')}</AlertDescription>
        </Alert>
      ) : null}
      {active && item.onHand < 0 ? (
        <Alert variant="destructive">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>
            {t('item.negative', { quantity: quantity(-item.onHand) })}
          </AlertDescription>
        </Alert>
      ) : null}
      {suggestion ? (
        <Alert variant="warning">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertTitle>{t(`item.suggestTitle.${suggestion}`)}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              {t('item.suggestBody', {
                current: tCatalog(`availability.${item.catalogAvailability}`),
              })}
            </p>
            <ActionButton
              action={setCatalogAvailabilityAction.bind(null, slug, item.catalogItemId, suggestion)}
              size="sm"
              variant="outline"
            >
              {t(`item.suggestAction.${suggestion}`)}
            </ActionButton>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('item.onHand')}
          value={quantity(item.onHand)}
          tone={item.onHand < 0 ? 'danger' : undefined}
          detail={
            item.reserved > 0
              ? t('list.reserved', {
                  quantity: quantity(item.reserved),
                  available: quantity(item.available),
                })
              : undefined
          }
        />
        <Stat
          label={t('item.minimum')}
          value={
            item.minQuantity === null
              ? t('item.noMinimum')
              : t('item.minimumValue', { quantity: quantity(item.minQuantity) })
          }
        />
        {costsVisible ? (
          <>
            <Stat
              label={t('item.realCost')}
              value={
                item.hasPurchases && item.avgUnitCostMinor !== null
                  ? money(item.avgUnitCostMinor, item.currency)
                  : t('item.noRealCost')
              }
              detail={
                [
                  item.catalogCostMinor === null
                    ? null
                    : `${t('item.catalogCost')}: ${money(item.catalogCostMinor, item.currency)}`,
                  item.hasPurchases && difference !== null
                    ? t('item.costDiff', { diff: signedPercent(difference, ctx.locale) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
            />
            <Stat
              label={t('item.value')}
              value={
                item.valueMinor === null ? t('item.noCost') : money(item.valueMinor, item.currency)
              }
            />
          </>
        ) : null}
      </div>

      {canUseRealCost ? (
        <ActionButton
          action={applyRealCostAction.bind(null, slug, item.id)}
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
        >
          {t('item.useRealCost')}
        </ActionButton>
      ) : null}

      {active && canWrite ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <StockOutDialog
            action={recordStockOutAction.bind(null, slug, item.id, 'USE')}
            kind="USE"
            item={formItem}
          />
          <StockOutDialog
            action={recordStockOutAction.bind(null, slug, item.id, 'WASTE')}
            kind="WASTE"
            item={formItem}
          />
          <StockCountDialog
            action={recordStockCountAction.bind(null, slug, item.id)}
            item={formItem}
          />
          <MinimumDialog
            action={updateInventorySettingsAction.bind(null, slug, item.id)}
            item={formItem}
          />
          <ConfirmActionDialog
            action={stopInventoryTrackingAction.bind(null, slug, item.id)}
            trigger={
              <Button variant="ghost" className="w-full text-muted-foreground sm:ml-auto sm:w-auto">
                <Ban aria-hidden="true" />
                {t('actions.stop')}
              </Button>
            }
            title={t('actions.stopTitle', { name: item.name })}
            description={t('actions.stopBody')}
            confirmLabel={t('actions.stopConfirm')}
          />
        </div>
      ) : null}

      {active ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t('reservations.itemBox.title')}</h2>
            {canWrite ? (
              <Button asChild variant="outline" size="sm">
                <Link href={routes.inventory.newReservation({ item: item.id })}>
                  <CalendarClock aria-hidden="true" />
                  {t('reservations.itemBox.new')}
                </Link>
              </Button>
            ) : null}
          </div>
          {item.reservations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('reservations.itemBox.empty')}</p>
          ) : (
            <ul className="divide-y rounded-2xl border bg-card">
              {item.reservations.map((reservation) => {
                const expiresOn = parseIsoDate(reservation.expiresOn);
                return (
                  <li key={reservation.id}>
                    <Link
                      href={routes.inventory.reservation(reservation.id)}
                      className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm transition-colors hover:bg-muted/30"
                    >
                      <span className="min-w-0">
                        {t('reservations.itemBox.entry', {
                          quantity: quantity(reservation.quantity),
                          label: reservation.label,
                        })}
                      </span>
                      {expiresOn ? (
                        <ReservationStateBadge
                          state="ACTIVE"
                          daysLeft={reservationDaysLeft(expiresOn, today)}
                        />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('item.history')}</h2>
        {history.movements.length === 0 ? (
          <EmptyState title={t('movements.emptyTitle')} body={t('movements.emptyBody')} />
        ) : (
          <>
            <MovementList
              movements={history.movements}
              timezone={ctx.timezone}
              reverseAction={(entryId) => reverseInventoryEntryAction.bind(null, slug, entryId)}
            />
            <ListPagination
              page={history.page}
              pageCount={history.pageCount}
              href={(page) => routes.inventory.item(item.id, { page: page > 1 ? page : undefined })}
            />
          </>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
  readonly tone?: 'danger' | undefined;
}) {
  return (
    <div className="space-y-1 rounded-2xl border bg-card p-4 shadow-xs">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          'text-xl font-semibold tabular-nums',
          tone === 'danger' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
