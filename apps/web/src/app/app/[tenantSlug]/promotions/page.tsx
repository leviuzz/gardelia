import {
  CalendarDays,
  Info,
  Mail,
  Send,
  TicketPercent,
  TriangleExclamationPoint,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  getOccasionPromo,
  hasPermission,
  listCalendarOccasions,
  listPromoDiscounts,
  previewOccasionPromoEmail,
} from '@floral/core';
import {
  LOCALE_NAMES,
  PROMO_DISCOUNT_STATUSES,
  PROMO_LIMITS,
  addDays,
  minorToDecimalString,
  parseIsoDate,
  toIsoDate,
  todayInTimeZone,
} from '@floral/domain';
import { Button } from '@/components/ui/button';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { updateOccasionPromoAction } from './actions';
import { OccasionPromoForm } from './promo-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('promotions');
  return { title: t('title') };
}

/**
 * Promociones (richiesta del founder, ADR-047): una pagina semplice con lo sconto dell'email
 * automatica per le date speciali dei clienti, come funziona e l'anteprima del messaggio.
 */
export default async function PromotionsPage({
  params,
}: PageProps<'/app/[tenantSlug]/promotions'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'promotions:manage')) return <Forbidden />;

  const view = await getOccasionPromo(ctx);
  const preview = await previewOccasionPromoEmail(ctx);
  const discounts = await listPromoDiscounts(ctx, {});
  const t = await getTranslations('promotions');
  const tOccasions = await getTranslations('customers.occasions');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const { settings } = view;

  // Prossimi invii automatici (7 giorni): le date che partono col preavviso più lungo sono fino a
  // 60 giorni avanti. Stesse regole del calendario (ADR-046/047).
  const today = todayInTimeZone(ctx.timezone);
  const horizon = toIsoDate(addDays(today, 7));
  const upcoming = (
    await listCalendarOccasions(ctx, {
      from: today,
      to: addDays(today, 7 + PROMO_LIMITS.lookaheadDays),
    })
  )
    .flatMap((event) =>
      event.promo?.status === 'SCHEDULED' && event.promo.sendOn <= horizon
        ? [{ event, sendOn: event.promo.sendOn }]
        : [],
    )
    .sort((a, b) => a.sendOn.localeCompare(b.sendOn) || a.event.date.localeCompare(b.event.date));
  const dayLabel = (iso: string) => {
    const day = parseIsoDate(iso) ?? today;
    const offset = Math.round(
      (Date.UTC(day.year, day.month - 1, day.day) -
        Date.UTC(today.year, today.month - 1, today.day)) /
        86_400_000,
    );
    if (offset <= 0) return t('upcoming.today');
    if (offset === 1) return t('upcoming.tomorrow');
    return format.dateTime(new Date(Date.UTC(day.year, day.month - 1, day.day, 12)), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {view.mode === 'DEMO' ? (
        <Alert variant="warning">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{t('demoNotice')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>{t('occasion.title')}</CardTitle>
            <CardDescription>{t('occasion.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <OccasionPromoForm
              action={updateOccasionPromoAction.bind(null, ctx.tenantSlug)}
              currency={ctx.currency}
              defaults={{
                enabled: settings.enabled,
                kind: settings.kind,
                percent:
                  settings.kind === 'PERCENT' && settings.value !== null
                    ? String(settings.value)
                    : '',
                amount:
                  settings.kind === 'AMOUNT' && settings.value !== null
                    ? minorToDecimalString(settings.value, ctx.currency)
                    : '',
              }}
            />
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('how.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>
                {t('how.who', {
                  reachable: view.reach.reachable,
                  total: view.reach.customersWithDates,
                })}
              </li>
              <li>{t('how.when')}</li>
              <li>{t('how.validity')}</li>
              <li>{t('how.once')}</li>
              <li>{t('how.unsubscribe')}</li>
            </ul>
            <p className="flex items-center gap-2 font-medium">
              <Mail className="size-4 text-primary" aria-hidden="true" />
              {t('how.sent', { count: view.sentLast30Days })}
            </p>
            <Link
              href={routes.calendar({ view: 'agenda' })}
              className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
            >
              <CalendarDays className="size-4" aria-hidden="true" />
              {t('how.calendar')}
            </Link>
            {view.hasContact ? null : (
              <Alert variant="info">
                <Info aria-hidden="true" />
                <AlertDescription>
                  {t('noContact')}{' '}
                  <Link href={routes.settings.general} className="font-medium underline">
                    {t('goToSettings')}
                  </Link>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="size-4 text-primary" aria-hidden="true" />
              {t('upcoming.title')}
            </CardTitle>
            <CardDescription>{t('upcoming.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            {!settings.enabled ? (
              <p className="text-sm text-muted-foreground">{t('upcoming.off')}</p>
            ) : upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('upcoming.empty')}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {upcoming.slice(0, 10).map(({ event, sendOn }) => (
                  <li
                    key={event.key}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm"
                  >
                    <Link
                      href={routes.customers.detail(event.customerId)}
                      className="min-w-0 font-medium break-words hover:underline"
                    >
                      {event.customerName}
                    </Link>
                    <span className="text-muted-foreground">
                      {t('upcoming.row', {
                        day: dayLabel(sendOn),
                        occasion:
                          event.type === 'CUSTOM' && event.label
                            ? event.label
                            : tOccasions(`types.${event.type}`),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {upcoming.length > 10 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('upcoming.more', { count: upcoming.length - 10 })}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TicketPercent className="size-4 text-primary" aria-hidden="true" />
              {t('discountsCard.title')}
            </CardTitle>
            <CardDescription>{t('discountsCard.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1 text-sm">
              {PROMO_DISCOUNT_STATUSES.map((status) => (
                <li key={status}>
                  {t(`discounts.counts.${status}`, { count: discounts.counts[status] })}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline">
              <Link href={routes.promotions.discounts()}>{t('discountsCard.open')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('preview.title')}</CardTitle>
          <CardDescription>
            {t('preview.subtitle', { language: LOCALE_NAMES[view.emailLocale] })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {preview ? (
            <>
              <p className="text-sm break-words">
                <span className="text-muted-foreground">{t('preview.subject')}</span>{' '}
                <span className="font-medium">{preview.subject}</span>
              </p>
              {/* Il messaggio vero, isolato: niente script, link che non portano da nessuna parte. */}
              <iframe
                title={t('preview.title')}
                sandbox=""
                srcDoc={preview.html}
                className="h-[42rem] w-full rounded-xl border bg-white"
              />
            </>
          ) : (
            <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
              {t('preview.empty')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
