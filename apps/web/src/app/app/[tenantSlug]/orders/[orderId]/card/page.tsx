import { ArrowLeft, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { NotFoundError, getOrder } from '@floral/core';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { PrintOrderButton } from '../print-button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders.cardPrint');
  return { title: t('title') };
}

/**
 * Tarjeta da stampare (ADR-056): solo il messaggio e la firma, nel formato di un biglietto da
 * ritagliare (10 × 7 cm) con la linea di taglio. Il testo è quello dell'ordine, nella lingua in
 * cui l'ha scritto il cliente.
 */
export default async function OrderCardPage({
  params,
}: PageProps<'/app/[tenantSlug]/orders/[orderId]/card'>) {
  const { tenantSlug, orderId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const routes = tenantRoutes(ctx.tenantSlug);
  let order;
  try {
    order = await getOrder(ctx, orderId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const t = await getTranslations();
  const signature = order.cardAnonymous ? null : order.cardSignature;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.orders.detail(order.id)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      <div className="print:hidden">
        <PageHeader
          title={t('orders.cardPrint.title')}
          description={t('orders.cardPrint.subtitle', { number: order.numberLabel })}
          actions={
            order.cardMessage ? (
              <PrintOrderButton label={t('orders.cardPrint.print')} icon={<Printer />} />
            ) : null
          }
        />
      </div>

      {order.cardMessage ? (
        <>
          {/* 10 × 7 cm con la linea di taglio tratteggiata; a schermo è un'anteprima. */}
          <div className="flex justify-center print:block">
            <div
              data-testid="printed-card"
              className="flex h-[7cm] w-[10cm] max-w-full flex-col justify-center gap-4 border border-dashed border-muted-foreground/60 bg-card px-[0.8cm] py-[0.6cm] text-center"
            >
              <p className="font-display text-lg leading-snug whitespace-pre-line italic">
                {order.cardMessage}
              </p>
              {signature ? <p className="text-base font-medium">— {signature}</p> : null}
            </div>
          </div>
          <p className="text-center text-sm text-muted-foreground print:hidden">
            {t('orders.cardPrint.hint')}
          </p>
        </>
      ) : (
        <Alert variant="info">
          <AlertDescription>{t('orders.cardPrint.empty')}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
