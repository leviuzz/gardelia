import { ArrowLeft, Info, MessageCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { cache } from 'react';
import {
  NotFoundError,
  getQuote,
  listQuotableItems,
  type QuotableItemOption,
  type QuoteDetailDto,
  type QuoteLineDto,
  type TenantContext,
} from '@floral/core';
import {
  QUOTE_LIMITS,
  isIngredientType,
  minorToDecimalString,
  todayInTimeZone,
  whatsappLink,
} from '@floral/domain';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { money, phoneForInput } from '@/lib/format';
import { QUOTE_STATUS_BADGE, calendarDate } from '@/lib/quote-ui';
import { getTenantContext } from '@/lib/tenant';
import {
  addCatalogLineAction,
  addCustomLineAction,
  changeStatusAction,
  removeLineAction,
  updateDetailsAction,
  updateLineQuantityAction,
} from '../actions';
import { PrintButton, QuoteDetailsForm, QuoteStatusActions } from './quote-controls';
import {
  QuoteLineComposer,
  QuoteLineList,
  type LineWarning,
  type QuotableGroup,
  type QuoteLineView,
} from './quote-lines';

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

function groupOf(item: QuotableItemOption): QuotableGroup {
  if (item.type === 'BOUQUET') return 'BOUQUET';
  return isIngredientType(item.type) ? 'INGREDIENTS' : 'OTHER';
}

/**
 * Avviso di disponibilità: per i preventivi modificabili si usa lo stato ATTUALE del
 * catalogo (l'articolo potrebbe essere esaurito o archiviato dopo l'aggiunta); per gli
 * altri, lo snapshot del momento in cui la riga è stata aggiunta.
 */
function lineWarning(
  line: QuoteLineDto,
  current: ReadonlyMap<string, QuotableItemOption> | null,
): LineWarning | null {
  if (line.kind === 'CUSTOM') return null;
  // Righe del Builder: disponibilità più critica fra i componenti (snapshot).
  const availability =
    line.kind === 'CATALOG_ITEM' && line.catalogItemId && current
      ? (current.get(line.catalogItemId)?.availability ?? 'UNAVAILABLE')
      : line.availability;
  if (availability === 'LIMITED' || availability === 'ON_REQUEST') return availability;
  if (availability === 'UNAVAILABLE' || availability === 'OUT_OF_STOCK') return 'UNAVAILABLE';
  return null;
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
  const currency = quote.currency;
  const fmt = (minor: number) => money(minor, currency);
  const calendar = (value: string) =>
    format.dateTime(calendarDate(value), { dateStyle: 'long', timeZone: 'UTC' });

  const quotable = quote.editable ? await listQuotableItems(ctx) : null;
  const quotableById = quotable ? new Map(quotable.map((item) => [item.id, item])) : null;

  const lines: QuoteLineView[] = quote.lines.map((line) => {
    const unit = line.saleUnit
      ? `${fmt(line.unitPriceMinor)} ${t('catalog.perUnit', { unit: t(`catalog.units.${line.saleUnit}`) })}`
      : fmt(line.unitPriceMinor);
    return {
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPriceLabel: unit,
      lineTotalLabel: fmt(line.lineTotalMinor),
      recipeSummary:
        line.recipe && line.recipe.length > 0
          ? format.list(
              line.recipe.map((ingredient) => {
                const name = ingredient.variety
                  ? `${ingredient.name} ${ingredient.variety}`
                  : ingredient.name;
                return ingredient.color && t.has(`catalog.colors.${ingredient.color}`)
                  ? t('quotes.editor.recipeItemColor', {
                      quantity: ingredient.quantity,
                      name,
                      color: t(`catalog.colors.${ingredient.color}`).toLocaleLowerCase('es-MX'),
                    })
                  : t('quotes.editor.recipeItem', { quantity: ingredient.quantity, name });
              }),
            )
          : null,
      warning: lineWarning(line, quotableById),
      designHref: line.bouquetConfigurationId
        ? `/app/${slug}/builder/${line.bouquetConfigurationId}`
        : null,
      ...(quote.editable
        ? {
            updateAction: updateLineQuantityAction.bind(null, slug, quote.id, line.id),
            removeAction: removeLineAction.bind(null, slug, quote.id, line.id),
          }
        : {}),
    };
  });

  // Messaggio WhatsApp costruito sul server dagli stessi dati del preventivo.
  const whatsappText =
    quote.customer.phone && quote.lines.length > 0
      ? [
          t('quotes.whatsapp.greeting', {
            name: quote.customer.displayName,
            number: quote.numberLabel,
            shop: ctx.tenantName,
          }),
          '',
          ...quote.lines.map((line) =>
            t('quotes.whatsapp.line', {
              quantity: line.quantity,
              description: line.description,
              total: fmt(line.lineTotalMinor),
            }),
          ),
          '',
          ...(quote.discountMinor > 0
            ? [t('quotes.whatsapp.discount', { amount: fmt(quote.discountMinor) })]
            : []),
          t('quotes.whatsapp.total', { total: fmt(quote.totalMinor) }),
          ...(quote.validUntil
            ? [t('quotes.whatsapp.validUntil', { date: calendar(quote.validUntil) })]
            : []),
          ...(quote.notes ? ['', quote.notes] : []),
        ].join('\n')
      : null;

  const today = todayInTimeZone(ctx.timezone);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        href={`/app/${slug}/quotes`}
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
            <Badge variant={QUOTE_STATUS_BADGE[quote.status]} className="font-sans">
              {t(`quotes.statuses.${quote.status}`)}
            </Badge>
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <Link
              href={`/app/${slug}/customers/${quote.customer.id}`}
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
      <div className="hidden space-y-1 border-b pb-4 print:block">
        <p className="font-display text-2xl font-semibold">{ctx.tenantName}</p>
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
                  catalogHref={`/app/${slug}/catalog`}
                  options={quotable.map((item) => ({
                    id: item.id,
                    group: groupOf(item),
                    label: [
                      item.variety ? `${item.name} · ${item.variety}` : item.name,
                      `${fmt(item.priceMinor)} ${t('catalog.perUnit', { unit: t(`catalog.units.${item.saleUnit}`) })}`,
                      ...(item.availability === 'AVAILABLE'
                        ? []
                        : [t(`catalog.availability.${item.availability}`)]),
                    ].join(' — '),
                  }))}
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
