import 'server-only';
import {
  Banknote,
  FileText,
  Mail,
  Package,
  PackageCheck,
  PackageX,
  Receipt,
  Sprout,
  Ticket,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getCustomerTimeline, type CustomerTimelineEvent, type TenantContext } from '@floral/core';
import { CUSTOMER_TIMELINE_PAGE } from '@floral/domain';
import { money } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';

/** Icona di un evento: ordini consegnati o annullati hanno la loro. */
function EventIcon({ event }: { readonly event: CustomerTimelineEvent }) {
  switch (event.kind) {
    case 'customer_created':
      return <UserPlus />;
    case 'quote_created':
    case 'quote_status':
      return <FileText />;
    case 'order_status':
      if (event.status === 'CANCELLED') return <PackageX />;
      if (event.status === 'DELIVERED' || event.status === 'PICKED_UP') return <PackageCheck />;
      return <Package />;
    case 'payment':
      return <Banknote />;
    case 'promo_sent':
      return <Mail />;
    case 'promo_redeemed':
      return <Ticket />;
    case 'care_visit':
      return <Sprout />;
    case 'care_charge':
      return <Receipt />;
    case 'care_payment':
      return <Banknote />;
  }
}

/**
 * "Historial" nella scheda del cliente (CRM-01): preventivi, ordini, pagamenti, consegne e
 * promozioni in una sola linea del tempo, ognuno col suo link. "Ver más" ne mostra altri 20.
 */
export async function CustomerTimeline({
  ctx,
  customerId,
  limit,
}: {
  readonly ctx: TenantContext;
  readonly customerId: string;
  /** Il parametro `?historial=` della pagina. */
  readonly limit: string | undefined;
}) {
  const timeline = await getCustomerTimeline(ctx, customerId, limit);
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);

  function describe(event: CustomerTimelineEvent): {
    readonly text: string;
    readonly detail: string | null;
    readonly href: string | null;
  } {
    switch (event.kind) {
      case 'customer_created':
        return { text: t('customers.timeline.customerCreated'), detail: null, href: null };
      case 'quote_created':
        return {
          text: t('customers.timeline.quoteCreated', { number: event.number }),
          detail: [event.title, money(event.totalMinor, event.currency)]
            .filter(Boolean)
            .join(' · '),
          href: routes.quotes.detail(event.quoteId),
        };
      case 'quote_status':
        return {
          text: t('customers.timeline.quoteStatus', {
            number: event.number,
            status: t(`quotes.statuses.${event.status}`),
          }),
          detail: null,
          href: routes.quotes.detail(event.quoteId),
        };
      case 'order_status':
        return {
          text: event.created
            ? t('customers.timeline.orderCreated', {
                number: event.number,
                status: t(`orders.statuses.${event.status}`),
              })
            : t('customers.timeline.orderStatus', {
                number: event.number,
                status: t(`orders.statuses.${event.status}`),
              }),
          detail: event.created
            ? `${t(`orders.modes.${event.fulfillmentMode}`)} · ${money(event.totalMinor, event.currency)}`
            : event.note
              ? t('customers.timeline.reason', { note: event.note })
              : null,
          href: routes.orders.detail(event.orderId),
        };
      case 'payment':
        return {
          text:
            event.paymentKind === 'REVERSAL'
              ? t('customers.timeline.paymentReversed', {
                  amount: money(event.amountMinor, event.currency),
                  number: event.number,
                })
              : t('customers.timeline.payment', {
                  kind: t(`orders.paymentKinds.${event.paymentKind}`),
                  amount: money(event.amountMinor, event.currency),
                  method: t(`orders.methods.${event.method}`),
                  number: event.number,
                }),
          detail: null,
          href: routes.orders.detail(event.orderId),
        };
      case 'promo_sent':
        return {
          text: t('customers.timeline.promoSent', {
            occasion: event.occasionLabel ?? t(`customers.occasions.types.${event.occasionType}`),
            code: event.code,
          }),
          detail: null,
          href: null,
        };
      case 'promo_redeemed':
        return {
          text: t('customers.timeline.promoRedeemed', { code: event.code }),
          detail: null,
          href: null,
        };
      case 'care_visit':
        return {
          text:
            event.status === 'DONE'
              ? t('customers.timeline.careVisitDone', { number: event.number })
              : t('customers.timeline.careVisitNotDone', { number: event.number }),
          detail: null,
          href: routes.agenda.visit(event.visitId),
        };
      case 'care_charge':
        return {
          text: t('customers.timeline.careCharge', {
            number: event.number,
            month: format.dateTime(new Date(`${event.period}T12:00:00Z`), {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }),
          }),
          detail: money(event.totalMinor, event.currency),
          href: routes.subscriptions.charge(event.subscriptionId, event.chargeId),
        };
      case 'care_payment':
        return {
          text:
            event.paymentKind === 'REVERSAL'
              ? t('customers.timeline.carePaymentReversed', {
                  amount: money(event.amountMinor, event.currency),
                })
              : t('customers.timeline.carePayment', {
                  kind: t(`care.payment.kinds.${event.paymentKind}`),
                  amount: money(Math.abs(event.amountMinor), event.currency),
                  method: t(`orders.methods.${event.method}`),
                }),
          detail: null,
          href: routes.customers.statement(customerId),
        };
    }
  }

  return (
    <section id="historial" aria-labelledby="historial-title" className="space-y-3">
      <div>
        <h2 id="historial-title" className="text-lg font-semibold">
          {t('customers.timeline.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('customers.timeline.subtitle')}</p>
      </div>
      <ol className="divide-y rounded-2xl border bg-card">
        {timeline.events.map((event) => {
          const { text, detail, href } = describe(event);
          return (
            <li key={event.id} className="flex gap-3 p-4 text-sm">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground [&_svg]:size-4"
              >
                <EventIcon event={event} />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                {href ? (
                  <Link href={href} className="font-medium break-words hover:underline">
                    {text}
                  </Link>
                ) : (
                  <p className="font-medium break-words">{text}</p>
                )}
                {detail ? <p className="break-words text-muted-foreground">{detail}</p> : null}
                <time dateTime={event.at.toISOString()} className="text-xs text-muted-foreground">
                  {format.dateTime(event.at, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: ctx.timezone,
                  })}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
      {timeline.hasMore ? (
        <Link
          href={`${routes.customers.detail(customerId, {
            historial: timeline.limit + CUSTOMER_TIMELINE_PAGE,
          })}#historial`}
          scroll={false}
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          {t('customers.timeline.more')}
        </Link>
      ) : null}
    </section>
  );
}
