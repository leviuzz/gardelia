import { CircleCheck, Info } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getPublicQuote, type PublicQuoteDto } from '@floral/core';
import { BRAND, DEFAULT_LOCALE } from '@floral/domain';
import { SubmitButton } from '@/components/form/submit-button';
import { PublicLines, PublicTotals } from '@/components/public/public-lines';
import { PublicInvalidLink, PublicShell } from '@/components/public/public-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { serverEnv } from '@/lib/env';
import { money } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { acceptQuoteAction } from './actions';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Preventivo aperto dal cliente con il link della fioreria (ADR-056): righe, totale, validità e
 * "Aceptar cotización". Parla la lingua del mercato della fioreria, come i messaggi al cliente.
 */
export default async function PublicQuotePage({ params }: PageProps<'/cotizacion/[token]'>) {
  const { token } = await params;
  const quote = await getPublicQuote(serverEnv().BETTER_AUTH_SECRET, token);
  const locale = quote?.shop.locale ?? DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: 'publicLink' });
  const footer = t('poweredBy', { brand: BRAND.productName });
  if (!quote) {
    return <PublicInvalidLink title={t('invalidTitle')} body={t('invalid')} footer={footer} />;
  }

  const tAll = await getTranslations({ locale });
  const format = await getFormatter({ locale });
  const fmt = (minor: number) => money(minor, quote.currency, locale);
  const longDate = (value: Date | string) =>
    format.dateTime(typeof value === 'string' ? calendarDate(value) : value, {
      dateStyle: 'long',
      timeZone: typeof value === 'string' ? 'UTC' : quote.shop.timezone,
    });
  // In aggiornamento (riaperto in bozza dalla fioreria): le righe possono cambiare, non si mostrano.
  const showLines = quote.status !== 'DRAFT';
  const state = quoteState(quote, t, longDate);

  return (
    <PublicShell
      shopName={quote.shop.name}
      logoSrc={
        quote.shop.logoId
          ? `/cotizacion/${encodeURIComponent(token)}/logo?v=${quote.shop.logoId}`
          : null
      }
      footer={footer}
      contact={
        quote.shop.phone
          ? {
              phone: quote.shop.phone,
              label: t('contact'),
              text: t('quote.contactText', { number: quote.numberLabel }),
            }
          : null
      }
    >
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t('quote.title', { number: quote.numberLabel })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('quote.for', { name: quote.customerName, date: longDate(quote.createdAt) })}
        </p>
        {quote.validUntil && quote.status === 'SENT' ? (
          <p className="text-sm text-muted-foreground">
            {t('quote.validUntil', { date: longDate(quote.validUntil) })}
          </p>
        ) : null}
      </header>

      {state ? (
        <Alert variant={state.variant}>
          {state.variant === 'success' ? (
            <CircleCheck aria-hidden="true" />
          ) : (
            <Info aria-hidden="true" />
          )}
          <AlertDescription>{state.text}</AlertDescription>
        </Alert>
      ) : null}

      {showLines ? (
        <section className="space-y-4">
          {quote.title ? <h2 className="font-medium">{quote.title}</h2> : null}
          <PublicLines
            lines={quote.lines.map((line) => ({
              id: line.id,
              description: line.description,
              quantityLabel: `${line.quantity} × ${fmt(line.unitPriceMinor)}${
                line.saleUnit
                  ? ` ${tAll('catalog.perUnit', { unit: tAll(`catalog.units.${line.saleUnit}`) })}`
                  : ''
              }`,
              totalLabel: fmt(line.lineTotalMinor),
              recipe:
                line.recipe && line.recipe.length > 0
                  ? `${tAll('quotes.editor.recipeOf')} ${format.list(
                      line.recipe.map((item) =>
                        tAll('quotes.editor.recipeItem', {
                          quantity: item.quantity,
                          name: item.variety ? `${item.name} ${item.variety}` : item.name,
                        }),
                      ),
                    )}`
                  : null,
              imageUrl: line.hasImage
                ? `/cotizacion/${encodeURIComponent(token)}/imagen/${line.id}`
                : null,
              imageAlt: t('imageAlt', { name: line.description }),
            }))}
          />
          <PublicTotals
            rows={[
              { label: t('subtotal'), value: fmt(quote.subtotalMinor) },
              ...(quote.discountMinor > 0
                ? [{ label: t('discount'), value: `−${fmt(quote.discountMinor)}` }]
                : []),
              ...(quote.taxMinor > 0 ? [{ label: t('tax'), value: fmt(quote.taxMinor) }] : []),
              { label: t('total'), value: fmt(quote.totalMinor), strong: true },
            ]}
          />
          {quote.notes ? (
            <p className="rounded-xl bg-muted/50 p-4 text-sm whitespace-pre-line">{quote.notes}</p>
          ) : null}
        </section>
      ) : null}

      {quote.canAccept ? (
        <form action={acceptQuoteAction.bind(null, token)} className="space-y-3 border-t pt-5">
          <p className="text-sm text-muted-foreground">{t('quote.acceptHint')}</p>
          <SubmitButton size="lg" className="w-full sm:w-auto">
            {t('quote.accept')}
          </SubmitButton>
        </form>
      ) : null}
    </PublicShell>
  );
}

/** Esito o avviso sopra le righe; null per un preventivo inviato e valido. */
function quoteState(
  quote: PublicQuoteDto,
  t: (key: string, values?: Record<string, string>) => string,
  longDate: (value: Date | string) => string,
): { readonly variant: 'success' | 'info'; readonly text: string } | null {
  switch (quote.status) {
    case 'SENT':
      return null;
    case 'ACCEPTED':
      return {
        variant: 'success',
        text: quote.acceptedAt
          ? t('quote.accepted', { date: longDate(quote.acceptedAt) })
          : t('quote.acceptedNoDate'),
      };
    case 'EXPIRED':
      return {
        variant: 'info',
        text: quote.validUntil
          ? t('quote.expired', { date: longDate(quote.validUntil) })
          : t('quote.unavailable'),
      };
    case 'DRAFT':
      return { variant: 'info', text: t('quote.updating') };
    default:
      return { variant: 'info', text: t('quote.unavailable') };
  }
}
