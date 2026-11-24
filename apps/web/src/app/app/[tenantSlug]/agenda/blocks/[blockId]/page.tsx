import { ArrowLeft, ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  PlanRequiredError,
  getCareBlock,
  hasPermission,
  type CareBlockChangeDto,
  type CareBlockContractDto,
} from '@floral/core';
import { RemoveBlockButton, SendNoticeButton } from '@/components/care/block-forms';
import { CareUpsell } from '@/components/care/care-upsell';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { removeCareBlockAction, sendCareBlockNoticeAction } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('care.blocks');
  return { title: t('detailTitle') };
}

/**
 * Un blocco di giorni (ADR-083): quando, quale orario, cosa fa con le visite, le visite che ha
 * spostato o cancellato contratto per contratto, lo stato dell'avviso per email ("Enviar aviso",
 * "Reintentar") e "Quitar bloqueo". Un ID di un'altra fioreria dà 404.
 */
export default async function CareBlockPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/agenda/blocks/[blockId]'>) {
  const { tenantSlug, blockId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:read')) return <Forbidden />;
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const created = (await searchParams).created === '1';
  let block;
  try {
    block = await getCareBlock(ctx, blockId);
  } catch (error) {
    if (error instanceof PlanRequiredError) return <CareUpsell ctx={ctx} />;
    throw error;
  }
  const day = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const range =
    block.startDate === block.endDate
      ? day(block.startDate)
      : t('care.blocks.range', { from: day(block.startDate), to: day(block.endDate) });
  const when = (value: { date: string; start: string | null; end: string | null }) =>
    value.start && value.end ? `${day(value.date)} · ${value.start}–${value.end}` : day(value.date);
  const outcome = (change: CareBlockChangeDto) =>
    change.outcome === 'MOVED' && change.to
      ? t('care.blocks.movedTo', { when: when(change.to) })
      : change.outcome === 'CANCELLED'
        ? t('care.blocks.cancelledNotCharged')
        : t('care.blocks.toReschedule');
  const emailLabel = (contract: CareBlockContractDto) => {
    if (!contract.hasEmail) return t('care.blocks.noEmail');
    if (!contract.email) return t('care.blocks.emailNotSent');
    return t(`care.blocks.emailStatus.${contract.email.status}`);
  };
  const touched = block.counts.moved + block.counts.toReschedule + block.counts.cancelled;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.agenda.blocks}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('care.blocks.back')}
      </Link>
      <PageHeader
        title={block.label}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="first-letter:uppercase">{range}</span>
            <span>
              {block.slot
                ? t('care.blocks.slotOnly', { start: block.slot.start, end: block.slot.end })
                : t('care.blocks.wholeDay')}
            </span>
            {block.removedAt ? (
              <Badge variant="outline">{t('care.blocks.removedBadge')}</Badge>
            ) : (
              <Badge variant="secondary">{t(`care.blocks.actions.${block.action}`)}</Badge>
            )}
          </span>
        }
        actions={
          block.canWrite ? (
            <RemoveBlockButton
              action={removeCareBlockAction.bind(null, ctx.tenantSlug, block.id)}
            />
          ) : null
        }
      />

      {created ? (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>
            {touched === 0
              ? t('care.blocks.createdNone')
              : t('care.blocks.created', {
                  moved: block.counts.moved,
                  toReschedule: block.counts.toReschedule,
                  cancelled: block.counts.cancelled,
                })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('care.blocks.affectedTitle')}</CardTitle>
          <CardDescription>
            {touched === 0
              ? t('care.blocks.affectedNone')
              : t('care.blocks.affectedSubtitle', { count: block.contracts.length })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {block.contracts.length > 0 ? (
            <ul className="divide-y rounded-xl border" data-testid="block-contracts">
              {block.contracts.map((contract) => (
                <li key={contract.subscriptionId} className="space-y-2 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link
                        href={routes.subscriptions.detail(contract.subscriptionId)}
                        className="font-medium break-words hover:underline"
                      >
                        {contract.numberLabel} · {contract.customerName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{emailLabel(contract)}</p>
                    </div>
                    {block.canWrite &&
                    block.emailsAllowed &&
                    contract.hasEmail &&
                    (contract.email === null || contract.email.retryable) ? (
                      <SendNoticeButton
                        action={sendCareBlockNoticeAction.bind(
                          null,
                          ctx.tenantSlug,
                          block.id,
                          contract.subscriptionId,
                        )}
                        retry={contract.email !== null}
                        label={t('care.blocks.noticeFor', { name: contract.customerName })}
                      />
                    ) : null}
                  </div>
                  <ul className="space-y-1 text-sm">
                    {contract.changes.map((change) => (
                      <li
                        key={change.visitId}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                      >
                        <Clock
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <Link
                          href={routes.agenda.visit(change.visitId)}
                          className="first-letter:uppercase hover:underline"
                        >
                          {when(change.from)}
                        </Link>
                        <ArrowRight
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span
                          className={
                            change.outcome === 'MOVED' ? 'font-medium' : 'text-muted-foreground'
                          }
                        >
                          {outcome(change)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {block.removedAt
              ? t('care.blocks.removedNote')
              : t(`care.blocks.futureNote.${block.action}`)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
