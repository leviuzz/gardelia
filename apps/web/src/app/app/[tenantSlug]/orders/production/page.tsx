import { ArrowLeft, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getOrdersDay } from '@floral/core';
import { PageHeader } from '@/components/page-header';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { PrintOrderButton } from '../[orderId]/print-button';
import { ProductionList } from '../production-list';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders.production');
  return { title: t('title') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Producción del día da stampare (ADR-057): la lista per il mercato e per il banco. */
export default async function ProductionPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/orders/production'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const view = await getOrdersDay(ctx, single(raw.date));
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const longDate = format.dateTime(calendarDate(view.date), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={routes.orders.day({ date: view.date })}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      <PageHeader
        title={t('orders.production.title')}
        description={
          <span className="inline-block first-letter:uppercase">
            {ctx.tenantName} · {longDate}
          </span>
        }
        actions={<PrintOrderButton label={t('orders.production.printNow')} icon={<Printer />} />}
      />
      <p className="text-sm">
        {t('orders.production.summary', {
          bouquets: view.production.bouquets,
          orders: view.productionOrders,
        })}
      </p>
      <ProductionList production={view.production} />
    </div>
  );
}
