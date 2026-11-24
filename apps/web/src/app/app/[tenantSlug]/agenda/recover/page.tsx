import { RotateCcw } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  hasPermission,
  listCareVisitsToRecover,
  type CareAgendaVisitDto,
  type TenantContext,
} from '@floral/core';
import { AgendaTabs } from '@/components/care/care-ui';
import { CareUpsell } from '@/components/care/care-upsell';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.recovery');
  return { title: t('pageTitle') };
}

async function load(ctx: TenantContext): Promise<readonly CareAgendaVisitDto[] | null> {
  try {
    return await listCareVisitsToRecover(ctx);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/**
 * "Visitas por recuperar" (ADR-082, blocco 3b): le visite in cui il cliente non ha aperto, nei
 * contratti con «Se agenda otra visita», che non hanno ancora la loro visita di recupero gratis.
 * Dalla più vecchia; dalla visita, chi gestisce l'Agenda fissa il recupero.
 */
export default async function AgendaRecoverPage({
  params,
}: PageProps<'/app/[tenantSlug]/agenda/recover'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:read')) return <Forbidden />;
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const visits = await load(ctx);
  const day = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AgendaTabs routes={routes} current="day" toReschedule={null} />
      <PageHeader
        title={t('care.recovery.pageTitle')}
        description={t('care.recovery.pageSubtitle')}
      />
      {visits === null ? (
        <CareUpsell ctx={ctx} />
      ) : visits.length === 0 ? (
        <EmptyState
          icon={<RotateCcw />}
          title={t('care.recovery.emptyTitle')}
          body={t('care.recovery.emptyBody')}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {visits.map((visit) => (
            <li
              key={visit.id}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">
                  {visit.numberLabel} · {visit.customerName}
                </p>
                <p className="text-sm text-muted-foreground first-letter:uppercase">
                  {t('care.recovery.missedOn', { date: day(visit.date ?? visit.originalDate) })}
                </p>
                {visit.addressLine ? (
                  <p className="text-xs text-muted-foreground">{visit.addressLine}</p>
                ) : null}
              </div>
              <Button asChild size="sm" className="w-full sm:w-auto">
                <Link href={routes.agenda.visit(visit.id)}>
                  {visit.recovery?.canSchedule
                    ? t('care.recovery.schedule')
                    : t('care.agenda.details')}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
