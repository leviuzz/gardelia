import { Flag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  hasPermission,
  listCareFollowUps,
  type CareFollowUpDto,
  type CareFollowUpListDto,
  type TenantContext,
} from '@floral/core';
import { AgendaTabs } from '@/components/care/care-ui';
import { CareUpsell } from '@/components/care/care-upsell';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';
import { createCareQuoteAction } from '../../subscriptions/actions';
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
 * Avvisi della squadra (ADR-078): piante morte da reponer, extra chiesti dai clienti, altro, nati
 * dalle visite. La squadra li vede; chi gestisce li risolve (blocco 2b): una pianta morta con una
 * reposición sin costo (apre il modulo della visita extra nel contratto), alla prossima visita, con
 * una cotización o "no se repone"; gli altri "Atendido" o con una cotización. La regola della
 * fioreria sulle piante morte mette in evidenza la scelta suggerita.
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

  const choices = (item: CareFollowUpDto) => (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {item.choices.map((choice) => {
          const variant = item.suggested === choice ? 'default' : 'secondary';
          const label = t(`care.followUps.choices.${choice}`);
          if (choice === 'FREE_VISIT') {
            return (
              <Button key={choice} asChild size="sm" variant={variant}>
                <Link
                  href={routes.subscriptions.detail(item.subscriptionId, {
                    extra: 'REPLACEMENT',
                    followUp: item.id,
                  })}
                >
                  {label}
                </Link>
              </Button>
            );
          }
          if (choice === 'QUOTED') {
            return result.canQuote ? (
              <ActionButton
                key={choice}
                action={createCareQuoteAction.bind(
                  null,
                  slug,
                  item.subscriptionId,
                  item.kind === 'REPLACEMENT' ? 'REPLACEMENT' : 'EXTRA',
                  item.id,
                )}
                size="sm"
                variant={variant}
              >
                {label}
              </ActionButton>
            ) : null;
          }
          return (
            <ActionButton
              key={choice}
              action={resolveCareFollowUpAction.bind(null, slug, item.id, choice)}
              size="sm"
              variant={variant}
            >
              {label}
            </ActionButton>
          );
        })}
      </div>
      {item.suggested ? (
        <p className="text-xs text-muted-foreground">
          {t('care.followUps.suggested', {
            choice: t(`care.followUps.choices.${item.suggested}`),
          })}
        </p>
      ) : null}
    </div>
  );

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
                choices(item)
              ) : item.resolution ? (
                <div className="flex flex-col gap-1 sm:items-end">
                  <Badge variant="muted">
                    {t(`care.followUps.resolutions.${item.resolution}`)}
                  </Badge>
                  {item.quote ? (
                    <Link
                      href={routes.quotes.detail(item.quote.id)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {t('care.followUps.seeQuote', { number: item.quote.numberLabel })}
                    </Link>
                  ) : null}
                  {item.extraVisit ? (
                    <Link
                      href={routes.agenda.visit(item.extraVisit.id)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {item.extraVisit.date
                        ? t('care.followUps.seeVisit', { date: day(item.extraVisit.date) })
                        : t('care.followUps.seeVisitNoDate')}
                    </Link>
                  ) : null}
                </div>
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
