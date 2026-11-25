import { ChevronLeft, ChevronRight, Image as ImageIcon, MessageSquare } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  hasPermission,
  listCareThreads,
  type CareThreadListDto,
  type TenantContext,
} from '@floral/core';
import { CareTabs } from '@/components/care/care-tabs';
import { CareUpsell } from '@/components/care/care-upsell';
import { Forbidden } from '@/components/forbidden';
import { EmptyState, PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.messages.list');
  return { title: t('title') };
}

async function load(ctx: TenantContext, page: number): Promise<CareThreadListDto | null> {
  try {
    return await listCareThreads(ctx, page);
  } catch (error) {
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

/**
 * «Mensajes» di Floral Care (ADR-084): i contratti con messaggi, prima quelli con messaggi del
 * cliente da leggere, poi dal più recente. Per tutta la squadra; il filo si apre nella pagina del
 * contratto.
 */
export default async function CareMessagesPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/subscriptions/messages'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'care:messages')) return <Forbidden />;
  const t = await getTranslations('care.messages.list');
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const raw = (await searchParams).page;
  const requested = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''), 10);
  const result = await load(ctx, Number.isInteger(requested) && requested > 0 ? requested : 1);
  const header = <PageHeader title={t('title')} description={t('subtitle')} />;
  if (!result) {
    return (
      <div className="space-y-6">
        {header}
        <CareUpsell ctx={ctx} />
      </div>
    );
  }
  const when = (date: Date) =>
    format.dateTime(date, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: ctx.timezone,
    });

  return (
    <div className="space-y-6">
      {header}
      <CareTabs ctx={ctx} current="messages" />

      {result.threads.length === 0 ? (
        <EmptyState icon={<MessageSquare />} title={t('emptyTitle')} body={t('empty')} />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card" data-testid="care-threads">
          {result.threads.map((thread) => {
            const text = thread.last.preview || t('photoOnly');
            return (
              <li key={thread.subscriptionId}>
                <Link
                  href={routes.subscriptions.thread(thread.subscriptionId)}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'break-words',
                          thread.unreadCount > 0 ? 'font-semibold' : 'font-medium',
                        )}
                      >
                        {thread.customerName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[thread.numberLabel, thread.siteLabel].filter(Boolean).join(' · ')}
                      </span>
                      {thread.status === 'ENDED' || thread.status === 'CANCELLED' ? (
                        <Badge variant="muted">{t('ended')}</Badge>
                      ) : null}
                    </p>
                    <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                      {thread.last.hasPhoto && thread.last.preview ? (
                        <ImageIcon className="size-3.5 shrink-0" aria-label={t('photo')} />
                      ) : null}
                      <span className="truncate">
                        {thread.last.authorKind === 'CUSTOMER'
                          ? t('fromCustomer', { text })
                          : t('fromShop', { text })}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <time dateTime={thread.lastAt.toISOString()}>{when(thread.lastAt)}</time>
                    {thread.unreadCount > 0 ? (
                      <Badge variant="danger">{t('unread', { count: thread.unreadCount })}</Badge>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {result.page > 1 || result.hasMore ? (
        <nav className="flex justify-between gap-2">
          {result.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link
                href={routes.subscriptions.messages({
                  page: result.page > 2 ? result.page - 1 : undefined,
                })}
              >
                <ChevronLeft aria-hidden="true" />
                {t('previous')}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {result.hasMore ? (
            <Button asChild variant="outline" size="sm">
              <Link href={routes.subscriptions.messages({ page: result.page + 1 })}>
                {t('next')}
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
