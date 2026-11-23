/**
 * Borrador di un pedido diretto (ADR-054, blocco A1b), a passi: cliente (già scelto), prodotti,
 * poi consegna e tarjeta con "Confirmar pedido" (`?step=delivery`). Mostra anche un borrador scartato, in sola lettura: non ha mai avuto una
 * data, quindi non è mai stato un ordine.
 */
import { ArrowLeft, ArrowRight, Info } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCustomer, type OrderDetailDto, type TenantContext } from '@floral/core';
import { MX_REGIONS, todayInTimeZone } from '@floral/domain';
import { OrderStatusBadge } from '@/components/common/status-badges';
import { StepIndicator } from '@/components/common/step-indicator';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { deliveryFormOptions } from '@/lib/delivery-options';
import { tenantRoutes } from '@/lib/routes';
import { confirmDraftOrderAction, discardDraftOrderAction } from '../actions';
import { DiscardDraftButton, FulfillmentForm } from '../order-forms';
import { OrderLinesEditor } from './order-lines';

function isoDate(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** Passi del borrador (il cliente si sceglie prima, in "Nuevo pedido"). */
export type DraftStep = 'products' | 'delivery';

export async function DraftOrderView({
  ctx,
  order,
  step,
}: {
  readonly ctx: TenantContext;
  readonly order: OrderDetailDto;
  /** Passo chiesto nell'URL (`?step=delivery`); senza prodotti si resta sui prodotti. */
  readonly step: DraftStep;
}) {
  const t = await getTranslations();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const fmt = (minor: number) => money(minor, order.currency);
  const discarded = order.status === 'CANCELLED';
  // Chi può comporre l'ordine può anche confermarlo (`orders:write`).
  const canWrite = order.linesEditable;
  const hasLines = order.lines.length > 0;
  const current: DraftStep = canWrite && hasLines && step === 'delivery' ? 'delivery' : 'products';
  const onDelivery = current === 'delivery';
  const customer = onDelivery ? await getCustomer(ctx, order.customer.id) : null;
  const defaultAddress =
    customer?.addresses.find((address) => address.isDefault) ?? customer?.addresses[0];
  const today = isoDate(todayInTimeZone(ctx.timezone));
  const delivery = onDelivery ? await deliveryFormOptions(ctx) : null;
  const steps = [
    { key: 'customer', label: t('orders.draft.stepCustomer') },
    { key: 'products', label: t('orders.draft.stepProducts') },
    { key: 'delivery', label: t('orders.draft.stepDelivery') },
  ];

  const summary = (
    <Card>
      <CardHeader>
        <CardTitle>{t('orders.detail.summary')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-sm">
          {onDelivery ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t('orders.detail.lines')}</dt>
              <dd>{t('orders.draft.linesCount', { count: order.lines.length })}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('orders.detail.subtotal')}</dt>
            <dd className="tabular-nums">{fmt(order.subtotalMinor)}</dd>
          </div>
          {order.discountMinor > 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t('orders.detail.discount')}</dt>
              <dd className="tabular-nums">−{fmt(order.discountMinor)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
            <dt>{t('orders.detail.total')}</dt>
            <dd className="tabular-nums" data-testid="order-total">
              {fmt(order.totalMinor)}
            </dd>
          </div>
        </dl>
        {onDelivery ? (
          <Link
            href={routes.orders.detail(order.id)}
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            {t('orders.draft.changeLines')}
          </Link>
        ) : canWrite ? (
          <p className="mt-3 text-xs text-muted-foreground">{t('quotes.editor.pricesNote')}</p>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        href={routes.orders.list(discarded ? undefined : { when: 'drafts' })}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular-nums">{order.numberLabel}</span>
            <OrderStatusBadge status={discarded ? 'CANCELLED' : 'DRAFT'} className="font-sans" />
          </span>
        }
        description={
          <Link
            href={routes.customers.detail(order.customer.id)}
            className="font-medium text-foreground hover:underline"
          >
            {order.customer.displayName}
          </Link>
        }
        actions={
          order.canDiscard ? (
            <DiscardDraftButton action={discardDraftOrderAction.bind(null, slug, order.id)} />
          ) : null
        }
      />

      {/* Nuevo pedido a passi: il cliente è già scelto, poi prodotti, poi consegna e conferma. */}
      {canWrite ? <StepIndicator steps={steps} current={onDelivery ? 2 : 1} /> : null}

      {discarded || (canWrite && !onDelivery) ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertDescription>
            {discarded ? t('orders.draft.discarded') : t('orders.draft.intro')}
          </AlertDescription>
        </Alert>
      ) : null}

      {onDelivery && customer && delivery ? (
        // Su telefono il riepilogo (con il totale) viene prima del modulo e del pulsante di
        // conferma; da lg è la colonna di destra.
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">{summary}</div>
          <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
            <Card>
              <CardHeader>
                <CardTitle>{t('orders.draft.stepDelivery')}</CardTitle>
                <CardDescription>{t('orders.draft.deliveryHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <FulfillmentForm
                  action={confirmDraftOrderAction.bind(null, slug, order.id)}
                  currency={order.currency}
                  regions={MX_REGIONS.map(({ code, name }) => ({ code, name }))}
                  dateMin={today}
                  submitLabel={t('orders.draft.confirm')}
                  windows={delivery.windows}
                  closedWeekdays={delivery.closedWeekdays}
                  addresses={customer.addresses.map((address) => ({
                    id: address.id,
                    label: [address.label, address.addressLine1, address.neighborhood]
                      .filter(Boolean)
                      .join(' · '),
                  }))}
                  defaults={{
                    fulfillmentMode: 'DELIVERY',
                    scheduledDate: today,
                    windowStart: '',
                    windowEnd: '',
                    addressChoice: defaultAddress?.id ?? 'new',
                    address: { region: 'AGU' },
                    recipientName: '',
                    recipientPhone: '',
                    deliveryNotes: '',
                    cardMessage: '',
                    cardSignature: '',
                    cardAnonymous: false,
                    deliveryFee: delivery.defaultFee,
                    notes: '',
                  }}
                />
              </CardContent>
            </Card>
            <Button asChild variant="ghost">
              <Link href={routes.orders.detail(order.id)}>
                <ArrowLeft />
                {t('steps.back')}
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        // Su telefono: prodotti, riepilogo, poi "Continuar"; da lg il riepilogo è a destra.
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <Card>
              <CardHeader>
                <CardTitle>
                  {discarded ? t('orders.detail.lines') : t('orders.draft.stepProducts')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <OrderLinesEditor ctx={ctx} order={order} />
              </CardContent>
            </Card>
          </div>
          <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">{summary}</div>
          {canWrite ? (
            <div className="min-w-0 lg:col-start-1 lg:row-start-2">
              {hasLines ? (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <p className="text-sm text-muted-foreground">{t('orders.draft.continueHint')}</p>
                  <Button asChild>
                    <Link href={routes.orders.detail(order.id, { step: 'delivery' })}>
                      {t('steps.continue')}
                      <ArrowRight />
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('orders.draft.needsLines')}</p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
