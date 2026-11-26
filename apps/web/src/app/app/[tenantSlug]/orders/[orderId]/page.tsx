import {
  ArrowLeft,
  BellRing,
  Check,
  Globe,
  Hourglass,
  Info,
  MessageCircle,
  MessageSquare,
  Printer,
  TriangleExclamationPoint,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { cache } from 'react';
import {
  getLetterhead,
  NotFoundError,
  getCustomer,
  getOrder,
  getOrderInventory,
  getOrderSubstitutions,
  getPublicLink,
  hasPermission,
  listOrderAssignees,
  publicLinkUrl,
  type OrderDetailDto,
  type TenantContext,
} from '@floral/core';
import {
  MARKETPLACE_ORDER_LIMITS,
  MX_REGIONS,
  ORDER_HOLD_DAYS,
  PHOTO_LIMITS,
  canShareOrder,
  isOrderFinal,
  getMarket,
  minorToDecimalString,
  onlineOrderNeedsFreeDeliveryConfirmation,
  orderMessagePages,
  pendingOrderDeadlineShown,
  todayInTimeZone,
  whatsappLink,
} from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { PrintLetterhead } from '@/components/common/print-letterhead';
import { PrivateImage } from '@/components/common/private-image';
import { ShareLinkPanel } from '@/components/common/share-link-card';
import { OrderMessagesCard } from '@/components/orders/order-messages-card';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/common/status-badges';
import { ActionButton } from '@/components/form/action-button';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { serverEnv } from '@/lib/env';
import { money, phoneForInput } from '@/lib/format';
import { serviceSummary } from '@/lib/line-ui';
import { calendarDate } from '@/lib/quote-ui';
import { deliveryFormOptions, savedAddressOptions } from '@/lib/delivery-options';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  acceptOnlineOrderAction,
  askOrderChangeAction,
  askSubstitutionInAppAction,
  assignOrderAction,
  cancelOrderAction,
  changeOrderStatusAction,
  notifyOrderCustomerAction,
  proposeOrderDateAction,
  recordPaymentAction,
  reversePaymentAction,
  revokeOrderLinkAction,
  setOrderReceiverAction,
  shareOrderLinkAction,
  substituteIngredientAction,
  updateFulfillmentAction,
  uploadOrderPhotoAction,
} from '../actions';
import {
  AssignForm,
  CancelOrderDialog,
  FulfillmentForm,
  OrderStepActions,
  PaymentForm,
  AskOrderChangeDialog,
  ProposeOrderDateDialog,
  RejectOnlineOrderDialog,
  ReversePaymentButton,
} from '../order-forms';
import { DraftOrderView } from './draft-order';
import { HandoverPanel } from './handover-panel';
import { SubstitutionPanel, type SubstitutionLineView } from './substitution-panel';
import { OrderChangeList } from '@/components/orders/order-change-list';
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
  searchParams,
}: PageProps<'/app/[tenantSlug]/orders/[orderId]'>) {
  const { tenantSlug, orderId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const order = await loadOrder(ctx, orderId);
  const query = await searchParams;
  // Borrador (anche scartato): non ha ancora data né consegna; si compone a passi.
  const scheduledDate = order.scheduledDate;
  if (scheduledDate === null) {
    const { step } = query;
    return (
      <DraftOrderView
        ctx={ctx}
        order={order}
        step={step === 'delivery' ? 'delivery' : 'products'}
      />
    );
  }
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();
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
  const day = (value: string) =>
    format.dateTime(calendarDate(value), { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const window =
    order.windowStart && order.windowEnd
      ? t('orders.window', { start: order.windowStart, end: order.windowEnd })
      : t('orders.allDay');
  const region = (code: string) => MX_REGIONS.find((item) => item.code === code)?.name ?? code;
  const today = isoDate(todayInTimeZone(ctx.timezone));

  // Messaggio al cliente: sempre nella lingua del mercato della fioreria (ADR-042).
  const shopLocale = getMarket(ctx.country).defaultLocale;
  const [tShop, formatShop, letterhead] = await Promise.all([
    getTranslations({ locale: shopLocale }),
    getFormatter({ locale: shopLocale }),
    getLetterhead(ctx),
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
  // Seguimento per il cliente (ADR-056): lo gestisce chi scrive gli ordini.
  const canShare = hasPermission(ctx, 'orders:write');
  // Repartidor: solo a domicilio; lo sceglie chi gestisce gli ordini finché l'ordine è aperto.
  const canAssign = canShare && order.fulfillmentMode === 'DELIVERY' && !isOrderFinal(order.status);
  const assignees = canAssign ? await listOrderAssignees(ctx) : [];
  const publicLink = canShare
    ? await getPublicLink(ctx, serverEnv().BETTER_AUTH_SECRET, { kind: 'ORDER', id: order.id })
    : null;
  const publicUrl = publicLink
    ? publicLinkUrl(serverEnv().APP_URL, 'ORDER', publicLink.token)
    : null;
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
        ...(publicUrl ? ['', tShop('orders.whatsapp.link', { url: publicUrl })] : []),
      ].join('\n')
    : null;

  // Materiali dell'inventario (ADR-071): null senza il piano o se l'ordine non tocca prodotti controllati.
  const inventory = await getOrderInventory(ctx, order.id);
  // "Faltan flores" (ADR-081): null se non manca niente o il ramo è già fatto.
  const substitutions = await getOrderSubstitutions(ctx, order.id);
  const ingredientLabel = (item: { name: string; variety: string | null }) =>
    item.variety ? `${item.name} ${item.variety}` : item.name;
  const substitutionLines: SubstitutionLineView[] = (substitutions?.lines ?? []).map((line) => ({
    lineId: line.lineId,
    title: `${line.quantity} × ${line.description}`,
    mode: line.mode,
    missing: line.missing.map((missing) => ({
      itemId: missing.catalogItemId,
      label: ingredientLabel(missing),
      quantityLabel: t('inventory.quantity', { unit: missing.saleUnit, count: missing.total }),
      problemLabel:
        missing.problem === 'OUT_OF_STOCK'
          ? t('orders.substitution.outOfStock')
          : t('orders.substitution.short', {
              quantity: t('inventory.quantity', {
                unit: missing.saleUnit,
                count: missing.shortBy ?? 0,
              }),
            }),
      candidates: missing.candidates.map((candidate) => ({
        id: candidate.id,
        label: ingredientLabel(candidate),
        reason: candidate.reason,
        availabilityNote:
          candidate.availability === 'AVAILABLE'
            ? null
            : t(`catalog.availability.${candidate.availability}`),
        // Al cliente nella lingua del mercato (ADR-042), come gli altri messaggi del pedido.
        whatsappHref: order.customer.phone
          ? whatsappLink(
              order.customer.phone,
              tShop('orders.substitution.whatsapp', {
                name: order.customer.displayName,
                number: order.numberLabel,
                from: ingredientLabel(missing),
                to: ingredientLabel(candidate),
                bouquet: line.description,
              }),
            )
          : null,
      })),
      askedInApp: missing.askedInApp,
    })),
  }));
  const customer = order.editable ? await getCustomer(ctx, order.customer.id) : null;
  const deliveryOptions = order.editable ? await deliveryFormOptions(ctx) : null;
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
            {order.placedOnline ? (
              <Badge variant="secondary" className="font-sans">
                <Globe aria-hidden="true" />
                {t('orders.online.badge')}
              </Badge>
            ) : null}
            {order.status === 'CANCELLED' ? null : (
              <span className="font-sans">
                <PaymentStatusBadge status={order.paymentStatus} />
              </span>
            )}
            {/* Messaggi di chi compra da leggere (M3): portano al filo, più in basso. */}
            {order.unreadMessages > 0 ? (
              <Link
                href={routes.orders.thread(order.id)}
                className="font-sans print:hidden"
                data-testid="order-unread-link"
              >
                <Badge variant="info">
                  <MessageSquare aria-hidden="true" />
                  {t('orders.messages.unreadBadge', { count: order.unreadMessages })}
                </Badge>
              </Link>
            ) : null}
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
      <div className="hidden space-y-3 border-b pb-4 print:block">
        <PrintLetterhead
          letterhead={letterhead}
          logoSrc={
            letterhead.logoId
              ? tenantRoutes(slug).settings.storeImage('LOGO', letterhead.logoId)
              : null
          }
          locale={shopLocale}
        />
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

      {order.status === 'PENDING_ACCEPTANCE' ? (
        <Card
          className="border-warning/40 bg-warning-soft/40 print:hidden"
          data-testid="online-pending"
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="size-5 text-primary" aria-hidden="true" />
              {t('orders.online.panelTitle')}
            </CardTitle>
            <CardDescription>
              {t('orders.online.panelBody', { days: MARKETPLACE_ORDER_LIMITS.acceptDays })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* La scadenza (M3): la stessa regola dell'annullamento automatico e del promemoria. */}
            {order.onlineDeadline ? (
              <p
                className="flex items-start gap-2 text-sm font-medium"
                data-testid="online-deadline"
              >
                <Hourglass className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                {t('orders.online.deadline', {
                  date: format.dateTime(pendingOrderDeadlineShown(order.onlineDeadline), {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone: ctx.timezone,
                  }),
                })}
              </p>
            ) : null}
            {/* Per chiamare o scrivere al cliente senza aprire la sua scheda (M0). */}
            <p className="text-sm break-words" data-testid="online-contact">
              <span className="font-medium">{t('orders.online.contact')}</span>{' '}
              {order.customer.displayName}
              {order.customer.phone ? (
                <>
                  {' · '}
                  <a className="underline" href={`tel:${order.customer.phone}`}>
                    {phoneForInput(order.customer.phone)}
                  </a>
                </>
              ) : null}
              {order.customer.email ? (
                <>
                  {' · '}
                  <a className="break-all underline" href={`mailto:${order.customer.email}`}>
                    {order.customer.email}
                  </a>
                </>
              ) : null}
            </p>
            {order.buyerNotes ? (
              <div className="text-sm">
                <p className="font-medium">{t('orders.online.buyerNotes')}</p>
                <p className="mt-1 rounded-xl bg-card p-3 whitespace-pre-line">
                  {order.buyerNotes}
                </p>
              </div>
            ) : null}
            {/* M3-2: com'era → com'è, la richiesta e la risposta di chi compra. */}
            {order.change?.diff && (order.change.hasChanges || order.change.status === 'ASKED') ? (
              <div className="space-y-2 rounded-xl bg-card p-3" data-testid="order-changes">
                <p className="text-sm font-medium">{t('orders.changes.youChanged')}</p>
                <OrderChangeList
                  diff={order.change.diff}
                  currency={order.currency}
                  locale={locale}
                  testId="order-change-list"
                />
              </div>
            ) : null}
            {order.change?.status === 'ASKED' && order.change.askedAt ? (
              <p
                className="flex items-start gap-2 text-sm font-medium"
                data-testid="order-change-asked"
              >
                <Badge variant="warning">{t('orders.changes.waitingBadge')}</Badge>
                <span>
                  {t('orders.changes.askedOn', {
                    date: format.dateTime(order.change.askedAt, {
                      day: 'numeric',
                      month: 'long',
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: ctx.timezone,
                    }),
                  })}
                </span>
              </p>
            ) : order.change?.status === 'DECLINED' ? (
              <div className="space-y-1 text-sm" data-testid="order-change-declined">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <Badge variant="danger">{t('orders.changes.declinedBadge')}</Badge>
                  {t('orders.changes.declinedBody')}
                </p>
                {order.change.declineReason ? (
                  <p className="rounded-xl bg-card p-3 break-words whitespace-pre-line">
                    {order.change.declineReason}
                  </p>
                ) : null}
              </div>
            ) : order.change?.withdrawn && order.change.hasChanges ? (
              <p className="text-sm font-medium" data-testid="order-change-withdrawn">
                {t('orders.changes.withdrawn')}
              </p>
            ) : null}
            {order.canAccept || order.canAskChange || order.canProposeDate || order.canCancel ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {order.canAskChange ? (
                  <AskOrderChangeDialog
                    action={askOrderChangeAction.bind(null, slug, order.id)}
                    freeDelivery={onlineOrderNeedsFreeDeliveryConfirmation(order)}
                  />
                ) : null}
                {/* A domicilio con la consegna a 0: prima di accettare si conferma che è gratis. */}
                {!order.canAccept ? null : onlineOrderNeedsFreeDeliveryConfirmation(order) ? (
                  <ConfirmActionDialog
                    action={acceptOnlineOrderAction.bind(null, slug, order.id)}
                    trigger={
                      <Button className="w-full sm:w-auto">
                        <Check />
                        {t('orders.online.accept')}
                      </Button>
                    }
                    title={t('orders.online.freeDeliveryTitle')}
                    description={t('orders.online.freeDeliveryBody')}
                    confirmLabel={t('orders.online.freeDeliveryConfirm')}
                    confirmVariant="default"
                    fields={{ freeDeliveryConfirmed: 'on' }}
                  />
                ) : (
                  <ActionButton
                    action={acceptOnlineOrderAction.bind(null, slug, order.id)}
                    icon={<Check />}
                  >
                    {t('orders.online.accept')}
                  </ActionButton>
                )}
                {order.canProposeDate && deliveryOptions ? (
                  <ProposeOrderDateDialog
                    action={proposeOrderDateAction.bind(null, slug, order.id)}
                    dateMin={today}
                    defaults={{
                      scheduledDate,
                      windowStart: order.windowStart ?? '',
                      windowEnd: order.windowEnd ?? '',
                    }}
                    windows={deliveryOptions.windows}
                    closedWeekdays={deliveryOptions.closedWeekdays}
                    freeDelivery={onlineOrderNeedsFreeDeliveryConfirmation(order)}
                  />
                ) : null}
                {order.canCancel ? (
                  <div className="sm:w-auto">
                    <RejectOnlineOrderDialog
                      action={cancelOrderAction.bind(null, slug, order.id)}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('orders.online.askManager')}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Servizi oltre il loro raggio (ADR-081): solo un avviso, il pedido resta com'è. */}
      {order.serviceZone && !isOrderFinal(order.status) ? (
        <Alert variant="warning" className="print:hidden" data-testid="service-zone-warning">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertTitle>{t('orders.detail.serviceZoneTitle')}</AlertTitle>
          <AlertDescription>
            <ul className="space-y-1">
              {order.serviceZone.lines.map((line) => (
                <li key={line.description}>
                  {t('orders.detail.serviceZoneLine', {
                    service: line.description,
                    radius: line.radiusKm,
                    distance: format.number(order.serviceZone!.distanceKm, {
                      maximumFractionDigits: 1,
                    }),
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {substitutions && substitutionLines.length > 0 ? (
        <SubstitutionPanel
          lines={substitutionLines}
          action={substituteIngredientAction.bind(null, slug, order.id)}
          canApply={substitutions.canApply}
          askAction={
            substitutions.canApply && substitutions.canAskInApp
              ? askSubstitutionInAppAction.bind(null, slug, order.id)
              : null
          }
        />
      ) : null}

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
                            line.recipe.map((ingredient) => {
                              const item = t('quotes.editor.recipeItem', {
                                quantity: ingredient.quantity,
                                name: ingredientLabel(ingredient),
                              });
                              // Sostituito nel pedido (ADR-081): chi arma il ramo lo vede.
                              return ingredient.replaces
                                ? `${item} (${t('quotes.editor.recipeReplaces', {
                                    name: ingredientLabel(ingredient.replaces),
                                  })})`
                                : item;
                            }),
                          )}
                        </p>
                      ) : null}
                      {line.service ? (
                        <p className="text-sm text-muted-foreground">
                          {serviceSummary(t, line.service)}
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
                  {/* M3-2: su un ordine online da accettare i cambi si fanno confermare a chi compra. */}
                  {order.status === 'PENDING_ACCEPTANCE' && order.placedOnline ? (
                    <p className="mb-4 text-sm font-medium" data-testid="pending-lines-hint">
                      {t('orders.changes.linesHint')}
                    </p>
                  ) : null}
                  <OrderLinesEditor ctx={ctx} order={order} />
                </details>
              ) : null}
              {/* Ordine online accettato (M3): prodotti e sconto si cambiano una riga alla volta,
                  quindi l'email «Tu pedido cambió» parte solo quando lo chiedi, alla fine. */}
              {order.canNotifyCustomer ? (
                <div className="mt-4 print:hidden" data-testid="notify-customer">
                  <ConfirmActionDialog
                    action={notifyOrderCustomerAction.bind(null, slug, order.id)}
                    trigger={
                      <Button variant="outline" size="sm">
                        <BellRing />
                        {t('orders.notify.button')}
                      </Button>
                    }
                    title={t('orders.notify.title')}
                    description={t('orders.notify.body', { name: order.customer.displayName })}
                    confirmLabel={t('orders.notify.confirm')}
                    confirmVariant="default"
                  />
                </div>
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
                {order.fulfillmentMode === 'DELIVERY' ? (
                  <div>
                    <dt className="text-muted-foreground">{t('orders.assign.label')}</dt>
                    <dd>{order.assignee?.name ?? t('orders.assign.nobody')}</dd>
                  </div>
                ) : null}
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
                {order.buyerNotes ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">{t('orders.online.buyerNotes')}</dt>
                    <dd className="whitespace-pre-line">{order.buyerNotes}</dd>
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
                    {order.cardMessage ? (
                      <Link
                        href={routes.orders.card(order.id)}
                        className="mt-2 inline-flex items-center gap-1.5 font-medium text-primary hover:underline print:hidden"
                      >
                        <Printer className="size-4" aria-hidden="true" />
                        {t('orders.cardPrint.open')}
                      </Link>
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

              {canAssign ? (
                <div className="print:hidden">
                  <AssignForm
                    action={assignOrderAction.bind(null, slug, order.id)}
                    options={assignees}
                    current={order.assignee?.membershipId ?? null}
                  />
                </div>
              ) : null}

              {order.editable && customer && deliveryOptions ? (
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
                    windows={deliveryOptions.windows}
                    closedWeekdays={deliveryOptions.closedWeekdays}
                    distance={deliveryOptions.distance}
                    notifyBuyer={order.canNotifyCustomer}
                    addresses={savedAddressOptions(customer.addresses)}
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
                            placeId: delivery.placeId ?? '',
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
          {/* Messaggi con chi ha fatto l'ordine online (M3); niente per gli ordini del banco. */}
          <OrderMessagesCard
            ctx={ctx}
            orderId={order.id}
            pages={orderMessagePages(query.mensajes)}
          />
          {order.handover.photo ||
          order.handover.receivedBy ||
          order.handover.canAddPhoto ||
          order.handover.canSetReceiver ? (
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle>{t('orders.handover.title')}</CardTitle>
                <CardDescription>{t('orders.handover.hint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <HandoverPanel
                  photo={
                    order.handover.photo
                      ? {
                          thumbUrl: routes.orders.photo(order.id, {
                            thumb: true,
                            v: order.handover.photo.id,
                          }),
                          fullUrl: routes.orders.photo(order.id, { v: order.handover.photo.id }),
                          alt: t('orders.handover.photoAlt', { number: order.numberLabel }),
                        }
                      : null
                  }
                  upload={
                    order.handover.canAddPhoto
                      ? uploadOrderPhotoAction.bind(null, slug, order.id)
                      : null
                  }
                  maxSide={PHOTO_LIMITS.clientMaxSide}
                  receiver={{
                    current: order.handover.receivedBy,
                    action: order.handover.canSetReceiver
                      ? setOrderReceiverAction.bind(null, slug, order.id)
                      : null,
                  }}
                />
              </CardContent>
            </Card>
          ) : null}
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
              {order.status === 'PENDING_ACCEPTANCE' ? (
                <p className="text-sm text-muted-foreground">{t('orders.online.stepsAfter')}</p>
              ) : (
                <OrderStepActions
                  action={changeOrderStatusAction.bind(null, slug, order.id)}
                  current={order.status}
                  steps={order.nextSteps}
                  shortages={inventory?.shortages ?? []}
                />
              )}
              {/* L'ordine da accettare si rifiuta dal pannello in cima. */}
              {order.canCancel && order.status !== 'PENDING_ACCEPTANCE' ? (
                <CancelOrderDialog
                  action={cancelOrderAction.bind(null, slug, order.id)}
                  variant={order.placedOnline ? 'online' : 'cancel'}
                />
              ) : null}
            </CardContent>
          </Card>

          {inventory ? (
            <Card className="print:hidden" data-testid="order-inventory">
              <CardHeader>
                <CardTitle>{t('orders.inventory.title')}</CardTitle>
                <CardDescription>
                  {inventory.consumed
                    ? t(
                        inventory.consumed.reversed
                          ? 'orders.inventory.reversed'
                          : 'orders.inventory.consumed',
                        {
                          date: format.dateTime(inventory.consumed.at, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                            timeZone: ctx.timezone,
                          }),
                        },
                      )
                    : t('orders.inventory.pending')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {inventory.lines.length > 0 ? (
                  <ul className="divide-y">
                    {inventory.lines.map((line) => (
                      <li
                        key={line.catalogItemId}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0"
                      >
                        <span className="min-w-0 font-medium">
                          {line.name}{' '}
                          <span className="font-normal text-muted-foreground tabular-nums">
                            {t('inventory.quantity', {
                              unit: line.saleUnit,
                              count: line.requested,
                            })}
                          </span>
                        </span>
                        {line.missing > 0 ? (
                          <Badge variant="warning" className="tabular-nums">
                            {t('orders.inventory.missing', {
                              quantity: t('inventory.quantity', {
                                unit: line.saleUnit,
                                count: line.missing,
                              }),
                            })}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground tabular-nums">
                            {t('orders.inventory.available', {
                              quantity: t('inventory.quantity', {
                                unit: line.saleUnit,
                                count: line.available,
                              }),
                            })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    {inventory.consumed?.reversed
                      ? t('orders.inventory.reversedHint')
                      : t('orders.inventory.consumedHint')}
                  </p>
                )}
                {inventory.hold ? (
                  // L'apartado dell'ordine (ADR-072): da quando tiene la merce.
                  <p className="text-muted-foreground" data-testid="order-inventory-hold">
                    {inventory.hold.started || !inventory.hold.holdsFrom
                      ? t('orders.inventory.held', { date: day(inventory.hold.expiresOn) })
                      : t('orders.inventory.heldFrom', {
                          date: day(inventory.hold.holdsFrom),
                          days: ORDER_HOLD_DAYS,
                        })}
                  </p>
                ) : null}
                {inventory.lines.some((line) => line.reserved > 0) ? (
                  // Un apartado fatto a mano per questo ordine va liberato: l'ordine aparta già.
                  <p className="rounded-xl bg-muted p-3">
                    {t('orders.inventory.reservedHint')}{' '}
                    <Link
                      href={routes.inventory.reservations()}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t('orders.inventory.reservations')}
                    </Link>
                  </p>
                ) : null}
                <Link
                  href={routes.inventory.movements({ kind: 'USE' })}
                  className="inline-flex font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('orders.inventory.movements')}
                </Link>
              </CardContent>
            </Card>
          ) : null}

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

          {canShare && (publicLink || canShareOrder(order.status)) ? (
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle>{t('shareLink.orderTitle')}</CardTitle>
                <CardDescription>{t('shareLink.orderHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ShareLinkPanel
                  shareAction={shareOrderLinkAction.bind(null, slug, order.id)}
                  revokeAction={revokeOrderLinkAction.bind(null, slug, order.id)}
                  unavailableHint={null}
                  link={
                    publicLink && publicUrl
                      ? {
                          url: publicUrl,
                          expiresLabel: t('shareLink.expires', {
                            date: format.dateTime(publicLink.expiresAt, {
                              dateStyle: 'long',
                              timeZone: ctx.timezone,
                            }),
                          }),
                          whatsappHref:
                            whatsappText && order.customer.phone
                              ? whatsappLink(order.customer.phone, whatsappText)
                              : null,
                        }
                      : null
                  }
                />
              </CardContent>
            </Card>
          ) : null}

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
