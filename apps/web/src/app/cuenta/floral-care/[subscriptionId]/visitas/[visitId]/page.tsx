import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { getMyCareVisitReport } from '@floral/core';
import { resolveLocale } from '@floral/domain';
import { VisitReportView } from '@/components/care/visit-report';
import { Card, CardContent } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { orNotFound } from '@/lib/care-portal';
import { accountRoutes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.report');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Il resoconto di una visita nella pagina del cliente (ADR-084): lo stesso della fioreria e del
 * link pubblico, nella lingua di chi guarda, con le foto servite solo a chi ha l'accesso.
 */
export default async function MyCareVisitPage({
  params,
}: PageProps<'/cuenta/floral-care/[subscriptionId]/visitas/[visitId]'>) {
  const { subscriptionId, visitId } = await params;
  const ctx = await getBuyerContext(accountRoutes.care.visit(subscriptionId, visitId));
  const data = await orNotFound(getMyCareVisitReport(ctx, subscriptionId, visitId));
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const { customerName: _customer, ...report } = data.report;

  return (
    <div className="space-y-6">
      <Link
        href={accountRoutes.care.contract(subscriptionId)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('account.care.backContract')}
      </Link>
      <div className="space-y-1">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">{data.shopName}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t('care.report.title')}
        </h1>
      </div>
      <Card>
        <CardContent className="pt-6">
          <VisitReportView
            report={report}
            locale={resolveLocale(locale)}
            photoSrc={(photoId, thumb) =>
              accountRoutes.care.photo(subscriptionId, photoId, { thumb })
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
