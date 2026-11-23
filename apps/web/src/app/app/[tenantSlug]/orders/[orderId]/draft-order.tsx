/**
 * Borrador di un pedido diretto (ADR-054, blocco A1b): 1) prodotti, 2) consegna e tarjeta con
 * "Confirmar pedido". Mostra anche un borrador scartato, in sola lettura: non ha mai avuto una
 * data, quindi non è mai stato un ordine.
 */
import { ArrowLeft, Info } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCustomer, type OrderDetailDto, type TenantContext } from '@floral/core';
import { MX_REGIONS, todayInTimeZone } from '@floral/domain';
import { OrderStatusBadge } from '@/components/common/status-badges';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { confirmDraftOrderAction, discardDraftOrderAction } from '../actions';
import { DiscardDraftButton, FulfillmentForm } from '../order-forms';
import { OrderLinesEditor } from './order-lines';

function isoDate(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export async function DraftOrderView({
  ctx,
  order,
}: {
  readonly ctx: TenantContext;
  readonly order: OrderDetailDto;
}) {
  const t = await getTranslations();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const fmt = (minor: number) => money(minor, order.currency);
  const discarded = order.status === 'CANCELLED';
  // Chi può comporre l'ordine può anche confermarlo (`orders:write`).
  const canWrite = order.linesEditable;
  const customer = canWrite ? await getCustomer(ctx, order.customer.id) : null;
  const defaultAddress =
    customer?.addresses.find((address) => address.isDefault) ?? customer?.addresses[0];
  const today = isoDate(todayInTimeZone(ctx.timezone));

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

      {discarded || canWrite ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertDescription>
            {discarded ? t('orders.draft.discarded') : t('orders.draft.intro')}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Su telefono il riepilogo sta fra prodotti e consegna, così il totale si vede prima di
          confermare; da lg è la colonna di destra. */}
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

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Card>
            <CardHeader>
              <CardTitle>{t('orders.detail.summary')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
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
              {canWrite ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t('quotes.editor.pricesNote')}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {canWrite && customer ? (
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('orders.draft.stepDelivery')}</CardTitle>
                <CardDescription>
                  {order.lines.length > 0
                    ? t('orders.draft.deliveryHint')
                    : t('orders.draft.needsLines')}
                </CardDescription>
              </CardHeader>
              {order.lines.length > 0 ? (
                <CardContent>
                  <FulfillmentForm
                    action={confirmDraftOrderAction.bind(null, slug, order.id)}
                    currency={order.currency}
                    regions={MX_REGIONS.map(({ code, name }) => ({ code, name }))}
                    dateMin={today}
                    submitLabel={t('orders.draft.confirm')}
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
                      deliveryFee: '',
                      notes: '',
                    }}
                  />
                </CardContent>
              ) : null}
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
