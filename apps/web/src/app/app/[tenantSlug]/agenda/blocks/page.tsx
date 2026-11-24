import { CalendarOff, Plus, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  hasPermission,
  listCareAssignees,
  listCareBlocks,
  type CareBlockSummaryDto,
  type CareBlocksDto,
  type TenantContext,
} from '@floral/core';
import { todayInTimeZone, toIsoDate } from '@floral/domain';
import { ReassignForm } from '@/components/care/block-forms';
import { AgendaTabs } from '@/components/care/care-ui';
import { CareUpsell } from '@/components/care/care-upsell';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { reassignCareVisitsAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.blocks');
  return { title: t('title') };
}

async function load(ctx: TenantContext): Promise<CareBlocksDto | null> {
  try {
    return await listCareBlocks(ctx);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/**
 * Agenda → Bloqueos (ADR-083): i giorni in cui non si fanno visite (vacanze, giorni di punta, un
 * orario tolto), i giorni di punta proposti con un tocco e "Alguien no puede ir" per dare le
 * visite di una persona a un'altra. Lo staff vede i blocchi; li crea e li toglie chi gestisce.
 */
export default async function AgendaBlocksPage({
  params,
}: PageProps<'/app/[tenantSlug]/agenda/blocks'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:read')) return <Forbidden />;
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const data = await load(ctx);
  const assignees = data?.canWrite ? await listCareAssignees(ctx) : [];
  const day = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const range = (start: string, end: string) =>
    start === end ? day(start) : t('care.blocks.range', { from: day(start), to: day(end) });
  const where = (block: CareBlockSummaryDto) =>
    block.slot
      ? t('care.blocks.slotOnly', { start: block.slot.start, end: block.slot.end })
      : t('care.blocks.wholeDay');

  const row = (block: CareBlockSummaryDto) => (
    <li key={block.id}>
      <Link
        href={routes.agenda.block(block.id)}
        className="flex flex-col gap-1 p-4 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="min-w-0">
          <span className="block font-medium break-words">{block.label}</span>
          <span className="block text-sm text-muted-foreground first-letter:uppercase">
            {range(block.startDate, block.endDate)} · {where(block)}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {block.removedAt ? (
            <Badge variant="outline">{t('care.blocks.removedBadge')}</Badge>
          ) : (
            <Badge variant="secondary">{t(`care.blocks.actions.${block.action}`)}</Badge>
          )}
          {block.changes > 0 ? (
            <span className="text-xs text-muted-foreground">
              {t('care.blocks.changesCount', { count: block.changes })}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AgendaTabs routes={routes} current="blocks" toReschedule={null} />
      <PageHeader
        title={t('care.blocks.title')}
        description={t('care.blocks.subtitle')}
        actions={
          data?.canWrite ? (
            <Button asChild className="w-full sm:w-auto">
              <Link href={routes.agenda.newBlock()}>
                <Plus />
                {t('care.blocks.new')}
              </Link>
            </Button>
          ) : null
        }
      />
      {data === null ? (
        <CareUpsell ctx={ctx} />
      ) : (
        <>
          {data.canWrite && data.peakDays.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
                  {t('care.blocks.peakTitle')}
                </CardTitle>
                <CardDescription>{t('care.blocks.peakSubtitle')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y" data-testid="peak-days">
                  {data.peakDays.map((peak) => (
                    <li
                      key={peak.key}
                      className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">
                          {t(`care.blocks.peakDays.${peak.key}`)}
                        </span>
                        <span className="block text-sm text-muted-foreground first-letter:uppercase">
                          {range(peak.startDate, peak.endDate)}
                        </span>
                      </span>
                      <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                        <Link
                          href={routes.agenda.newBlock({
                            startDate: peak.startDate,
                            endDate: peak.endDate,
                            label: t(`care.blocks.peakDays.${peak.key}`),
                          })}
                        >
                          {t('care.blocks.peakBlock')}
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {data.current.length === 0 ? (
            <EmptyState
              icon={<CalendarOff />}
              title={t('care.blocks.emptyTitle')}
              body={t('care.blocks.emptyBody')}
            />
          ) : (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {t('care.blocks.current')}
              </h2>
              <ul className="divide-y rounded-2xl border bg-card" data-testid="blocks-current">
                {data.current.map(row)}
              </ul>
            </section>
          )}

          {data.canWrite && assignees.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('care.blocks.reassignTitle')}</CardTitle>
                <CardDescription>{t('care.blocks.reassignSubtitle')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ReassignForm
                  action={reassignCareVisitsAction.bind(null, ctx.tenantSlug)}
                  assignees={assignees}
                  today={toIsoDate(todayInTimeZone(ctx.timezone))}
                />
              </CardContent>
            </Card>
          ) : null}

          {data.past.length > 0 ? (
            <details className="rounded-2xl border bg-card">
              <summary className="cursor-pointer p-4 text-sm font-medium">
                {t('care.blocks.past', { count: data.past.length })}
              </summary>
              <ul className="divide-y border-t">{data.past.map(row)}</ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
