import { ArrowLeft, Printer, Scissors } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getDayPrintout } from '@floral/core';
import { EmptyState, PageHeader } from '@/components/page-header';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { PrintOrderButton } from '../../[orderId]/print-button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders.dayPrint');
  return { title: t('cardsMeta') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * «Stampa i biglietti» di Ordini → Giorno (M3-3, ADR-088): i biglietti degli ordini da preparare
 * quel giorno, più per foglio (10 × 7 cm come il biglietto di un ordine, ADR-056), con la linea di
 * taglio. Sopra ogni biglietto, fuori dal taglio, il numero e chi lo riceve per abbinarlo al ramo.
 * Il testo è quello dell'ordine, nella lingua in cui l'ha scritto il cliente.
 */
export default async function DayCardsPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/orders/day/cards'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const printout = await getDayPrintout(ctx, single(raw.date));
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const longDate = format.dateTime(calendarDate(printout.date), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const cards = printout.orders.flatMap((order) =>
    order.card
      ? [
          {
            id: order.id,
            label: [order.numberLabel, order.recipientName].filter(Boolean).join(' · '),
            ...order.card,
          },
        ]
      : [],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={routes.orders.day({ date: printout.date })}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      <div className="print:hidden">
        <PageHeader
          title={
            <span className="inline-block first-letter:uppercase">
              {t('orders.dayPrint.cardsTitle', { date: longDate })}
            </span>
          }
          description={t('orders.dayPrint.cardsSubtitle', { count: cards.length })}
          actions={
            cards.length > 0 ? (
              <PrintOrderButton label={t('orders.dayPrint.print')} icon={<Printer />} />
            ) : null
          }
        />
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon={<Scissors />}
          title={t('orders.dayPrint.noCardsTitle')}
          body={t('orders.dayPrint.noCardsBody')}
        />
      ) : (
        <div className="grid justify-center gap-6 sm:grid-cols-2 print:grid-cols-2 print:gap-x-0 print:gap-y-4">
          {cards.map((card) => (
            <div key={card.id} className="break-inside-avoid space-y-1" data-testid="day-card">
              <p className="text-xs text-muted-foreground tabular-nums">{card.label}</p>
              <div className="flex h-[7cm] w-[10cm] max-w-full flex-col justify-center gap-4 border border-dashed border-muted-foreground/60 bg-card px-[0.8cm] py-[0.6cm] text-center">
                <p className="font-display text-lg leading-snug whitespace-pre-line italic">
                  {card.message}
                </p>
                {card.signature ? (
                  <p className="text-base font-medium">— {card.signature}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
