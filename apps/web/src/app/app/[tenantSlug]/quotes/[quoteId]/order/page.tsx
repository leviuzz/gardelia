import { ArrowLeft, Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  getCustomer,
  getQuote,
  getQuoteOrder,
  hasPermission,
  type QuoteDetailDto,
} from '@floral/core';
import { MX_REGIONS, todayInTimeZone } from '@floral/domain';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { deliveryFormOptions, savedAddressOptions } from '@/lib/delivery-options';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { createOrderFromQuoteAction } from '../../../orders/actions';
import { FulfillmentForm } from '../../../orders/order-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders.form');
  return { title: t('title') };
}

function isoDate(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** "Convertir en pedido": dati di consegna e tarjeta per un preventivo accettato (ADR-054). */
export default async function QuoteToOrderPage({
  params,
}: PageProps<'/app/[tenantSlug]/quotes/[quoteId]/order'>) {
  const { tenantSlug, quoteId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const routes = tenantRoutes(ctx.tenantSlug);
  let quote: QuoteDetailDto;
  try {
    quote = await getQuote(ctx, quoteId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  // Già convertito: si va all'ordine. Senza permesso: si torna al preventivo.
  const existing = await getQuoteOrder(ctx, quote.id);
  if (existing) redirect(routes.orders.detail(existing.id));
  if (!hasPermission(ctx, 'orders:write')) redirect(routes.quotes.detail(quote.id));

  const t = await getTranslations();
  const customer = await getCustomer(ctx, quote.customer.id);
  const defaultAddress =
    customer.addresses.find((address) => address.isDefault) ?? customer.addresses[0];
  const today = isoDate(todayInTimeZone(ctx.timezone));
  const delivery = await deliveryFormOptions(ctx);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.quotes.detail(quote.id)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      <PageHeader
        title={t('orders.form.title')}
        description={t('orders.form.subtitle', {
          number: quote.numberLabel,
          name: quote.customer.displayName,
        })}
      />
      {quote.status !== 'ACCEPTED' ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertDescription>{t('errors.conflict.quote_not_accepted')}</AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <FulfillmentForm
              action={createOrderFromQuoteAction.bind(null, ctx.tenantSlug, quote.id)}
              currency={quote.currency}
              regions={MX_REGIONS.map(({ code, name }) => ({ code, name }))}
              dateMin={today}
              submitLabel={t('orders.form.create')}
              windows={delivery.windows}
              closedWeekdays={delivery.closedWeekdays}
              distance={delivery.distance}
              addresses={savedAddressOptions(customer.addresses)}
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
      )}
    </div>
  );
}
