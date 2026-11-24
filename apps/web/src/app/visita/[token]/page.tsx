import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getPublicCareVisitReport } from '@floral/core';
import { BRAND, DEFAULT_LOCALE } from '@floral/domain';
import { VisitReportView } from '@/components/care/visit-report';
import { PrintButton } from '@/components/common/print-button';
import { PublicInvalidLink, PublicShell } from '@/components/public/public-shell';
import { serverEnv } from '@/lib/env';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Il resoconto di una visita di Floral Care aperto dal cliente con il link della fioreria
 * (ADR-078): cosa si è fatto, come stanno le piante, la nota e le foto, nella lingua del mercato
 * della fioreria. Senza sessione; mai prezzi, materiali né avvisi interni. Si stampa.
 */
export default async function PublicCareVisitPage({ params }: PageProps<'/visita/[token]'>) {
  const { token } = await params;
  const data = await getPublicCareVisitReport(serverEnv().BETTER_AUTH_SECRET, token);
  const locale = data?.shop.locale ?? DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: 'publicLink' });
  const footer = t('poweredBy', { brand: BRAND.productName });
  if (!data) {
    return <PublicInvalidLink title={t('invalidTitle')} body={t('invalid')} footer={footer} />;
  }
  const tr = await getTranslations({ locale, namespace: 'care.report' });
  const link = `/visita/${encodeURIComponent(token)}`;
  return (
    <PublicShell
      shopName={data.shop.name}
      logoSrc={data.shop.logoId ? `${link}/logo?v=${data.shop.logoId}` : null}
      footer={footer}
      contact={
        data.shop.phone
          ? {
              phone: data.shop.phone,
              label: t('contact'),
              text: tr('contactText', { number: data.report.numberLabel }),
            }
          : null
      }
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {tr('publicTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">{data.report.numberLabel}</p>
        </div>
        <PrintButton label={tr('print')} />
      </header>
      <VisitReportView
        report={data.report}
        locale={locale}
        photoSrc={(photoId, thumb) =>
          `${link}/foto/${encodeURIComponent(photoId)}${thumb ? '?size=thumb' : ''}`
        }
      />
    </PublicShell>
  );
}
