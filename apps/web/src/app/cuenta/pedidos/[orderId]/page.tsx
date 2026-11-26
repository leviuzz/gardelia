import { ArrowLeft, Hourglass, Info, Link2, RotateCcw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { getBuyerOrder } from '@floral/core';
import { orderMessagePages, pendingOrderDeadlineShown, resolveLocale } from '@floral/domain';
import { BuyerOrderChangeCard } from '@/components/account/buyer-order-change-card';
import { BuyerOrderMessagesCard } from '@/components/account/buyer-order-messages-card';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { PrivateImage } from '@/components/common/private-image';
import { OrderTracking } from '@/components/public/order-tracking';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { orNotFound } from '@/lib/care-portal';
import { serverEnv } from '@/lib/env';
import { ORDER_STATUS_BADGE } from '@/lib/order-ui';
import { calendarDate } from '@/lib/quote-ui';
import { accountRoutes, publicStoreRoutes } from '@/lib/routes';
import { cancelBuyerOrderAction } from '../../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.orderPage');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Un ordine online nel conto di chi l'ha fatto (M3, ADR-088): i passi con l'ora, come pagare dopo
 * l'accettazione, la consegna, la tarjeta e i prodotti (come nel link di stato), i messaggi con la
 * fioreria, «Annulla l'ordine» finché è da accettare e «Pedir de nuevo» quando è chiuso. Nella
 * lingua della persona; i testi della fioreria restano come sono scritti. L'ordine di un altro
 * risponde 404.
 */
export default async function BuyerOrderPage({
  params,
  searchParams,
}: PageProps<'/cuenta/pedidos/[orderId]'>) {
  const { orderId } = await params;
  const query = await searchParams;
  const ctx = await getBuyerContext(accountRoutes.orders.detail(orderId));
  const pages = orderMessagePages(query.mensajes);
  const detail = await orNotFound(
    getBuyerOrder(ctx, orderId, { secret: serverEnv().BETTER_AUTH_SECRET, pages }),
  );
  const { order, shop } = detail;
  const locale = resolveLocale(await getLocale());
  const t = await getTranslations();
  const format = await getFormatter();
  const day = format.dateTime(calendarDate(order.scheduledDate), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const when =
    order.windowStart && order.windowEnd
      ? `${day}, ${t('orders.window', { start: order.windowStart, end: order.windowEnd })}`
      : `${day}, ${t('orders.allDay').toLocaleLowerCase(locale)}`;
  const store = publicStoreRoutes(shop.slug);
  const deadlineLabel = detail.deadline
    ? format.dateTime(pendingOrderDeadlineShown(detail.deadline), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: shop.timezone,
      })
    : null;
  // M3-2: la fioreria aspetta la risposta della persona, l'ha avuta («No, gracias») o ha ritirato la
  // richiesta cambiando ancora l'ordine.
  const change = detail.change;
  const changeAsked = change?.status === 'ASKED';

  return (
    <div className="space-y-6">
      <Link
        href={accountRoutes.orders.list}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('account.orders.title')}
      </Link>

      <div className="flex items-start gap-3">
        {shop.logoId ? (
          <PrivateImage
            src={accountRoutes.orders.logo(orderId, shop.logoId)}
            alt=""
            className="size-12 shrink-0 rounded-xl border bg-card object-cover"
          />
        ) : null}
        <div className="min-w-0 space-y-2">
          <Link
            href={store.home}
            className="text-sm font-medium tracking-wide break-words text-primary uppercase hover:underline"
          >
            {shop.name}
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t('account.orderPage.title', { number: order.numberLabel })}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="first-letter:uppercase">
              {order.fulfillmentMode === 'DELIVERY'
                ? t('publicLink.order.deliveryOn', { when })
                : t('publicLink.order.pickupOn', { when })}
            </span>
            {/* M3-2: mentre la fioreria aspetta la sua risposta, la persona vede cosa deve fare. */}
            {changeAsked ? (
              <Badge variant="warning">{t('account.orders.changesToConfirm')}</Badge>
            ) : (
              <Badge variant={ORDER_STATUS_BADGE[order.status]}>
                {t(`account.orders.statuses.${order.status}`)}
              </Badge>
            )}
          </p>
        </div>
      </div>

      {query.repetir === 'no' ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertDescription>{t('account.orderPage.reorderUnavailable')}</AlertDescription>
        </Alert>
      ) : null}

      {detail.canCancel ? (
        <Alert variant="warning" data-testid="buyer-order-waiting">
          <Hourglass aria-hidden="true" />
          <AlertDescription className="space-y-3">
            <p>
              {changeAsked
                ? t('account.orderPage.changes.waiting', { shop: shop.name })
                : deadlineLabel
                  ? t('account.orderPage.waiting', { shop: shop.name, date: deadlineLabel })
                  : t('account.orderPage.waitingNoDate', { shop: shop.name })}
            </p>
            {change?.status === 'DECLINED' ? (
              <p data-testid="buyer-order-change-declined">
                {t('account.orderPage.changes.declinedNote', { shop: shop.name })}
              </p>
            ) : change?.status === 'EDITING' && change.askedAt ? (
              <p data-testid="buyer-order-change-withdrawn">
                {t('account.orderPage.changes.withdrawnNote', { shop: shop.name })}
              </p>
            ) : null}
            <ConfirmActionDialog
              action={cancelBuyerOrderAction.bind(null, orderId)}
              trigger={
                <Button variant="outline" size="sm">
                  {t('account.orders.cancel')}
                </Button>
              }
              title={t('account.orders.cancelTitle', { number: order.numberLabel })}
              description={t('account.orders.cancelBody', { shop: shop.name })}
              confirmLabel={t('account.orders.cancelConfirm')}
            />
          </AlertDescription>
        </Alert>
      ) : null}

      <BuyerOrderChangeCard detail={detail} locale={locale} deadlineLabel={deadlineLabel} />

      <OrderTracking
        order={order}
        locale={locale}
        urls={{
          photo: ({ thumb, v }) => accountRoutes.orders.photo(orderId, { thumb, v }),
          line: (lineId) => accountRoutes.orders.lineImage(orderId, lineId),
        }}
      />

      <BuyerOrderMessagesCard detail={detail} pages={pages} timeZone={shop.timezone} />

      {detail.canReorder ? (
        <Card data-testid="buyer-reorder">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <p className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">
              {t('account.orderPage.reorderBody', { shop: shop.name })}
            </p>
            {/* Una rotta della vetrina: il carrello della fioreria vale solo lì (M3). */}
            <form method="post" action={store.reorder}>
              <input type="hidden" name="orderId" value={orderId} />
              <Button type="submit" variant="outline">
                <RotateCcw />
                {t('account.orderPage.reorder')}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {detail.trackingPath ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Link2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {t('account.orderPage.trackingHint')}{' '}
            <Link href={detail.trackingPath} className="font-medium text-primary underline">
              {t('account.orderPage.trackingLink')}
            </Link>
          </span>
        </p>
      ) : null}
    </div>
  );
}
