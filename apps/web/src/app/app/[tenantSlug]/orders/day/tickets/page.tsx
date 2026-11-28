import { ArrowLeft, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getDayPrintout, getLetterhead } from '@floral/core';
import { getMarket } from '@floral/domain';
import { PrintLetterhead } from '@/components/common/print-letterhead';
import { EmptyState, PageHeader } from '@/components/page-header';
import { money, phoneForInput } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { PrintOrderButton } from '../../[orderId]/print-button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('orders.dayPrint');
  return { title: t('ticketsMeta') };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * «Stampa le comande» di Ordini → Giorno (M3-3, ADR-088): una comanda per pagina, con
 * l'intestazione della fioreria, per ogni ordine da preparare quel giorno (confermato, in
 * preparazione, pronto). Le etichette nella lingua di chi stampa; l'intestazione nella lingua del
 * mercato, come la comanda dell'ordine (ADR-042). Niente costi.
 */
export default async function DayTicketsPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/orders/day/tickets'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const raw = await searchParams;
  const [printout, letterhead] = await Promise.all([
    getDayPrintout(ctx, single(raw.date)),
    getLetterhead(ctx),
  ]);
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const shopLocale = getMarket(ctx.country).defaultLocale;
  const longDate = format.dateTime(calendarDate(printout.date), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const logoSrc = letterhead.logoId ? routes.settings.storeImage('LOGO', letterhead.logoId) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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
              {t('orders.dayPrint.ticketsTitle', { date: longDate })}
            </span>
          }
          description={t('orders.dayPrint.ticketsSubtitle', { count: printout.orders.length })}
          actions={
            printout.orders.length > 0 ? (
              <PrintOrderButton label={t('orders.dayPrint.print')} icon={<Printer />} />
            ) : null
          }
        />
      </div>

      {printout.orders.length === 0 ? (
        <EmptyState
          icon={<Printer />}
          title={t('orders.dayPrint.emptyTitle')}
          body={t('orders.dayPrint.emptyBody')}
        />
      ) : (
        <div className="space-y-6 print:space-y-0">
          {printout.orders.map((order) => (
            <article
              key={order.id}
              data-testid="day-ticket"
              className="break-inside-avoid space-y-4 rounded-2xl border bg-card p-5 print:break-after-page print:rounded-none print:border-0 print:p-0"
            >
              <PrintLetterhead letterhead={letterhead} logoSrc={logoSrc} locale={shopLocale} />
              <header className="space-y-1 border-b pb-3">
                <p className="text-lg font-semibold">
                  <span className="tabular-nums">{order.numberLabel}</span> ·{' '}
                  {t(`orders.modes.${order.fulfillmentMode}`)}
                </p>
                <p className="text-sm first-letter:uppercase">
                  {longDate}
                  {order.windowStart && order.windowEnd
                    ? `, ${t('orders.window', { start: order.windowStart, end: order.windowEnd })}`
                    : `, ${t('orders.allDay').toLocaleLowerCase()}`}
                </p>
              </header>

              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium">{t('orders.dayPrint.customer')}</dt>
                  <dd>
                    {order.customerName}
                    {order.customerPhone ? ` · ${phoneForInput(order.customerPhone)}` : ''}
                  </dd>
                </div>
                {order.recipientName || order.recipientPhone ? (
                  <div>
                    <dt className="font-medium">{t('orders.dayPrint.recipient')}</dt>
                    <dd>
                      {[
                        order.recipientName,
                        order.recipientPhone ? phoneForInput(order.recipientPhone) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </dd>
                  </div>
                ) : null}
                {order.address ? (
                  <div className="sm:col-span-2">
                    <dt className="font-medium">{t('orders.dayPrint.address')}</dt>
                    <dd>{order.address}</dd>
                    {order.deliveryNotes ? (
                      <dd className="mt-1 whitespace-pre-line text-muted-foreground">
                        {order.deliveryNotes}
                      </dd>
                    ) : null}
                  </div>
                ) : null}
                {order.assigneeName ? (
                  <div>
                    <dt className="font-medium">{t('orders.dayPrint.assignee')}</dt>
                    <dd>{order.assigneeName}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-medium">{t('orders.dayPrint.payment')}</dt>
                  <dd>
                    {order.balanceMinor > 0
                      ? t('orders.dayPrint.toCollect', {
                          amount: money(order.balanceMinor, order.currency),
                        })
                      : t('orders.dayPrint.paid')}
                  </dd>
                </div>
              </dl>

              <section className="space-y-2">
                <h2 className="text-sm font-medium">{t('orders.dayPrint.lines')}</h2>
                <ul className="space-y-2 text-sm">
                  {order.lines.map((line, index) => (
                    <li key={`${order.id}-${index}`} className="rounded-xl border p-3">
                      <p className="font-medium">
                        {line.quantity} × {line.description}
                      </p>
                      {line.recipe.length > 0 ? (
                        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                          {line.recipe.map((item, itemIndex) => {
                            const name = [item.name, item.variety].filter(Boolean).join(' ');
                            // Il colore con il suo nome, come nella distinta dell'ordine.
                            return (
                              <li key={`${order.id}-${index}-${itemIndex}`}>
                                {item.color && t.has(`catalog.colors.${item.color}`)
                                  ? t('quotes.editor.recipeItemColor', {
                                      quantity: item.quantity,
                                      name,
                                      color: t(`catalog.colors.${item.color}`).toLocaleLowerCase(),
                                    })
                                  : t('quotes.editor.recipeItem', {
                                      quantity: item.quantity,
                                      name,
                                    })}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              {order.card ? (
                <section className="space-y-1 text-sm">
                  <h2 className="font-medium">{t('orders.dayPrint.card')}</h2>
                  <p className="rounded-xl border border-dashed p-3 whitespace-pre-line italic">
                    {order.card.message}
                    {order.card.signature ? (
                      <span className="mt-1 block not-italic">— {order.card.signature}</span>
                    ) : null}
                  </p>
                </section>
              ) : null}

              {order.buyerNotes ? (
                <section className="space-y-1 text-sm">
                  <h2 className="font-medium">{t('orders.dayPrint.buyerNotes')}</h2>
                  <p className="whitespace-pre-line">{order.buyerNotes}</p>
                </section>
              ) : null}
              {order.notes ? (
                <section className="space-y-1 text-sm">
                  <h2 className="font-medium">{t('orders.dayPrint.notes')}</h2>
                  <p className="whitespace-pre-line">{order.notes}</p>
                </section>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
