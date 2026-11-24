import { ArrowLeft, ClipboardList, Info, MessageCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { cache } from 'react';
import {
  getLetterhead,
  NotFoundError,
  getQuote,
  getPublicLink,
  getQuoteOrder,
  hasPermission,
  publicLinkUrl,
  listQuotableItems,
  type QuoteDetailDto,
  type TenantContext,
} from '@floral/core';
import {
  QUOTE_LIMITS,
  canShareQuote,
  getMarket,
  minorToDecimalString,
  todayInTimeZone,
  whatsappLink,
} from '@floral/domain';
import { QuoteStatusBadge } from '@/components/common/status-badges';
import { PrintLetterhead } from '@/components/common/print-letterhead';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ShareLinkPanel } from '@/components/common/share-link-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { serverEnv } from '@/lib/env';
import { money, phoneForInput } from '@/lib/format';
import { lineFormatters, lineWarning } from '@/lib/line-ui';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  addCatalogLineAction,
  addCustomLineAction,
  changeStatusAction,
  removeLineAction,
  revokeQuoteLinkAction,
  shareQuoteLinkAction,
  updateDetailsAction,
  updateLineQuantityAction,
} from '../actions';
import { PrintButton, QuoteDetailsForm, QuoteStatusActions } from './quote-controls';
import { QuoteLineComposer, QuoteLineList, type QuoteLineView } from './quote-lines';

/** Una sola lettura per richiesta (metadata + pagina condividono il risultato). */
const loadQuote = cache(async (ctx: TenantContext, quoteId: string): Promise<QuoteDetailDto> => {
  try {
    return await getQuote(ctx, quoteId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
});

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/quotes/[quoteId]'>): Promise<Metadata> {
  const { tenantSlug, quoteId } = await params;
  const quote = await loadQuote(await getTenantContext(tenantSlug), quoteId);
  return { title: quote.numberLabel };
}

function isoDate(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export default async function QuotePage({
  params,
}: PageProps<'/app/[tenantSlug]/quotes/[quoteId]'>) {
  const { tenantSlug, quoteId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const quote = await loadQuote(ctx, quoteId);
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const currency = quote.currency;
  const fmt = (minor: number) => money(minor, currency);
  const calendar = (value: string) =>
    format.dateTime(calendarDate(value), { dateStyle: 'long', timeZone: 'UTC' });

  const quotable = quote.editable ? await listQuotableItems(ctx) : null;
  const quotableById = quotable ? new Map(quotable.map((item) => [item.id, item])) : null;
  const lineUi = await lineFormatters(currency);

  const lines: QuoteLineView[] = quote.lines.map((line) => {
    return {
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPriceLabel: lineUi.unitPrice(line.unitPriceMinor, line.saleUnit),
      lineTotalLabel: fmt(line.lineTotalMinor),
      recipeSummary: lineUi.recipe(line.recipe),
      warning: lineWarning(line, quotableById),
      designHref: line.bouquetConfigurationId
        ? routes.builder.design(line.bouquetConfigurationId)
        : null,
      image: line.image
        ? {
            url: routes.quotes.lineImage(quote.id, line.id),
            downloadUrl: routes.quotes.lineImage(quote.id, line.id, { download: true }),
            source: line.image.source,
            verified: line.image.verified,
            simulated: line.image.simulated,
          }
        : null,
      ...(quote.editable
        ? {
            updateAction: updateLineQuantityAction.bind(null, slug, quote.id, line.id),
            removeAction: removeLineAction.bind(null, slug, quote.id, line.id),
          }
        : {}),
    };
  });

  // Messaggio WhatsApp costruito sul server dagli stessi dati del preventivo. Va al cliente
  // finale: sempre nella lingua del mercato della fioreria, qualunque lingua abbia scelto chi lo
  // prepara (ADR-042).
  const shopLocale = getMarket(ctx.country).defaultLocale;
  const [tShop, formatShop, letterhead] = await Promise.all([
    getTranslations({ locale: shopLocale }),
    getFormatter({ locale: shopLocale }),
    getLetterhead(ctx),
  ]);
  const shopCalendar = (value: string) =>
    formatShop.dateTime(calendarDate(value), { dateStyle: 'long', timeZone: 'UTC' });
  // Link pubblico per il cliente (ADR-056): lo vede e lo gestisce chi scrive i preventivi.
  const publicLink = quote.canWrite
    ? await getPublicLink(ctx, serverEnv().BETTER_AUTH_SECRET, { kind: 'QUOTE', id: quote.id })
    : null;
  const publicUrl = publicLink
    ? publicLinkUrl(serverEnv().APP_URL, 'QUOTE', publicLink.token)
    : null;
  const whatsappText =
    quote.customer.phone && quote.lines.length > 0
      ? [
          tShop('quotes.whatsapp.greeting', {
            name: quote.customer.displayName,
            number: quote.numberLabel,
            shop: ctx.tenantName,
          }),
          '',
          ...quote.lines.map((line) =>
            tShop('quotes.whatsapp.line', {
              quantity: line.quantity,
              description: line.description,
              total: fmt(line.lineTotalMinor),
            }),
          ),
          '',
          ...(quote.discountMinor > 0
            ? [tShop('quotes.whatsapp.discount', { amount: fmt(quote.discountMinor) })]
            : []),
          tShop('quotes.whatsapp.total', { total: fmt(quote.totalMinor) }),
          ...(quote.validUntil
            ? [tShop('quotes.whatsapp.validUntil', { date: shopCalendar(quote.validUntil) })]
            : []),
          ...(quote.notes ? ['', quote.notes] : []),
          ...(publicUrl ? ['', tShop('quotes.whatsapp.link', { url: publicUrl })] : []),
        ].join('\n')
      : null;

  const today = todayInTimeZone(ctx.timezone);
  // Dal preventivo accettato si passa all'ordine (ADR-054).
  const order = quote.status === 'ACCEPTED' ? await getQuoteOrder(ctx, quote.id) : null;
  const canOrder = quote.status === 'ACCEPTED' && !order && hasPermission(ctx, 'orders:write');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        href={routes.quotes.list()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>

      <PageHeader
        className="print:hidden"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tabular-nums">{quote.numberLabel}</span>
            <QuoteStatusBadge status={quote.status} className="font-sans" />
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <Link
              href={routes.customers.detail(quote.customer.id)}
              className="font-medium text-foreground hover:underline"
            >
              {quote.customer.displayName}
            </Link>
            <span>
              {quote.validUntil
                ? t('quotes.validUntil', { date: calendar(quote.validUntil) })
                : t('quotes.noValidity')}
            </span>
            <span>
              {t('quotes.createdOn', {
                date: format.dateTime(quote.createdAt, {
                  dateStyle: 'medium',
                  timeZone: ctx.timezone,
                }),
              })}
            </span>
          </span>
        }
        actions={
          <>
            <PrintButton label={t('quotes.editor.print')} />
            {whatsappText && quote.customer.phone ? (
              <Button asChild variant="outline">
                <a
                  href={whatsappLink(quote.customer.phone, whatsappText)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle />
                  {t('quotes.editor.whatsapp')}
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      {/* Intestazione visibile solo in stampa / PDF. */}
      <div className="hidden space-y-3 border-b pb-4 print:block">
        <PrintLetterhead
          letterhead={letterhead}
          logoSrc={
            letterhead.logoId
              ? tenantRoutes(slug).settings.storeImage('LOGO', letterhead.logoId)
              : null
          }
          locale={shopLocale}
          showHours
        />
        <p className="text-lg font-medium">
          {t('quotes.editor.printHeader', { number: quote.numberLabel })}
        </p>
        <p className="text-sm">
          {t('quotes.editor.printDate', {
            date: format.dateTime(new Date(), { dateStyle: 'long', timeZone: ctx.timezone }),
          })}
        </p>
        <p className="text-sm">
          {t('quotes.editor.printCustomer', { name: quote.customer.displayName })}
          {quote.customer.phone ? ` · ${phoneForInput(quote.customer.phone)}` : ''}
        </p>
        {quote.validUntil ? (
          <p className="text-sm">{t('quotes.validUntil', { date: calendar(quote.validUntil) })}</p>
        ) : null}
      </div>

      {quote.canWrite && !quote.editable ? (
        <Alert variant="info" className="print:hidden">
          <Info aria-hidden="true" />
          <AlertDescription>
            {quote.allowedTransitions.includes('DRAFT')
              ? t('quotes.editor.readOnlyReopen')
              : t('quotes.editor.readOnly')}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] print:block print:space-y-6">
        <div className="min-w-0">
          <Card className="print:border-0 print:shadow-none">
            <CardHeader className="print:px-0">
              <CardTitle>{quote.title ?? t('quotes.editor.lines')}</CardTitle>
              {quote.editable ? (
                <CardDescription>
                  {t('quotes.editor.lineCount', {
                    count: quote.lines.length,
                    max: QUOTE_LIMITS.lines,
                  })}
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-5 print:px-0">
              <QuoteLineList lines={lines} editable={quote.editable} />
              {quote.editable && quotable ? (
                <QuoteLineComposer
                  addCatalogAction={addCatalogLineAction.bind(null, slug, quote.id)}
                  addCustomAction={addCustomLineAction.bind(null, slug, quote.id)}
                  currency={currency}
                  catalogHref={routes.catalog.list()}
                  options={quotable.map((item) => lineUi.option(item))}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="print:border-0 print:shadow-none">
            <CardHeader className="print:px-0">
              <CardTitle>{t('quotes.editor.summary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 print:px-0">
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t('quotes.editor.subtotal')}</dt>
                  <dd className="tabular-nums">{fmt(quote.subtotalMinor)}</dd>
                </div>
                {quote.discountMinor > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{t('quotes.editor.discount')}</dt>
                    <dd className="tabular-nums">−{fmt(quote.discountMinor)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                  <dt>{t('quotes.editor.total')}</dt>
                  <dd className="tabular-nums" data-testid="quote-total">
                    {fmt(quote.totalMinor)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('quotes.editor.pricesNote')}
              </p>
              {quote.canViewCosts && quote.lines.length > 0 ? (
                <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-sm print:hidden">
                  {quote.estimatedCostMinor !== null && quote.estimatedMarginMinor !== null ? (
                    <dl className="grid gap-1.5">
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">
                          {t('quotes.editor.estimatedCost')}
                        </dt>
                        <dd className="tabular-nums">{fmt(quote.estimatedCostMinor)}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">
                          {t('quotes.editor.estimatedMargin')}
                        </dt>
                        <dd className="font-medium tabular-nums">
                          {fmt(quote.estimatedMarginMinor)}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-muted-foreground">{t('quotes.editor.costIncomplete')}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t('quotes.editor.costsInternal')}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {order || canOrder ? (
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle>{t('quotes.editor.orderTitle')}</CardTitle>
                <CardDescription>
                  {order
                    ? t('quotes.editor.orderDone', { number: order.numberLabel })
                    : t('quotes.editor.orderHint')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full" variant={order ? 'outline' : 'default'}>
                  <Link
                    href={order ? routes.orders.detail(order.id) : routes.quotes.toOrder(quote.id)}
                  >
                    <ClipboardList />
                    {order
                      ? t('quotes.editor.viewOrder', { number: order.numberLabel })
                      : t('quotes.editor.convertToOrder')}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {quote.canWrite ? (
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle>{t('quotes.editor.statusTitle')}</CardTitle>
                {quote.allowedTransitions.length > 0 ? (
                  <CardDescription>{t('quotes.editor.statusHint')}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent>
                <QuoteStatusActions
                  action={changeStatusAction.bind(null, slug, quote.id)}
                  transitions={quote.allowedTransitions}
                />
              </CardContent>
            </Card>
          ) : null}

          {quote.canWrite &&
          (publicLink || canShareQuote(quote.status) || quote.status === 'DRAFT') ? (
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle>{t('shareLink.quoteTitle')}</CardTitle>
                <CardDescription>{t('shareLink.quoteHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ShareLinkPanel
                  shareAction={shareQuoteLinkAction.bind(null, slug, quote.id)}
                  revokeAction={revokeQuoteLinkAction.bind(null, slug, quote.id)}
                  unavailableHint={
                    canShareQuote(quote.status) ? null : t('shareLink.quoteDraftHint')
                  }
                  link={
                    publicLink && publicUrl
                      ? {
                          url: publicUrl,
                          expiresLabel: t('shareLink.expires', {
                            date: format.dateTime(publicLink.expiresAt, {
                              dateStyle: 'long',
                              timeZone: ctx.timezone,
                            }),
                          }),
                          whatsappHref:
                            whatsappText && quote.customer.phone
                              ? whatsappLink(quote.customer.phone, whatsappText)
                              : null,
                        }
                      : null
                  }
                />
              </CardContent>
            </Card>
          ) : null}

          {quote.editable ? (
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle>{t('quotes.editor.details')}</CardTitle>
              </CardHeader>
              <CardContent>
                <QuoteDetailsForm
                  action={updateDetailsAction.bind(null, slug, quote.id)}
                  formKey={`${quote.discountMinor}-${quote.validUntil ?? ''}`}
                  currency={currency}
                  dateMin={isoDate(today)}
                  dateMax={isoDate(addDays(today, QUOTE_LIMITS.validityDaysMax))}
                  defaults={{
                    title: quote.title ?? '',
                    validUntil: quote.validUntil ?? '',
                    discount:
                      quote.discountMinor > 0
                        ? minorToDecimalString(quote.discountMinor, ctx.currency)
                        : '',
                    notes: quote.notes ?? '',
                  }}
                />
              </CardContent>
            </Card>
          ) : null}

          {quote.notes ? (
            <Card
              className={quote.editable ? 'hidden print:block print:border-0' : 'print:border-0'}
            >
              <CardHeader className="print:px-0">
                <CardTitle>{t('quotes.editor.notes')}</CardTitle>
              </CardHeader>
              <CardContent className="print:px-0">
                <p className="text-sm whitespace-pre-line">{quote.notes}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <p className="hidden border-t pt-4 text-xs text-muted-foreground print:block">
        {t('quotes.editor.printFooter', { currency })}
      </p>
    </div>
  );
}
