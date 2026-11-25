import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Leaf,
  Mail,
  Phone,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getMyCareContract, type MyCareVisitDto } from '@floral/core';
import { ChargeStatusBadge } from '@/components/care/charge-ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { orNotFound } from '@/lib/care-portal';
import { money } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { accountRoutes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.care');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Un servizio di Floral Care visto dal cliente (ADR-084): le prossime visite con "Cambiar fecha",
 * cosa comprende, i cobros (solo con i soldi), le piante con le indicazioni, i resoconti, le regole
 * e i termini della fioreria. Un contratto che la persona non vede risponde 404.
 */
export default async function MyCareContractPage({
  params,
  searchParams,
}: PageProps<'/cuenta/floral-care/[subscriptionId]'>) {
  const { subscriptionId } = await params;
  const query = await searchParams;
  const ctx = await getBuyerContext(accountRoutes.care.contract(subscriptionId));
  const contract = await orNotFound(getMyCareContract(ctx, subscriptionId));
  const t = await getTranslations();
  const format = await getFormatter();
  const changedId = typeof query.cambiada === 'string' ? query.cambiada : null;
  const changed = changedId ? contract.upcoming.find((visit) => visit.id === changedId) : null;

  const day = (iso: string, long = false) =>
    format.dateTime(calendarDate(iso), {
      weekday: long ? 'long' : 'short',
      day: 'numeric',
      month: long ? 'long' : 'short',
      timeZone: 'UTC',
    });
  const when = (visit: MyCareVisitDto, long = false) =>
    visit.date
      ? visit.start && visit.end
        ? `${day(visit.date, long)} · ${visit.start}–${visit.end}`
        : day(visit.date, long)
      : t('care.visitStatus.TO_RESCHEDULE');
  const moment = (at: Date) =>
    format.dateTime(at, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: contract.shop.timezone,
    });
  // 22/11/2026 è una domenica (0): i nomi dei giorni nella lingua di chi guarda.
  const weekdayName = (value: number) => {
    const name = format.dateTime(new Date(Date.UTC(2026, 10, 22 + value, 12)), {
      weekday: 'long',
      timeZone: 'UTC',
    });
    return name.charAt(0).toLocaleUpperCase() + name.slice(1);
  };
  const monthName = (iso: string) =>
    format.dateTime(calendarDate(iso), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const site = contract.site;

  return (
    <div className="space-y-6">
      <Link
        href={accountRoutes.care.home}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('account.care.title')}
      </Link>
      <div className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">
          {contract.shop.name}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight break-words">
          {site?.label ?? contract.customerName}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">{contract.numberLabel}</span>
          {site ? (
            <span className="break-words">
              · {[site.addressLine1, site.neighborhood, site.city].filter(Boolean).join(', ')}
            </span>
          ) : null}
          <Badge variant={contract.readOnly ? 'outline' : 'success'}>
            {contract.readOnly
              ? t('account.care.ended')
              : t(`account.care.status.${contract.status}`)}
          </Badge>
        </p>
      </div>

      {changed ? (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription className="first-letter:uppercase">
            {t('account.care.change.done', { when: when(changed, true) })}
          </AlertDescription>
        </Alert>
      ) : null}
      {contract.readOnly && contract.endDate && contract.photosDeleteOn ? (
        <Alert variant="warning" data-testid="care-read-only">
          <AlertDescription>
            {t('account.care.readOnly', {
              end: day(contract.endDate, true),
              deleteOn: day(contract.photosDeleteOn, true),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('account.care.upcomingTitle')}</CardTitle>
          <CardDescription>
            {t('account.care.changeRule', { hours: contract.rules.minNoticeHours })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {contract.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('account.care.noUpcoming')}</p>
          ) : (
            <ul className="divide-y rounded-xl border" data-testid="my-care-upcoming">
              {contract.upcoming.map((visit) => (
                <li
                  key={visit.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium first-letter:uppercase">
                      <CalendarClock
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>{when(visit, true)}</span>
                      {visit.isExtra ? (
                        <Badge variant="muted">{t('account.care.extra')}</Badge>
                      ) : null}
                      {visit.changedByCustomer ? (
                        <Badge variant="info">{t('account.care.changedByYou')}</Badge>
                      ) : null}
                    </p>
                    {visit.canChange && visit.changeUntil ? (
                      <p className="text-xs text-muted-foreground">
                        {t('account.care.changeUntil', { when: moment(visit.changeUntil) })}
                      </p>
                    ) : null}
                  </div>
                  {visit.canChange ? (
                    <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                      <Link href={accountRoutes.care.changeDate(contract.subscriptionId, visit.id)}>
                        <Clock />
                        {t('account.care.change.action')}
                      </Link>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {contract.toReschedule > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('account.care.toReschedule', { count: contract.toReschedule })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.care.includedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            {contract.frequency
              ? t(`care.offer.frequencyNames.${contract.frequency}`)
              : t('account.care.noFrequency')}
            {contract.slots.length > 0
              ? ` · ${contract.slots
                  .map((slot) =>
                    t('care.slots.label', {
                      day: weekdayName(slot.weekday),
                      start: slot.start,
                      end: slot.end,
                    }),
                  )
                  .join(', ')}`
              : ''}
          </p>
          {contract.services.length > 0 ? (
            <ul className="space-y-1">
              {contract.services.map((service) => (
                <li key={service.name} className="flex flex-wrap justify-between gap-x-3">
                  <span>{service.name}</span>
                  {service.priceMinor !== null && service.priceMinor > 0 && contract.price ? (
                    <span className="text-muted-foreground tabular-nums">
                      {money(service.priceMinor, contract.price.currency)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {contract.price ? (
            <p className="font-medium">
              {t('account.care.pricePerVisit', {
                amount: money(contract.price.perVisitMinor, contract.price.currency),
              })}
              {contract.price.oneTimeMinor > 0
                ? ` · ${t('account.care.oneTime', {
                    amount: money(contract.price.oneTimeMinor, contract.price.currency),
                  })}`
                : ''}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {contract.charges ? (
        <Card data-testid="my-care-charges">
          <CardHeader>
            <CardTitle>{t('account.care.chargesTitle')}</CardTitle>
            <CardDescription>{t('account.care.payHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {contract.charges.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('account.care.noCharges')}</p>
            ) : (
              <>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>
                    {t('account.care.due', {
                      amount: money(contract.charges.dueMinor, contract.charges.currency),
                    })}
                  </span>
                  {contract.charges.overdueMinor > 0 ? (
                    <span className="font-medium text-destructive">
                      {t('account.care.overdue', {
                        amount: money(contract.charges.overdueMinor, contract.charges.currency),
                      })}
                    </span>
                  ) : null}
                </p>
                <ul className="divide-y rounded-xl border">
                  {contract.charges.items.map((charge) => (
                    <li key={charge.id}>
                      <Link
                        href={accountRoutes.care.charge(contract.subscriptionId, charge.id)}
                        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium first-letter:uppercase">
                            {monthName(charge.period)}
                          </span>
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {charge.numberLabel} ·{' '}
                            {t('account.care.dueOn', { date: day(charge.dueDate) })}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <span className="text-sm font-medium tabular-nums">
                            {money(charge.totalMinor, charge.currency)}
                          </span>
                          <ChargeStatusBadge status={charge.status} />
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('account.care.plantsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {contract.plants.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('account.care.noPlants')}</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {contract.plants.map((plant) => (
                <li key={plant.id} className="space-y-1 p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <Leaf className="size-4 text-primary" aria-hidden="true" />
                    <span className="break-words">
                      {plant.quantity > 1 ? `${plant.quantity} × ${plant.name}` : plant.name}
                    </span>
                    <Badge variant="muted">{t(`care.offer.sizes.${plant.size}`)}</Badge>
                  </p>
                  {plant.location ? (
                    <p className="text-muted-foreground">
                      {t('care.plants.location')}: {plant.location}
                    </p>
                  ) : null}
                  {plant.light || plant.watering ? (
                    <p className="text-muted-foreground">
                      {[
                        plant.light ? t(`care.plants.lights.${plant.light}`) : null,
                        plant.watering ? `${t('care.plants.watering')}: ${plant.watering}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
                  {plant.instructions ? (
                    <p className="whitespace-pre-line">
                      <span className="font-medium">{t('care.plants.instructions')}:</span>{' '}
                      {plant.instructions}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.care.pastTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {contract.past.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('account.care.noPast')}</p>
          ) : (
            <ul className="divide-y rounded-xl border" data-testid="my-care-past">
              {contract.past.map((visit) => (
                <li key={visit.id}>
                  <Link
                    href={accountRoutes.care.visit(contract.subscriptionId, visit.id)}
                    className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1 text-sm first-letter:uppercase">
                      {when(visit)}
                    </span>
                    <Badge variant={visit.status === 'DONE' ? 'success' : 'warning'}>
                      {t(`care.visitStatus.${visit.status}`)}
                    </Badge>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.care.rulesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            {contract.rules.minNoticeHours > 0
              ? t('account.care.rules.notice', { hours: contract.rules.minNoticeHours })
              : t('account.care.rules.noticeAnytime')}
          </p>
          {contract.rules.lateCancelHours !== null ? (
            <p>
              {contract.rules.lateCancelHours > 0
                ? t('account.care.rules.lateCancel', { hours: contract.rules.lateCancelHours })
                : t('account.care.rules.lateCancelNever')}
            </p>
          ) : null}
          {contract.rules.missedVisitPolicy ? (
            <p>{t(`account.care.rules.missed.${contract.rules.missedVisitPolicy}`)}</p>
          ) : null}
          {contract.rules.deadPlantPolicy ? (
            <p>{t(`account.care.rules.deadPlant.${contract.rules.deadPlantPolicy}`)}</p>
          ) : null}
          {contract.termsText ? (
            <div className="mt-3 rounded-xl bg-muted/60 p-3">
              <p className="font-medium">{t('account.care.termsTitle')}</p>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{contract.termsText}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {contract.shop.contactPhone || contract.shop.contactEmail ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('account.care.contactTitle', { shop: contract.shop.name })}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {contract.shop.contactPhone ? (
              <Button asChild variant="outline">
                <a href={`tel:${contract.shop.contactPhone}`}>
                  <Phone />
                  {contract.shop.contactPhone}
                </a>
              </Button>
            ) : null}
            {contract.shop.contactEmail ? (
              <Button asChild variant="outline">
                <a href={`mailto:${contract.shop.contactEmail}`} className="max-w-full">
                  <Mail />
                  <span className="truncate">{contract.shop.contactEmail}</span>
                </a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
