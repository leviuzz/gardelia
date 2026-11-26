import { CircleCheck, Hourglass, MessageSquare } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getPublicOrder } from '@floral/core';
import { BRAND, DEFAULT_LOCALE, MARKETPLACE_ORDER_LIMITS } from '@floral/domain';
import { LegalLinks } from '@/components/legal/legal-links';
import { OrderTracking } from '@/components/public/order-tracking';
import { PublicInvalidLink, PublicShell } from '@/components/public/public-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { serverEnv } from '@/lib/env';
import { calendarDate } from '@/lib/quote-ui';
import { accountRoutes } from '@/lib/routes';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Pedido aperto dal cliente con il link della fioreria (ADR-056): a che punto è, quando e dove si
 * consegna, cosa contiene, cosa resta da pagare. Mai note interne né costi. Il link si può
 * inoltrare: i messaggi con la fioreria stanno solo nel conto di chi ha fatto l'ordine (M3), qui
 * c'è il rimando.
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
  const base = `/pedido/${encodeURIComponent(token)}`;

  return (
    <PublicShell
      shopName={order.shop.name}
      logoSrc={order.shop.logoId ? `${base}/logo?v=${order.shop.logoId}` : null}
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

      {order.status === 'PENDING_ACCEPTANCE' && order.online?.changesToConfirm ? (
        // M3-2: i cambi si confermano solo dal conto di chi ha fatto l'ordine, non da questo link.
        <Alert variant="warning" data-testid="changes-to-confirm">
          <Hourglass aria-hidden="true" />
          <AlertDescription>
            {t('order.changesToConfirm', { shop: order.shop.name })}{' '}
            <Link href={accountRoutes.orders.list} className="font-medium underline">
              {t('order.openAccount')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : order.status === 'PENDING_ACCEPTANCE' ? (
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

      <OrderTracking
        order={order}
        locale={locale}
        urls={{
          photo: ({ thumb, v }) => `${base}/foto?${thumb ? 'size=thumb&' : ''}v=${v}`,
          line: (lineId) => `${base}/imagen/${lineId}`,
        }}
      />

      {/* Ordine online (M3): chi l'ha fatto scrive alla fioreria dal suo conto. */}
      {order.online ? (
        <p
          className="flex items-start gap-2 rounded-2xl border bg-card p-4 text-sm"
          data-testid="write-from-account"
        >
          <MessageSquare className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            {t('order.writeFromAccount', { shop: order.shop.name })}{' '}
            <Link href={accountRoutes.orders.list} className="font-medium text-primary underline">
              {t('order.openAccount')}
            </Link>
          </span>
        </p>
      ) : null}
    </PublicShell>
  );
}
