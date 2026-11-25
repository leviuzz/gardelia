import { ArrowLeft, CalendarClock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getMyCareVisitDateOptions } from '@floral/core';
import { ChangeDateForm, type DateOptionGroup } from '@/components/care-portal/portal-forms';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { orNotFound } from '@/lib/care-portal';
import { calendarDate } from '@/lib/quote-ui';
import { accountRoutes } from '@/lib/routes';
import { changeMyCareVisitDateAction } from '../../../../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.care.change');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * "Cambiar fecha" (ADR-084, DECISO): le fasce libere dello stesso mese della visita, dopo il
 * preavviso del contratto, senza i giorni bloccati o con un'altra visita. Una pagina, non un
 * dialogo: a 320 px si sceglie bene.
 */
export default async function ChangeMyCareVisitPage({
  params,
}: PageProps<'/cuenta/floral-care/[subscriptionId]/visitas/[visitId]/cambiar'>) {
  const { subscriptionId, visitId } = await params;
  const ctx = await getBuyerContext(accountRoutes.care.changeDate(subscriptionId, visitId));
  const data = await orNotFound(getMyCareVisitDateOptions(ctx, subscriptionId, visitId));
  const t = await getTranslations();
  const format = await getFormatter();
  const day = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  const current = data.visit.date
    ? data.visit.start && data.visit.end
      ? `${day(data.visit.date)} · ${data.visit.start}–${data.visit.end}`
      : day(data.visit.date)
    : t('care.visitStatus.TO_RESCHEDULE');
  const groups: DateOptionGroup[] = [];
  for (const option of data.options) {
    const last = groups.at(-1);
    const slot = { slotId: option.slotId, start: option.start, end: option.end };
    if (last && last.date === option.date) {
      groups[groups.length - 1] = { ...last, options: [...last.options, slot] };
    } else {
      groups.push({ date: option.date, label: day(option.date), options: [slot] });
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href={accountRoutes.care.contract(subscriptionId)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('account.care.backContract')}
      </Link>
      <div className="space-y-1">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">{data.shopName}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t('account.care.change.title')}
        </h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base first-letter:uppercase">
            <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="first-letter:uppercase">{current}</span>
          </CardTitle>
          <CardDescription>
            {t('account.care.change.rule', { hours: data.noticeHours })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.problem ? (
            <Alert variant="warning">
              <AlertDescription>
                {t(`account.care.change.problems.${data.problem}`, { hours: data.noticeHours })}
              </AlertDescription>
            </Alert>
          ) : groups.length === 0 ? (
            <Alert variant="info">
              <AlertDescription>{t('account.care.change.noOptions')}</AlertDescription>
            </Alert>
          ) : (
            <ChangeDateForm
              action={changeMyCareVisitDateAction.bind(null, subscriptionId, visitId)}
              groups={groups}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
