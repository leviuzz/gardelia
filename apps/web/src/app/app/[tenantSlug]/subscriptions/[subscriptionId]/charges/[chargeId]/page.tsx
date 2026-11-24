import { ArrowLeft, Receipt } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  getCareCharge,
  getLetterhead,
  hasPermission,
  type CareChargeDetailDto,
  type TenantContext,
} from '@floral/core';
import { getMarket, minorToDecimalString, todayInTimeZone, toIsoDate } from '@floral/domain';
import { ChargeLines } from '@/components/care/charge-document';
import { ChargeStatusBadge } from '@/components/care/charge-ui';
import { CarePaymentDialog, ReverseCarePaymentButton } from '@/components/care/payment-forms';
import { PrintButton } from '@/components/common/print-button';
import { PrintLetterhead } from '@/components/common/print-letterhead';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import {
  recordCareChargePaymentAction,
  refundCareChargeAction,
  reverseCarePaymentAction,
} from '../../../charges/actions';

async function loadCharge(
  ctx: TenantContext,
  subscriptionId: string,
  chargeId: string,
): Promise<CareChargeDetailDto> {
  try {
    return await getCareCharge(ctx, subscriptionId, chargeId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/subscriptions/[subscriptionId]/charges/[chargeId]'>): Promise<Metadata> {
  const { tenantSlug, subscriptionId, chargeId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations('care.charges');
  if (!hasPermission(ctx, 'subscriptions:payments')) return { title: t('title') };
  const charge = await loadCharge(ctx, subscriptionId, chargeId);
  return { title: `${charge.numberLabel} · ${charge.customer.name}` };
}

/**
 * Un cargo di Floral Care (ADR-079): le righe (le visite del mese insieme, poi crediti, debiti ed
 * extra dei mesi prima), i pagamenti con "Anular", "Registrar pago" o, per il cargo finale a favore
 * del cliente, "Registrar devolución". Si stampa con l'intestazione della fioreria, nella lingua
 * del suo mercato. Lo vede chi gestisce i soldi.
 */
export default async function CareChargePage({
  params,
}: PageProps<'/app/[tenantSlug]/subscriptions/[subscriptionId]/charges/[chargeId]'>) {
  const { tenantSlug, subscriptionId, chargeId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:payments')) return <Forbidden />;
  const charge = await loadCharge(ctx, subscriptionId, chargeId);
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const shopLocale = getMarket(ctx.country).defaultLocale;
  const [t, format, tShop, formatShop, letterhead] = await Promise.all([
    getTranslations(),
    getFormatter(),
    getTranslations({ locale: shopLocale }),
    getFormatter({ locale: shopLocale }),
    getLetterhead(ctx),
  ]);
  const currency = charge.currency;
  const price = (minor: number) => money(minor, currency);
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const month = (iso: string, using = format) =>
    using.dateTime(new Date(`${iso}T12:00:00Z`), {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const today = toIsoDate(todayInTimeZone(ctx.timezone));
  // Il contratto è nella valuta della fioreria: la proposta del modulo è nel suo formato.
  const decimals = (minor: number) => minorToDecimalString(minor, ctx.currency);
  const overdue = charge.status === 'OVERDUE';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3 print:hidden">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={routes.subscriptions.detail(charge.subscription.id)}>
            <ArrowLeft aria-hidden="true" />
            {t('care.charge.back')}
          </Link>
        </Button>
        <PageHeader
          title={t('care.charge.title', { number: charge.numberLabel })}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <ChargeStatusBadge status={charge.status} />
              <span>
                {t('care.charge.of', {
                  month: month(charge.period),
                  contract: charge.subscription.numberLabel,
                })}
              </span>
              <Link
                href={routes.customers.detail(charge.customer.id)}
                className="font-medium hover:underline"
              >
                {charge.customer.name}
              </Link>
            </span>
          }
          actions={
            <>
              <PrintButton label={t('care.charge.print')} />
              <Button asChild variant="outline">
                <Link href={routes.customers.statement(charge.customer.id)}>
                  <Receipt />
                  {t('care.charge.statement')}
                </Link>
              </Button>
            </>
          }
        />
      </div>

      {/* Il documento per il cliente: solo in stampa / PDF, nella lingua del mercato. */}
      <div className="hidden space-y-4 print:block">
        <PrintLetterhead
          letterhead={letterhead}
          logoSrc={letterhead.logoId ? routes.settings.storeImage('LOGO', letterhead.logoId) : null}
          locale={shopLocale}
        />
        <div className="space-y-1 border-b pb-4 text-sm">
          <p className="text-lg font-medium">
            {tShop('care.charge.printHeader', { number: charge.numberLabel })} ·{' '}
            {month(charge.period, formatShop)}
          </p>
          <p>{tShop('care.charge.printFor', { name: charge.customer.name })}</p>
          {charge.subscription.addressLine ? (
            <p>
              {tShop('care.charge.printSite', {
                address: [charge.subscription.addressLine, charge.subscription.city]
                  .filter(Boolean)
                  .join(', '),
              })}
            </p>
          ) : null}
          <p>
            {tShop('care.charge.printDate', {
              date: formatShop.dateTime(new Date(`${charge.issuedOn}T12:00:00Z`), {
                dateStyle: 'long',
                timeZone: 'UTC',
              }),
            })}{' '}
            ·{' '}
            {tShop('care.charge.due', {
              date: formatShop.dateTime(new Date(`${charge.dueDate}T12:00:00Z`), {
                dateStyle: 'long',
                timeZone: 'UTC',
              }),
            })}
          </p>
        </div>
        <ChargeLines charge={charge} locale={shopLocale} />
        <p className="border-t pt-4 text-xs text-muted-foreground">
          {tShop('care.charge.printFooter', { currency })}
        </p>
      </div>

      <div className="grid gap-6 print:hidden">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{t('care.charge.linesTitle')}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('care.charge.issued', { date: day(charge.issuedOn) })} ·{' '}
                <span className={cn(overdue && 'font-medium text-[oklch(0.45_0.17_27)]')}>
                  {t('care.charge.due', { date: day(charge.dueDate) })}
                </span>
              </p>
            </div>
            {charge.canPay ? (
              <CarePaymentDialog
                action={recordCareChargePaymentAction.bind(
                  null,
                  slug,
                  charge.subscription.id,
                  charge.id,
                )}
                mode="charge"
                idPrefix="charge-pay"
                currency={currency}
                today={today}
                amountLabel={price(charge.balanceMinor)}
                defaultAmount={decimals(charge.balanceMinor)}
              />
            ) : null}
            {charge.canRefund ? (
              <CarePaymentDialog
                action={refundCareChargeAction.bind(null, slug, charge.subscription.id, charge.id)}
                mode="refund"
                idPrefix="charge-refund"
                currency={currency}
                today={today}
                amountLabel={price(-charge.balanceMinor)}
                defaultAmount={decimals(-charge.balanceMinor)}
              />
            ) : null}
          </CardHeader>
          <CardContent>
            <ChargeLines charge={charge} locale={ctx.locale} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('care.charge.paymentsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {charge.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('care.charge.noPayments')}</p>
            ) : (
              <ul className="divide-y rounded-xl border text-sm">
                {charge.payments.map((payment) => {
                  const reversible =
                    !payment.reversed &&
                    payment.kind !== 'REVERSAL' &&
                    payment.status === 'RECORDED';
                  return (
                    <li
                      key={payment.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium">
                          {t(`care.payment.kinds.${payment.kind}`)} ·{' '}
                          {t(`orders.methods.${payment.method}`)}
                          {payment.reversed ? (
                            <Badge variant="muted" className="ml-2 align-middle">
                              {t('care.payment.reversedBadge')}
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            day(payment.paidOn),
                            payment.reference,
                            payment.createdByName
                              ? t('care.payment.by', { name: payment.createdByName })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {payment.chargeCount > 1 ? (
                          <p className="text-xs text-muted-foreground">
                            {t('care.payment.split', {
                              amount: price(Math.abs(payment.paymentAmountMinor)),
                              count: payment.chargeCount,
                            })}
                          </p>
                        ) : null}
                        {payment.note ? (
                          <p className="text-xs whitespace-pre-line">{payment.note}</p>
                        ) : null}
                      </div>
                      <span className="flex items-center gap-1">
                        <span
                          className={cn(
                            'font-semibold tabular-nums',
                            payment.amountMinor < 0 && 'text-muted-foreground',
                          )}
                        >
                          {price(payment.amountMinor)}
                        </span>
                        {reversible ? (
                          <ReverseCarePaymentButton
                            action={reverseCarePaymentAction.bind(null, slug, payment.id)}
                            label={t('care.payment.reverseLabel', {
                              amount: price(payment.amountMinor),
                            })}
                            chargeCount={payment.chargeCount}
                          />
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
