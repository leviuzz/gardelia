import { Flag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  hasPermission,
  listCareFollowUps,
  type CareFollowUpListDto,
  type TenantContext,
} from '@floral/core';
import { AgendaTabs } from '@/components/care/care-ui';
import { CareUpsell } from '@/components/care/care-upsell';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { resolveCareFollowUpAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.followUps');
  return { title: t('title') };
}

async function load(
  ctx: TenantContext,
  status: 'OPEN' | 'RESOLVED',
): Promise<CareFollowUpListDto | null> {
  try {
    return await listCareFollowUps(ctx, status);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/**
 * Avvisi della squadra (ADR-076): piante morte da reponer, extra chiesti dai clienti, altro, nati
 * dalle visite. Chi gestisce li segna come attesi; la squadra li vede.
 */
export default async function CareFollowUpsPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/agenda/follow-ups'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:read')) return <Forbidden />;
  const resolved = (await searchParams).view === 'resolved';
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const result = await load(ctx, resolved ? 'RESOLVED' : 'OPEN');
  if (!result) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title={t('care.followUps.title')} />
        <CareUpsell ctx={ctx} />
      </div>
    );
  }
  const day = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AgendaTabs routes={routes} current="day" toReschedule={null} />
      <PageHeader title={t('care.followUps.title')} description={t('care.followUps.subtitle')} />
      <nav aria-label={t('care.followUps.viewsLabel')} className="flex gap-2 text-sm">
        {(['open', 'resolved'] as const).map((view) => {
          const active = (view === 'resolved') === resolved;
          return (
            <Link
              key={view}
              href={routes.agenda.followUps(view === 'resolved' ? { view } : undefined)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 font-medium transition-colors hover:bg-muted',
                active && 'border-foreground/30 bg-muted',
              )}
            >
              {t(`care.followUps.views.${view}`)}
            </Link>
          );
        })}
      </nav>
      {result.items.length === 0 ? (
        <EmptyState
          icon={<Flag />}
          title={resolved ? t('care.followUps.emptyResolved') : t('care.followUps.emptyTitle')}
          body={t('care.followUps.emptyBody')}
        />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card text-sm">
          {result.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {t(`care.followUps.kinds.${item.kind}`)}
                  {item.plantName ? ` · ${item.plantName}` : ''}
                  {item.quantity ? ` (${item.quantity})` : ''}
                </p>
                <p className="text-muted-foreground">
                  <Link href={routes.agenda.visit(item.visitId)} className="hover:underline">
                    {item.numberLabel} · {item.customerName}
                    {item.visitDate ? ` · ${day(item.visitDate)}` : ''}
                  </Link>
                </p>
                {item.note ? <p className="break-words">{item.note}</p> : null}
                {item.resolutionNote ? (
                  <p className="text-xs break-words text-muted-foreground">
                    {t('care.followUps.resolution', { note: item.resolutionNote })}
                  </p>
                ) : null}
              </div>
              {item.status === 'OPEN' && result.canResolve ? (
                <ActionButton
                  action={resolveCareFollowUpAction.bind(null, slug, item.id)}
                  variant="secondary"
                  size="sm"
                >
                  {t('care.followUps.resolve')}
                </ActionButton>
              ) : (
                <Badge variant={item.status === 'OPEN' ? 'warning' : 'muted'}>
                  {t(`care.followUps.statuses.${item.status}`)}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
