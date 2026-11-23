import { ArrowLeft, Info, MessageCircle, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { cache } from 'react';
import {
  NotFoundError,
  getCustomer,
  getOrder,
  type OrderDetailDto,
  type TenantContext,
} from '@floral/core';
import {
  MX_REGIONS,
  getMarket,
  minorToDecimalString,
  todayInTimeZone,
  whatsappLink,
} from '@floral/domain';
import { PrivateImage } from '@/components/common/private-image';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/common/status-badges';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { money, phoneForInput } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  cancelOrderAction,
  changeOrderStatusAction,
  recordPaymentAction,
  reversePaymentAction,
  updateFulfillmentAction,
} from '../actions';
import {
  CancelOrderDialog,
  FulfillmentForm,
  OrderStepActions,
  PaymentForm,
  ReversePaymentButton,
} from '../order-forms';
import { DraftOrderView } from './draft-order';
import { OrderLinesEditor } from './order-lines';
import { PrintOrderButton } from './print-button';

const loadOrder = cache(async (ctx: TenantContext, orderId: string): Promise<OrderDetailDto> => {
  try {
    return await getOrder(ctx, orderId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/orders/[orderId]'>): Promise<Metadata> {
  const { tenantSlug, orderId } = await params;
  const order = await loadOrder(await getTenantContext(tenantSlug), orderId);
  return { title: order.numberLabel };
}

function isoDate(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export default async function OrderPage({
  params,
}: PageProps<'/app/[tenantSlug]/orders/[orderId]'>) {
  const { tenantSlug, orderId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const order = await loadOrder(ctx, orderId);
  // Borrador (anche scartato): non ha ancora data né consegna.
  const scheduledDate = order.scheduledDate;
  if (scheduledDate === null) return <DraftOrderView ctx={ctx} order={order} />;
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const fmt = (minor: number) => money(minor, order.currency);
  const longDate = (value: string) =>
    format.dateTime(calendarDate(value), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const window =
    order.windowStart && order.windowEnd
      ? t('orders.window', { start: order.windowStart, end: order.windowEnd })
      : t('orders.allDay');
  const region = (code: string) => MX_REGIONS.find((item) => item.code === code)?.name ?? code;
  const today = isoDate(todayInTimeZone(ctx.timezone));

  // Messaggio al cliente: sempre nella lingua del mercato della fioreria (ADR-042).
  const shopLocale = getMarket(ctx.country).defaultLocale;
  const [tShop, formatShop] = await Promise.all([
    getTranslations({ locale: shopLocale }),
    getFormatter({ locale: shopLocale }),
  ]);
  const shopDate = formatShop.dateTime(calendarDate(scheduledDate), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const shopWindow =
    order.windowStart && order.windowEnd
      ? ` ${tShop('orders.whatsapp.window', { start: order.windowStart, end: order.windowEnd })}`
      : '';
  const whatsappText = order.customer.phone
    ? [
        tShop('orders.whatsapp.greeting', {
          name: order.customer.displayName,
          number: order.numberLabel,
          shop: ctx.tenantName,
        }),
        '',
        ...order.lines.map((line) =>
          tShop('orders.whatsapp.line', {
            quantity: line.quantity,
            description: line.description,
            total: fmt(line.lineTotalMinor),
          }),
        ),
        '',
        tShop(
          order.fulfillmentMode === 'DELIVERY'
            ? 'orders.whatsapp.delivery'
            : 'orders.whatsapp.pickup',
          {
            date: shopDate,
          },
        ) + shopWindow,
        tShop('orders.whatsapp.total', { total: fmt(order.totalMinor) }),
        ...(order.paidMinor > 0
          ? [tShop('orders.whatsapp.paid', { paid: fmt(order.paidMinor) })]
          : []),
        ...(order.balanceMinor > 0
          ? [tShop('orders.whatsapp.balance', { balance: fmt(order.balanceMinor) })]
          : []),
      ].join('\n')
    : null;

  const customer = order.editable ? await getCustomer(ctx, order.customer.id) : null;
  const delivery = order.deliveryAddress;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        href={routes.orders.list()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular-nums">{order.numberLabel}</span>
            <OrderStatusBadge status={order.status} className="font-sans" />
            {order.status === 'CANCELLED' ? null : (
              <span className="font-sans">
                <PaymentStatusBadge status={order.paymentStatus} />
              </span>
            )}
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <Link
              href={routes.customers.detail(order.customer.id)}
              className="font-medium text-foreground hover:underline"
            >
              {order.customer.displayName}
            </Link>
            <span className="inline-block first-letter:uppercase">
              {longDate(scheduledDate)} · {window}
            </span>
            {order.quote ? (
              <Link href={routes.quotes.detail(order.quote.id)} className="hover:underline">
                {t('orders.detail.fromQuote', { number: order.quote.numberLabel })}
              </Link>
            ) : null}
          </span>
        }
        actions={
          <>
            <PrintOrderButton label={t('orders.detail.print')} icon={<Printer />} />
            {whatsappText && order.customer.phone ? (
              <Button asChild variant="outline">
                <a
                  href={whatsappLink(order.customer.phone, whatsappText)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle />
                  {t('orders.detail.whatsapp')}
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      {/* Comanda: intestazione visibile solo in stampa. */}
      <div className="hidden space-y-1 border-b pb-4 print:block">
        <p className="font-display text-2xl font-semibold">{ctx.tenantName}</p>
        <p className="text-lg font-medium">
          {order.numberLabel} · {t(`orders.modes.${order.fulfillmentMode}`)}
        </p>
        <p className="text-sm first-letter:uppercase">
          {longDate(scheduledDate)} · {window}
        </p>
        <p className="text-sm">
          {order.customer.displayName}
          {order.customer.phone ? ` · ${phoneForInput(order.customer.phone)}` : ''}
        </p>
      </div>

      {order.status === 'CANCELLED' && order.cancelReason ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertDescription>
            {t('orders.detail.cancelledBecause', { reason: order.cancelReason })}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] print:block print:space-y-6">
        <div className="min-w-0 space-y-6">
          <Card className="print:border-0 print:shadow-none">
            <CardHeader className="print:px-0">
              <CardTitle>{t('orders.detail.lines')}</CardTitle>
            </CardHeader>
            <CardContent className="print:px-0">
              <ul className="divide-y">
                {order.lines.map((line) => (
                  <li key={line.id} className="flex gap-4 py-3 first:pt-0 last:pb-0">
                    {line.image ? (
                      <PrivateImage
                        src={routes.orders.lineImage(order.id, line.id)}
                        alt={line.description}
                        className="size-20 shrink-0 rounded-xl object-cover"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        <span className="tabular-nums">{line.quantity} ×</span> {line.description}
                      </p>
                      {line.recipe && line.recipe.length > 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {t('quotes.editor.recipeOf')}{' '}
                          {format.list(
                            line.recipe.map((ingredient) =>
                              t('quotes.editor.recipeItem', {
                                quantity: ingredient.quantity,
                                name: ingredient.variety
                                  ? `${ingredient.name} ${ingredient.variety}`
                                  : ingredient.name,
                              }),
                            ),
                          )}
                        </p>
                      ) : null}
                    </div>
                    <p className="shrink-0 font-medium tabular-nums">{fmt(line.lineTotalMinor)}</p>
                  </li>
                ))}
              </ul>
              {order.linesEditable ? (
                <details className="mt-5 rounded-xl border p-4 print:hidden">
                  <summary className="cursor-pointer font-medium">
                    {t('orders.draft.editLines')}
                  </summary>
                  <p className="mt-2 mb-4 text-sm text-muted-foreground">
                    {t('orders.draft.editLinesBody')}
                  </p>
                  <OrderLinesEditor ctx={ctx} order={order} />
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card className="print:border-0 print:shadow-none">
            <CardHeader className="print:px-0">
              <CardTitle>{t('orders.detail.delivery')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 print:px-0">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t('orders.detail.when')}</dt>
                  <dd className="first-letter:uppercase">
                    {longDate(scheduledDate)} · {window}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('orders.detail.deliverTo')}</dt>
                  <dd>
                    {delivery ? (
                      <>
                        {delivery.addressLine1}
                        {delivery.addressLine2 ? `, ${delivery.addressLine2}` : ''}
                        <br />
                        {[
                          delivery.neighborhood,
                          delivery.postalCode,
                          delivery.city,
                          region(delivery.region),
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </>
                    ) : (
                      t('orders.modes.PICKUP')
                    )}
                  </dd>
                </div>
                {order.recipientName || order.recipientPhone ? (
                  <div>
                    <dt className="text-muted-foreground">{t('orders.detail.recipient')}</dt>
                    <dd>
                      {order.recipientName}
                      {order.recipientPhone ? (
                        <span className="block tabular-nums">
                          {phoneForInput(order.recipientPhone)}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                {order.deliveryNotes ? (
                  <div>
                    <dt className="text-muted-foreground">{t('orders.detail.deliveryNotes')}</dt>
                    <dd className="whitespace-pre-line">{order.deliveryNotes}</dd>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">{t('orders.detail.card')}</dt>
                  <dd>
                    {order.cardMessage ? (
                      <span className="block rounded-xl bg-muted/50 p-3 whitespace-pre-line italic">
                        {order.cardMessage}
                      </span>
                    ) : (
                      t('orders.detail.noCard')
                    )}
                    {order.cardMessage ? (
                      <span className="mt-1 block text-muted-foreground">
                        {order.cardAnonymous
                          ? t('orders.detail.anonymous')
                          : order.cardSignature
                            ? t('orders.detail.signedBy', { name: order.cardSignature })
                            : null}
                      </span>
                    ) : null}
                  </dd>
                </div>
                {order.notes ? (
                  <div className="sm:col-span-2 print:hidden">
                    <dt className="text-muted-foreground">{t('orders.detail.notes')}</dt>
                    <dd className="whitespace-pre-line">{order.notes}</dd>
                  </div>
                ) : null}
              </dl>

              {order.editable && customer ? (
                <details className="rounded-xl border p-4 print:hidden">
                  <summary className="cursor-pointer font-medium">
                    {t('orders.detail.editDelivery')}
                  </summary>
                  <p className="mt-2 mb-4 text-sm text-muted-foreground">
                    {t('orders.detail.editDeliveryBody')}
                  </p>
                  <FulfillmentForm
                    action={updateFulfillmentAction.bind(null, slug, order.id)}
                    formKey={`${order.fulfillmentMode}-${scheduledDate}-${order.deliveryFeeMinor}`}
                    currency={order.currency}
                    regions={MX_REGIONS.map(({ code, name }) => ({ code, name }))}
                    dateMin={scheduledDate < today ? scheduledDate : today}
                    submitLabel={t('orders.form.save')}
                    addresses={customer.addresses.map((address) => ({
                      id: address.id,
                      label: [address.label, address.addressLine1, address.neighborhood]
                        .filter(Boolean)
                        .join(' · '),
                    }))}
                    defaults={{
                      fulfillmentMode: order.fulfillmentMode,
                      scheduledDate,
                      windowStart: order.windowStart ?? '',
                      windowEnd: order.windowEnd ?? '',
                      addressChoice: order.customerAddressId ?? 'new',
                      address: delivery
                        ? {
                            addressLine1: delivery.addressLine1,
                            addressLine2: delivery.addressLine2 ?? '',
                            neighborhood: delivery.neighborhood ?? '',
                            postalCode: delivery.postalCode,
                            city: delivery.city,
                            region: delivery.region,
                          }
                        : { region: 'AGU' },
                      recipientName: order.recipientName ?? '',
                      recipientPhone: phoneForInput(order.recipientPhone),
                      deliveryNotes: order.deliveryNotes ?? '',
                      cardMessage: order.cardMessage ?? '',
                      cardSignature: order.cardSignature ?? '',
                      cardAnonymous: order.cardAnonymous,
                      deliveryFee:
                        order.deliveryFeeMinor > 0
                          ? minorToDecimalString(order.deliveryFeeMinor, ctx.currency)
                          : '',
                      notes: order.notes ?? '',
                    }}
                  />
                </details>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="print:border-0 print:shadow-none">
            <CardHeader className="print:px-0">
              <CardTitle>{t('orders.detail.summary')}</CardTitle>
            </CardHeader>
            <CardContent className="print:px-0">
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
                {order.deliveryFeeMinor > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{t('orders.detail.deliveryFee')}</dt>
                    <dd className="tabular-nums">{fmt(order.deliveryFeeMinor)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                  <dt>{t('orders.detail.total')}</dt>
                  <dd className="tabular-nums" data-testid="order-total">
                    {fmt(order.totalMinor)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t('orders.detail.paid')}</dt>
                  <dd className="tabular-nums">{fmt(order.paidMinor)}</dd>
                </div>
                {order.status === 'CANCELLED' ? null : (
                  <div className="flex justify-between gap-4 font-medium">
                    <dt>{t('orders.detail.balance')}</dt>
                    <dd className="tabular-nums" data-testid="order-balance">
                      {fmt(order.balanceMinor)}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card className="print:hidden">
            <CardHeader>
              <CardTitle>{t('orders.detail.statusTitle')}</CardTitle>
              {order.nextSteps.length > 0 ? (
                <CardDescription>{t('orders.detail.statusHint')}</CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-2">
              <OrderStepActions
                action={changeOrderStatusAction.bind(null, slug, order.id)}
                current={order.status}
                steps={order.nextSteps}
              />
              {order.canCancel ? (
                <CancelOrderDialog action={cancelOrderAction.bind(null, slug, order.id)} />
              ) : null}
            </CardContent>
          </Card>

          <Card className="print:hidden">
            <CardHeader>
              <CardTitle>{t('orders.detail.payments')}</CardTitle>
              {order.canRecordPayments ? (
                <CardDescription>{t('orders.detail.paymentsHint')}</CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-5">
              {order.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('orders.detail.noPayments')}</p>
              ) : (
                <ul className="divide-y text-sm">
                  {order.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {t(`orders.paymentKinds.${payment.kind}`)} ·{' '}
                          {t(`orders.methods.${payment.method}`)}
                        </span>
                        <span className="block text-muted-foreground">
                          {format.dateTime(calendarDate(payment.paidOn), {
                            dateStyle: 'medium',
                            timeZone: 'UTC',
                          })}
                          {payment.reference ? ` · ${payment.reference}` : ''}
                        </span>
                      </span>
                      <span
                        className={
                          payment.amountMinor < 0
                            ? 'font-medium text-destructive tabular-nums'
                            : 'font-medium tabular-nums'
                        }
                      >
                        {payment.amountMinor < 0
                          ? `−${fmt(-payment.amountMinor)}`
                          : fmt(payment.amountMinor)}
                      </span>
                      {order.canRecordPayments && !payment.reversed ? (
                        <ReversePaymentButton
                          action={reversePaymentAction.bind(null, slug, order.id, payment.id)}
                          label={t('orders.detail.reverseLabel', {
                            amount: fmt(payment.amountMinor),
                          })}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {order.canRecordPayments && order.balanceMinor > 0 ? (
                <PaymentForm
                  action={recordPaymentAction.bind(null, slug, order.id)}
                  currency={order.currency}
                  today={today}
                  defaultAmount={minorToDecimalString(order.balanceMinor, ctx.currency)}
                  defaultKind={order.paidMinor > 0 ? 'BALANCE' : 'DEPOSIT'}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card className="print:hidden">
            <CardHeader>
              <CardTitle>{t('orders.detail.history')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {order.events.map((event) => (
                  <li key={event.id} className="flex flex-wrap justify-between gap-x-3">
                    <span>
                      {event.fromStatus
                        ? t('orders.detail.historyStep', {
                            from: t(`orders.statuses.${event.fromStatus}`),
                            to: t(`orders.statuses.${event.toStatus}`),
                          })
                        : t('orders.detail.historyCreated', {
                            status: t(`orders.statuses.${event.toStatus}`),
                          })}
                      {event.note ? (
                        <span className="block text-muted-foreground">{event.note}</span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {format.dateTime(event.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: ctx.timezone,
                      })}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
