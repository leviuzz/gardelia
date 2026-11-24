import { ArrowLeft, KeyRound, MapPin, Phone, UserRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getCareContract,
  getCareVisit,
  getCareVisitMoveOptions,
  hasPermission,
  listCareAssignees,
  type CareAgendaVisitDto,
  type TenantContext,
} from '@floral/core';
import { VisitStatusBadge } from '@/components/care/care-ui';
import { CareUpsell } from '@/components/care/care-upsell';
import {
  VisitAssignForm,
  VisitCancelDialog,
  VisitMoveForm,
  VisitOutcomeDialog,
} from '@/components/care/visit-forms';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { phoneForInput } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  assignCareVisitAction,
  cancelCareVisitAction,
  completeCareVisitAction,
  markCareVisitNotDoneAction,
  moveCareVisitAction,
} from '../../actions';

async function loadVisit(ctx: TenantContext, visitId: string): Promise<CareAgendaVisitDto | null> {
  try {
    return await getCareVisit(ctx, visitId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/agenda/visits/[visitId]'>): Promise<Metadata> {
  const { tenantSlug, visitId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations('care.visit');
  if (!hasPermission(ctx, 'subscriptions:read')) return { title: t('title') };
  const visit = await loadVisit(ctx, visitId);
  return { title: visit ? `${t('title')} · ${visit.numberLabel}` : t('title') };
}

/**
 * Una visita di Floral Care (ADR-074): dove, chi la fa, le piante con le loro indicazioni e
 * l'accesso alla sede. "Hecha" o "No se pudo" per tutta la squadra; spostare, cancellare e
 * assegnare per chi gestisce (spostare e cancellare con "Sí, avisé al cliente").
 */
export default async function CareVisitPage({
  params,
}: PageProps<'/app/[tenantSlug]/agenda/visits/[visitId]'>) {
  const { tenantSlug, visitId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:read')) return <Forbidden />;
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const visit = await loadVisit(ctx, visitId);
  if (!visit) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <CareUpsell ctx={ctx} />
      </div>
    );
  }
  const contract = await getCareContract(ctx, visit.subscriptionId);
  const canManage = visit.canManage;
  const [moveOptions, assignees] = canManage
    ? await Promise.all([getCareVisitMoveOptions(ctx, visit.id), listCareAssignees(ctx)])
    : [null, null];
  const day = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  const shortDay = (iso: string) =>
    format.dateTime(calendarDate(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const label = `${visit.numberLabel} · ${visit.customerName}`;
  const back = visit.date ? (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.agenda.day({ date: visit.date })}>
        <ArrowLeft aria-hidden="true" />
        {t('care.visit.backToDay')}
      </Link>
    </Button>
  ) : (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.agenda.toReschedule}>
        <ArrowLeft aria-hidden="true" />
        {t('care.visit.backToReschedule')}
      </Link>
    </Button>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader
          title={
            <Link href={routes.subscriptions.detail(contract.id)} className="hover:underline">
              {label}
            </Link>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <VisitStatusBadge status={visit.status} />
              <span className="first-letter:uppercase">
                {visit.date
                  ? `${day(visit.date)}${visit.start && visit.end ? ` · ${visit.start}–${visit.end}` : ''}`
                  : t('care.agenda.wasOn', { date: day(visit.originalDate) })}
              </span>
              {visit.moved ? (
                <span>{t('care.agenda.movedFrom', { date: shortDay(visit.originalDate) })}</span>
              ) : null}
            </span>
          }
        />
      </div>

      {visit.canClose ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <VisitOutcomeDialog
            action={completeCareVisitAction.bind(null, slug, visit.id)}
            outcome="DONE"
            idPrefix="visit-done"
            label={label}
          />
          <VisitOutcomeDialog
            action={markCareVisitNotDoneAction.bind(null, slug, visit.id)}
            outcome="NOT_DONE"
            idPrefix="visit-not-done"
            label={label}
          />
        </div>
      ) : null}
      {visit.outcomeNote ? (
        <p className="rounded-2xl border bg-card p-4 text-sm whitespace-pre-line">
          {visit.outcomeNote}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('care.visit.siteTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {contract.address ? (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                {contract.address.label ? (
                  <span className="block font-medium">{contract.address.label}</span>
                ) : null}
                {contract.address.line}, {contract.address.city}
              </span>
            </p>
          ) : null}
          {contract.contactName || contract.contactPhone ? (
            <p className="flex items-start gap-2">
              <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                {[
                  contract.contactName,
                  contract.contactPhone ? phoneForInput(contract.contactPhone) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </p>
          ) : null}
          {contract.accessNotes ? (
            <p className="flex items-start gap-2">
              <KeyRound
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="whitespace-pre-line">{contract.accessNotes}</span>
            </p>
          ) : null}
          {visit.assignee ? (
            <p className="flex items-center gap-2">
              <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {t('care.contract.assignee', { name: visit.assignee.name })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('care.plants.title', { count: contract.plantCount })}</CardTitle>
        </CardHeader>
        <CardContent>
          {contract.plants.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('care.plants.empty')}</p>
          ) : (
            <ul className="divide-y rounded-xl border text-sm">
              {contract.plants.map((plant) => (
                <li key={plant.id} className="space-y-0.5 px-4 py-3">
                  <p className="font-medium break-words">
                    <span className="tabular-nums">{plant.quantity}</span> × {plant.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      t(`care.offer.sizes.${plant.size}`),
                      plant.speciesName,
                      plant.location,
                      plant.watering,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {plant.instructions ? (
                    <p className="text-xs whitespace-pre-line">{plant.instructions}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {contract.services.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {contract.services.map((service) => (
                <Badge key={service.serviceId} variant="muted">
                  {service.name}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canManage && moveOptions ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {visit.status === 'TO_RESCHEDULE'
                ? t('care.visit.scheduleTitle')
                : t('care.visit.moveTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">{t('care.visit.moveHint')}</p>
            <VisitMoveForm
              action={moveCareVisitAction.bind(null, slug, visit.id)}
              options={moveOptions.options.map((option) => ({
                value: `${option.date}_${option.slotId}`,
                label: t('care.visit.option', {
                  date: shortDay(option.date),
                  start: option.start,
                  end: option.end,
                  count: option.free,
                }),
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {canManage && assignees && visit.status === 'SCHEDULED' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('care.visit.assignTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <VisitAssignForm
              action={assignCareVisitAction.bind(null, slug, visit.id)}
              assignees={assignees}
              current={visit.assignee?.membershipId ?? null}
            />
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <div className="flex justify-end">
          <VisitCancelDialog action={cancelCareVisitAction.bind(null, slug, visit.id)} />
        </div>
      ) : null}
    </div>
  );
}
