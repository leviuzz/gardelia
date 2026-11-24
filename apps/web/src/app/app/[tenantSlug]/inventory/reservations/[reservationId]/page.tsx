import { ArrowLeft, CircleOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getEntitlements,
  getReservation,
  hasPermission,
  type ReservationDetailDto,
  type TenantContext,
} from '@floral/core';
import {
  missingQuantity,
  reservationExpiryRange,
  toIsoDate,
  todayInTimeZone,
} from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { Forbidden } from '@/components/forbidden';
import { ReservationStateBadge } from '@/components/inventory/inventory-ui';
import { InventoryUpsell } from '@/components/inventory/inventory-upsell';
import {
  ConsumeReservationDialog,
  ExtendReservationDialog,
} from '@/components/inventory/reservation-forms';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import {
  consumeReservationAction,
  extendReservationAction,
  releaseReservationAction,
} from '../../actions';

async function loadReservation(
  ctx: TenantContext,
  reservationId: string,
): Promise<ReservationDetailDto | null> {
  try {
    return await getReservation(ctx, reservationId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/inventory/reservations/[reservationId]'>): Promise<Metadata> {
  const { tenantSlug, reservationId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations('inventory.reservations');
  if (!hasPermission(ctx, 'inventory:read')) return { title: t('title') };
  const reservation = await loadReservation(ctx, reservationId);
  return { title: reservation?.label ?? t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Scheda di un apartado (ADR-062): per chi, fino a quando, le righe con quanto c'è oggi per
 * questo apartado, e le azioni: Usar (quanto si è usato davvero), Extender, Liberar. Quello di un
 * ordine (ADR-072) lo governa l'ordine: niente azioni, solo il link all'ordine.
 */
export default async function ReservationPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/inventory/reservations/[reservationId]'>) {
  const { tenantSlug, reservationId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'inventory:read')) return <Forbidden />;
  const t = await getTranslations('inventory');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const slug = ctx.tenantSlug;
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.inventory.reservations()}>
        <ArrowLeft aria-hidden="true" />
        {t('reservations.detail.back')}
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
  const reservation = await loadReservation(ctx, reservationId);
  if (!reservation) notFound();

  const created = single((await searchParams).created) === '1';
  const open = reservation.status === 'ACTIVE';
  // L'apartado di un ordine (ADR-072) lo usa e lo libera l'ordine: qui niente azioni.
  const fromOrder = reservation.order;
  const canAct = open && reservation.canWrite && !fromOrder;
  const range = reservationExpiryRange(todayInTimeZone(ctx.timezone));
  const expiry = {
    min: toIsoDate(range.min),
    max: toIsoDate(range.max),
    suggested: toIsoDate(range.suggested),
  };
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'long', timeZone: 'UTC' });
  const moment = (date: Date) =>
    format.dateTime(date, { dateStyle: 'medium', timeZone: ctx.timezone });
  const showUsed = reservation.status === 'USED';

  const facts = [
    reservation.scheduled && reservation.holdsFrom
      ? t('reservations.holdsFrom', { date: day(reservation.holdsFrom) })
      : null,
    reservation.state === 'EXPIRED'
      ? t('reservations.expiredOn', { date: day(reservation.expiresOn) })
      : open
        ? t('reservations.expiresOn', { date: day(reservation.expiresOn) })
        : null,
    reservation.createdByName
      ? `${t('reservations.detail.createdBy', { name: reservation.createdByName })} · ${moment(reservation.createdAt)}`
      : null,
    reservation.closedAt && reservation.closedByName
      ? `${t(
          reservation.status === 'USED'
            ? 'reservations.detail.closedByUsed'
            : 'reservations.detail.closedByReleased',
          { name: reservation.closedByName },
        )} · ${moment(reservation.closedAt)}`
      : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader
          title={reservation.label}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <ReservationStateBadge state={reservation.state} daysLeft={reservation.daysLeft} />
              {facts.map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </span>
          }
        />
      </div>

      {created && open ? (
        <Alert variant="success">
          <AlertDescription>{t('reservations.detail.created')}</AlertDescription>
        </Alert>
      ) : null}
      {fromOrder ? (
        <Alert variant="info">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {t(open ? 'reservations.detail.orderNotice' : 'reservations.detail.orderClosed', {
                number: fromOrder.numberLabel,
                name: fromOrder.customerName,
              })}
            </span>
            <Button asChild size="sm" variant="outline">
              <Link href={routes.orders.detail(fromOrder.id)}>
                {t('reservations.detail.orderLink')}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {reservation.state === 'EXPIRED' && !fromOrder ? (
        <Alert variant="warning">
          <AlertDescription>{t('reservations.detail.expiredNotice')}</AlertDescription>
        </Alert>
      ) : null}
      {reservation.state === 'USED' ? (
        <Alert variant="info">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('reservations.detail.usedNotice')}</span>
            <Button asChild size="sm" variant="outline">
              <Link href={routes.inventory.movements({ kind: 'USE' })}>
                {t('reservations.detail.movementsLink')}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {reservation.state === 'RELEASED' ? (
        <Alert variant="info">
          <AlertDescription>{t('reservations.detail.releasedNotice')}</AlertDescription>
        </Alert>
      ) : null}
      {reservation.note ? (
        <p className="rounded-2xl border bg-card p-4 text-sm whitespace-pre-line">
          {reservation.note}
        </p>
      ) : null}

      {canAct ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <ConsumeReservationDialog
            action={consumeReservationAction.bind(null, slug, reservation.id)}
            label={reservation.label}
            lines={reservation.lines.map((line) => ({
              id: line.id,
              name: line.variety ? `${line.name} · ${line.variety}` : line.name,
              saleUnit: line.saleUnit,
              quantity: line.quantity,
              availableForThis: line.availableForThis,
              tracked: line.tracking === 'ACTIVE',
            }))}
          />
          <ExtendReservationDialog
            action={extendReservationAction.bind(null, slug, reservation.id)}
            label={reservation.label}
            expiry={expiry}
            current={reservation.state === 'EXPIRED' ? expiry.suggested : reservation.expiresOn}
          />
          <ConfirmActionDialog
            action={releaseReservationAction.bind(null, slug, reservation.id)}
            trigger={
              <Button variant="ghost" className="w-full text-muted-foreground sm:ml-auto sm:w-auto">
                <CircleOff aria-hidden="true" />
                {t('reservations.actions.release')}
              </Button>
            }
            title={t('reservations.actions.releaseTitle', { label: reservation.label })}
            description={t('reservations.actions.releaseBody')}
            confirmLabel={t('reservations.actions.releaseConfirm')}
          />
        </div>
      ) : null}

      {/* Un elenco a due colonne, non una tabella: si legge intero anche a 320 px. */}
      <ul className="divide-y rounded-2xl border bg-card text-sm">
        {reservation.lines.map((line) => {
          const amount = (count: number) => t('quantity', { unit: line.saleUnit, count });
          const tracked = line.tracking === 'ACTIVE';
          const missing = missingQuantity(line.quantity, line.availableForThis);
          let status: { readonly text: string; readonly danger: boolean } | null = null;
          if (showUsed) {
            status = {
              text: t('reservations.detail.usedLine', { quantity: amount(line.usedQuantity ?? 0) }),
              danger: false,
            };
          } else if (open && tracked) {
            status =
              missing > 0
                ? {
                    text: t('reservations.detail.missing', { quantity: amount(missing) }),
                    danger: true,
                  }
                : {
                    text: t('reservations.detail.forThisLine', {
                      quantity: amount(Math.max(line.availableForThis, 0)),
                    }),
                    danger: false,
                  };
          }
          return (
            <li key={line.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <Link
                  href={routes.inventory.item(line.inventoryItemId)}
                  className="font-medium break-words hover:underline"
                >
                  {line.variety ? `${line.name} · ${line.variety}` : line.name}
                </Link>
                {!tracked ? (
                  <p className="text-xs text-muted-foreground">
                    {t('reservations.detail.notTracked')}
                  </p>
                ) : null}
              </div>
              <div className="max-w-[55%] shrink-0 space-y-0.5 text-right">
                <p className="font-semibold tabular-nums">{amount(line.quantity)}</p>
                {status ? (
                  <p
                    className={cn(
                      'text-xs tabular-nums',
                      status.danger ? 'font-medium text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {status.text}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
