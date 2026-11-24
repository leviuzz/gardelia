import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  getCustomerCareStatement,
  getLetterhead,
  hasPermission,
  type CareStatementDto,
  type TenantContext,
} from '@floral/core';
import { getMarket, minorToDecimalString, todayInTimeZone, toIsoDate } from '@floral/domain';
import { ContractStatusBadge } from '@/components/care/care-ui';
import { ChargeStatusBadge } from '@/components/care/charge-ui';
import { CarePaymentDialog, ReverseCarePaymentButton } from '@/components/care/payment-forms';
import { PrintButton } from '@/components/common/print-button';
import { PrintLetterhead } from '@/components/common/print-letterhead';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import {
  recordCustomerCarePaymentAction,
  reverseCarePaymentAction,
} from '../../../subscriptions/charges/actions';

async function loadStatement(ctx: TenantContext, customerId: string): Promise<CareStatementDto> {
  try {
    return await getCustomerCareStatement(ctx, customerId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/customers/[customerId]/statement'>): Promise<Metadata> {
  const { tenantSlug, customerId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations('care.statement');
  if (!hasPermission(ctx, 'subscriptions:payments')) return { title: t('title') };
  const statement = await loadStatement(ctx, customerId);
  return { title: `${t('title')} · ${statement.customer.name}` };
}

/**
 * Estado de cuenta di Floral Care di un cliente (ADR-082): tutte le sue sedi, i cargos con lo
 * stato, i pagamenti e i totali. "Registrar pago" qui è un solo pagamento per tutte le sedi, che
 * va prima ai cargos più vecchi (decisione del founder del 24/11). Si stampa per il cliente, nella
 * lingua del mercato della fioreria.
 */
export default async function CareStatementPage({
  params,
}: PageProps<'/app/[tenantSlug]/customers/[customerId]/statement'>) {
  const { tenantSlug, customerId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:payments')) return <Forbidden />;
  const statement = await loadStatement(ctx, customerId);
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
  const currency = statement.currency;
  const today = toIsoDate(todayInTimeZone(ctx.timezone));

  /** Le tabelle: sullo schermo (con link e azioni) e in stampa (nella lingua del mercato). */
  const tables = (print: boolean) => {
    const tt = print ? tShop : t;
    const fmt = print ? formatShop : format;
    const locale = print ? shopLocale : ctx.locale;
    const price = (minor: number) => money(minor, currency, locale);
    const month = (iso: string) =>
      fmt.dateTime(new Date(`${iso}T12:00:00Z`), {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
    const day = (iso: string) =>
      fmt.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
    return (
      <>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-3">
            <dt className="text-xs text-muted-foreground">{tt('care.statement.open')}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {price(statement.totals.openMinor)}
            </dd>
          </div>
          <div className="rounded-xl border p-3">
            <dt className="text-xs text-muted-foreground">{tt('care.statement.overdue')}</dt>
            <dd
              className={cn(
                'text-lg font-semibold tabular-nums',
                statement.totals.overdueMinor > 0 && 'text-[oklch(0.45_0.17_27)]',
              )}
            >
              {price(statement.totals.overdueMinor)}
            </dd>
          </div>
          {statement.totals.creditMinor > 0 ? (
            <div className="rounded-xl border p-3">
              <dt className="text-xs text-muted-foreground">{tt('care.statement.credit')}</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {price(statement.totals.creditMinor)}
              </dd>
            </div>
          ) : null}
        </dl>

        <section className="space-y-2">
          <h2 className="font-semibold">{tt('care.statement.sitesTitle')}</h2>
          <ul className="divide-y rounded-xl border text-sm">
            {statement.contracts.map((contract) => (
              <li key={contract.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                {print ? (
                  <span className="min-w-0">
                    <span className="tabular-nums">{contract.numberLabel}</span>
                    {contract.addressLine ? ` · ${contract.addressLine}` : ''}
                  </span>
                ) : (
                  <Link
                    href={routes.subscriptions.detail(contract.id)}
                    className="min-w-0 hover:underline"
                  >
                    <span className="font-medium tabular-nums">{contract.numberLabel}</span>
                    {contract.addressLine ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {contract.addressLine}
                      </span>
                    ) : null}
                  </Link>
                )}
                {print ? null : <ContractStatusBadge status={contract.status} />}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">{tt('care.statement.chargesTitle')}</h2>
          {statement.charges.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tt('care.statement.noCharges')}</p>
          ) : (
            <ul className="divide-y rounded-xl border text-sm">
              {statement.charges.map((charge) => (
                <li
                  key={charge.id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    {print ? (
                      <p className="font-medium tabular-nums">{charge.numberLabel}</p>
                    ) : (
                      <Link
                        href={routes.subscriptions.charge(charge.subscriptionId, charge.id)}
                        className="font-medium tabular-nums hover:underline"
                      >
                        {charge.numberLabel}
                      </Link>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {[month(charge.period), charge.contractLabel, charge.addressLine]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {charge.balanceMinor > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {tt('care.charges.dueOn', { date: day(charge.dueDate) })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {print ? (
                      <span className="text-xs">{tt(`care.chargeStatus.${charge.status}`)}</span>
                    ) : (
                      <ChargeStatusBadge status={charge.status} />
                    )}
                    <span className="tabular-nums">
                      {price(charge.totalMinor)}
                      {charge.balanceMinor !== 0 && charge.balanceMinor !== charge.totalMinor
                        ? ` · ${
                            charge.balanceMinor > 0
                              ? tt('care.charges.balance', { amount: price(charge.balanceMinor) })
                              : tt('care.charges.inFavor', {
                                  amount: price(-charge.balanceMinor),
                                })
                          }`
                        : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {tt('care.statement.since', { month: month(statement.since) })}
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">{tt('care.statement.paymentsTitle')}</h2>
          {statement.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tt('care.statement.noPayments')}</p>
          ) : (
            <ul className="divide-y rounded-xl border text-sm">
              {statement.payments.map((payment) => {
                const reversible =
                  !print &&
                  !payment.reversed &&
                  payment.kind !== 'REVERSAL' &&
                  payment.status === 'RECORDED';
                return (
                  <li
                    key={payment.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">
                        {tt(`care.payment.kinds.${payment.kind}`)} ·{' '}
                        {tt(`orders.methods.${payment.method}`)}
                        {payment.reversed ? (
                          <Badge variant="muted" className="ml-2 align-middle">
                            {tt('care.payment.reversedBadge')}
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[day(payment.paidOn), print ? null : payment.reference]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {payment.charges
                          .map((charge) => `${charge.numberLabel} ${price(charge.amountMinor)}`)
                          .join(' · ')}
                      </p>
                    </div>
                    <span className="flex items-center gap-1">
                      <span className="font-semibold tabular-nums">
                        {price(payment.amountMinor)}
                      </span>
                      {reversible ? (
                        <ReverseCarePaymentButton
                          action={reverseCarePaymentAction.bind(null, slug, payment.id)}
                          label={t('care.payment.reverseLabel', {
                            amount: price(payment.amountMinor),
                          })}
                          chargeCount={payment.charges.length}
                        />
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </>
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3 print:hidden">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={routes.customers.detail(statement.customer.id)}>
            <ArrowLeft aria-hidden="true" />
            {t('care.statement.back')}
          </Link>
        </Button>
        <PageHeader
          title={t('care.statement.title')}
          description={t('care.statement.subtitle', { name: statement.customer.name })}
          actions={
            <>
              <PrintButton label={t('care.charge.print')} />
              {statement.totals.openMinor > 0 ? (
                <CarePaymentDialog
                  action={recordCustomerCarePaymentAction.bind(null, slug, statement.customer.id)}
                  mode="statement"
                  idPrefix="statement-pay"
                  currency={currency}
                  today={today}
                  amountLabel={money(statement.totals.openMinor, currency)}
                  defaultAmount={minorToDecimalString(statement.totals.openMinor, ctx.currency)}
                />
              ) : null}
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
          <p className="text-lg font-medium">{tShop('care.statement.printHeader')}</p>
          <p>{tShop('care.statement.printFor', { name: statement.customer.name })}</p>
          <p>
            {tShop('care.statement.printDate', {
              date: formatShop.dateTime(new Date(`${today}T12:00:00Z`), {
                dateStyle: 'long',
                timeZone: 'UTC',
              }),
            })}
          </p>
        </div>
        {tables(true)}
        <p className="border-t pt-4 text-xs text-muted-foreground">
          {tShop('care.charge.taxNote')} {tShop('care.charge.printFooter', { currency })}
        </p>
      </div>

      <Card className="print:hidden">
        <CardContent className="space-y-6 pt-6">{tables(false)}</CardContent>
      </Card>
    </div>
  );
}
