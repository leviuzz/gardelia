import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { getMyCareCharge } from '@floral/core';
import { ChargeLines } from '@/components/care/charge-document';
import { ChargeStatusBadge } from '@/components/care/charge-ui';
import { Card, CardContent } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { orNotFound } from '@/lib/care-portal';
import { calendarDate } from '@/lib/quote-ui';
import { accountRoutes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.care');
  return { title: t('chargesTitle'), robots: { index: false, follow: false } };
}

/**
 * Un cargo del servizio visto dal cliente (ADR-084): il mese, la scadenza, le righe e il saldo.
 * Solo con "Puede ver precios y cobros"; i pagamenti si registrano alla fioreria.
 */
export default async function MyCareChargePage({
  params,
}: PageProps<'/cuenta/floral-care/[subscriptionId]/cargos/[chargeId]'>) {
  const { subscriptionId, chargeId } = await params;
  const ctx = await getBuyerContext(accountRoutes.care.charge(subscriptionId, chargeId));
  const charge = await orNotFound(getMyCareCharge(ctx, subscriptionId, chargeId));
  const [t, format, locale] = await Promise.all([getTranslations(), getFormatter(), getLocale()]);
  const day = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const month = format.dateTime(calendarDate(charge.period), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="space-y-6">
      <Link
        href={accountRoutes.care.contract(subscriptionId)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('account.care.backContract')}
      </Link>
      <div className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">
          {charge.shopName}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight first-letter:uppercase">
          {month}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {charge.numberLabel} · {charge.contractLabel}
          </span>
          <ChargeStatusBadge status={charge.status} />
        </p>
      </div>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{t('care.charge.issued', { date: day(charge.issuedOn) })}</span>
            <span>{t('care.charge.due', { date: day(charge.dueDate) })}</span>
          </p>
          <ChargeLines charge={charge} locale={locale} />
          <p className="text-sm text-muted-foreground">{t('account.care.payHint')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
