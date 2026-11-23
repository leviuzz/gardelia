import { Ban, Check, CircleCheck, CreditCard, Hourglass } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getPublicOrder } from '@floral/core';
import {
  BRAND,
  DEFAULT_LOCALE,
  MARKETPLACE_ORDER_LIMITS,
  MX_REGIONS,
  type OrderStatus,
} from '@floral/domain';
import { PrivateImage } from '@/components/common/private-image';
import { PublicLines, PublicTotals } from '@/components/public/public-lines';
import { LegalLinks } from '@/components/legal/legal-links';
import { PublicInvalidLink, PublicShell } from '@/components/public/public-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { serverEnv } from '@/lib/env';
import { money } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** Il cammino di un ordine fino al cliente, per modo di consegna. */
const JOURNEY: Record<'DELIVERY' | 'PICKUP', readonly OrderStatus[]> = {
  DELIVERY: ['CONFIRMED', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  PICKUP: ['CONFIRMED', 'IN_PREPARATION', 'READY', 'PICKED_UP'],
};

/**
 * Pedido aperto dal cliente con il link della fioreria (ADR-056): a che punto è, quando e dove si
 * consegna, cosa contiene, cosa resta da pagare. Mai note interne né costi.
 */
export default async function PublicOrderPage({
  params,
  searchParams,
}: PageProps<'/pedido/[token]'>) {
  const { token } = await params;
  // Appena inviato dalla tienda en línea (ADR-067).
  const justSent = (await searchParams).enviado === '1';
  const order = await getPublicOrder(serverEnv().BETTER_AUTH_SECRET, token);
  const locale = order?.shop.locale ?? DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: 'publicLink' });
  const footer = t('poweredBy', { brand: BRAND.productName });
  if (!order) {
    return <PublicInvalidLink title={t('invalidTitle')} body={t('invalid')} footer={footer} />;
  }

  const tAll = await getTranslations({ locale });
  const format = await getFormatter({ locale });
  const fmt = (minor: number) => money(minor, order.currency, locale);
  const day = format.dateTime(calendarDate(order.scheduledDate), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const when =
    order.windowStart && order.windowEnd
      ? `${day}, ${tAll('orders.window', { start: order.windowStart, end: order.windowEnd })}`
      : `${day}, ${tAll('orders.allDay').toLocaleLowerCase(locale)}`;
  const cancelled = order.status === 'CANCELLED';
  const journey = JOURNEY[order.fulfillmentMode];
  const reached = new Map(order.history.map((step) => [step.status, step.at]));
  // Indice del passo attuale nel cammino (un passo indietro di correzione conta lo stato attuale).
  const currentIndex = journey.indexOf(order.status);
  const address = order.deliveryAddress;
  const region = (code: string) => MX_REGIONS.find((item) => item.code === code)?.name ?? code;

  return (
    <PublicShell
      shopName={order.shop.name}
      footer={footer}
      legal={order.online ? <LegalLinks audience="buyer" locale={locale} /> : null}
      contact={
        order.shop.phone
          ? {
              phone: order.shop.phone,
              label: t('contact'),
              text: t('order.contactText', { number: order.numberLabel }),
            }
          : null
      }
    >
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t('order.title', { number: order.numberLabel })}
        </h1>
        <p className="text-sm first-letter:uppercase">
          {order.fulfillmentMode === 'DELIVERY'
            ? t('order.deliveryOn', { when })
            : t('order.pickupOn', { when })}
        </p>
      </header>

      {justSent && !cancelled ? (
        <Alert variant="success">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{t('order.sent', { shop: order.shop.name })}</AlertDescription>
        </Alert>
      ) : null}

      {order.status === 'PENDING_ACCEPTANCE' ? (
        <Alert variant="warning">
          <Hourglass aria-hidden="true" />
          <AlertDescription>
            {t('order.waiting', {
              shop: order.shop.name,
              days: MARKETPLACE_ORDER_LIMITS.acceptDays,
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {cancelled ? (
        <Alert variant="info">
          <Ban aria-hidden="true" />
          <AlertDescription>
            {t('order.cancelled')}
            {order.online?.cancelReason ? (
              <span className="mt-1 block">
                {t('order.cancelReason', { reason: order.online.cancelReason })}
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : (
        <ol className="grid gap-3" aria-label={t('order.progress')}>
          {journey.map((status, index) => {
            const done = currentIndex >= index;
            const at = reached.get(status);
            return (
              <li key={status} className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs',
                    done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground',
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="size-4" /> : index + 1}
                </span>
                <span
                  className={cn('min-w-0 flex-1', done ? 'font-medium' : 'text-muted-foreground')}
                >
                  {tAll(`orders.statuses.${status}`)}
                  {index === currentIndex ? (
                    <span className="sr-only"> · {t('order.current')}</span>
                  ) : null}
                </span>
                {done && at ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {format.dateTime(at, {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: order.shop.timezone,
                    })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {order.online &&
      !cancelled &&
      order.status !== 'PENDING_ACCEPTANCE' &&
      order.balanceMinor > 0 ? (
        <section className="space-y-2 rounded-2xl border bg-card p-4 text-sm">
          <h2 className="flex items-center gap-2 font-medium">
            <CreditCard className="size-4 text-primary" aria-hidden="true" />
            {t('order.howToPay')}
          </h2>
          <p>
            {order.online.paymentMethods.length > 0
              ? t('order.payWith', {
                  methods: order.online.paymentMethods
                    .map((method) => tAll(`publicStore.payment.${method}`))
                    .join(', '),
                })
              : t('order.payAsk')}
          </p>
          {order.online.paymentInstructions ? (
            <p className="whitespace-pre-line text-muted-foreground">
              {order.online.paymentInstructions}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('order.payDirect')}</p>
        </section>
      ) : null}

      {order.photoId || order.receivedBy ? (
        <section className="space-y-3">
          {order.photoId ? (
            <figure className="space-y-2">
              <a
                href={`/pedido/${encodeURIComponent(token)}/foto?v=${order.photoId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <PrivateImage
                  src={`/pedido/${encodeURIComponent(token)}/foto?size=thumb&v=${order.photoId}`}
                  alt={t('order.photoAlt')}
                  className="aspect-square w-full max-w-xs rounded-2xl border bg-muted object-cover"
                />
              </a>
              <figcaption className="text-sm font-medium">{t('order.photoCaption')}</figcaption>
            </figure>
          ) : null}
          {order.receivedBy ? (
            <p className="text-sm">{t('order.receivedBy', { name: order.receivedBy })}</p>
          ) : null}
        </section>
      ) : null}

      {address ? (
        <section className="space-y-1 text-sm">
          <h2 className="font-medium">{t('order.deliverTo')}</h2>
          <p>
            {address.addressLine1}
            {address.addressLine2 ? `, ${address.addressLine2}` : ''}
          </p>
          <p className="text-muted-foreground">
            {[address.neighborhood, address.postalCode, address.city, region(address.region)]
              .filter(Boolean)
              .join(', ')}
          </p>
          {order.recipientName ? (
            <p>{t('order.recipient', { name: order.recipientName })}</p>
          ) : null}
        </section>
      ) : null}

      {order.cardMessage ? (
        <section className="space-y-2 text-sm">
          <h2 className="font-medium">{t('order.card')}</h2>
          <p className="rounded-xl bg-muted/50 p-4 whitespace-pre-line italic">
            {order.cardMessage}
          </p>
          <p className="text-muted-foreground">
            {order.cardAnonymous
              ? t('order.anonymous')
              : order.cardSignature
                ? t('order.signedBy', { name: order.cardSignature })
                : null}
          </p>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="font-medium">{t('order.contents')}</h2>
        <PublicLines
          lines={order.lines.map((line) => ({
            id: line.id,
            description: line.description,
            quantityLabel: `${line.quantity} × ${fmt(line.unitPriceMinor)}`,
            totalLabel: fmt(line.lineTotalMinor),
            recipe: null,
            imageUrl: line.hasImage
              ? `/pedido/${encodeURIComponent(token)}/imagen/${line.id}`
              : null,
            imageAlt: t('imageAlt', { name: line.description }),
          }))}
        />
        <PublicTotals
          rows={[
            { label: t('subtotal'), value: fmt(order.subtotalMinor) },
            ...(order.discountMinor > 0
              ? [{ label: t('discount'), value: `−${fmt(order.discountMinor)}` }]
              : []),
            ...(order.deliveryFeeMinor > 0
              ? [{ label: t('order.deliveryFee'), value: fmt(order.deliveryFeeMinor) }]
              : []),
            { label: t('total'), value: fmt(order.totalMinor), strong: true },
            ...(order.paidMinor > 0
              ? [{ label: t('order.paid'), value: fmt(order.paidMinor) }]
              : []),
            // In attesa di accettazione non si paga ancora: niente "Por pagar".
            ...(cancelled || order.status === 'PENDING_ACCEPTANCE'
              ? []
              : [{ label: t('order.balance'), value: fmt(order.balanceMinor) }]),
          ]}
        />
      </section>
    </PublicShell>
  );
}
