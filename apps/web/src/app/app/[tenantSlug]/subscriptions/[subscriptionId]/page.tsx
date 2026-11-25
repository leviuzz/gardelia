import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  FileText,
  Leaf,
  Pencil,
  Plus,
  ScanSearch,
  Sprout,
  Trash2,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getCareContract,
  getCareContractForm,
  getCareExtraVisitOptions,
  getCarePortalPanel,
  hasPermission,
  isPlantAssistantAvailable,
  listCanonicalFlowers,
  listCareAssignees,
  listCareContractQuotes,
  type CareContractDetailDto,
  type CareContractQuoteDto,
  type CareVisitSummaryDto,
  type TenantContext,
} from '@floral/core';
import {
  CARE_EXTRA_KINDS,
  CARE_LIMITS,
  addDays,
  careMessagePages,
  suggestedCareExtraFee,
  todayInTimeZone,
  toIsoDate,
  type CareExtraKind,
} from '@floral/domain';
import { ContractStatusBadge, ExtraVisitBadge, VisitStatusBadge } from '@/components/care/care-ui';
import { CareMessagesCard } from '@/components/care/care-messages-card';
import { ContractChargesCard } from '@/components/care/contract-charges-card';
import { PlantAssistantCard } from '@/components/care/plant-assistant-card';
import { CareUpsell } from '@/components/care/care-upsell';
import { PortalAccessCard } from '@/components/care/portal-access-card';
import {
  CareDetailsDialog,
  CareEndDialog,
  CarePlantDialog,
  CareRepriceDialog,
  CareScheduleDialog,
} from '@/components/care/contract-forms';
import { ExtraVisitDialog } from '@/components/care/extra-forms';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { QuoteStatusBadge } from '@/components/common/status-badges';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { carePortalDeps } from '@/lib/care-portal';
import { money, phoneForInput } from '@/lib/format';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  addCarePlantAction,
  changeCareScheduleAction,
  confirmCareContractAction,
  createCareExtraVisitAction,
  createCareQuoteAction,
  discardCareContractAction,
  endCareContractAction,
  removeCarePlantAction,
  repriceCareContractAction,
  updateCareContractDetailsAction,
  updateCarePlantAction,
} from '../actions';
import { contractFormOptions, weekdayNamer } from '../care-form-data';

async function loadContract(
  ctx: TenantContext,
  subscriptionId: string,
): Promise<CareContractDetailDto | null> {
  try {
    return await getCareContract(ctx, subscriptionId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof PlanRequiredError) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/subscriptions/[subscriptionId]'>): Promise<Metadata> {
  const { tenantSlug, subscriptionId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations('care.contracts');
  if (!hasPermission(ctx, 'subscriptions:read')) return { title: t('title') };
  const contract = await loadContract(ctx, subscriptionId);
  return { title: contract ? `${contract.numberLabel} · ${contract.customer.name}` : t('title') };
}

/**
 * Scheda di un contratto di Floral Care (ADR-075): sede e dati pratici, calendario, piante della
 * diagnosi, prezzo salvato e quello di oggi, prossime visite. In bozza: piante, poi "Confirmar".
 * Confermato: calendario, servizi, prezzo e fine, con "Sí, avisé al cliente" se toccano visite.
 */
export default async function CareContractPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/subscriptions/[subscriptionId]'>) {
  const { tenantSlug, subscriptionId } = await params;
  const query = await searchParams;
  const created = query.created === '1';
  // Da un avviso di pianta morta: "Reposición sin costo" apre il modulo della visita extra.
  const fromFollowUp = typeof query.followUp === 'string' ? query.followUp : null;
  const openExtra = typeof query.extra === 'string' ? query.extra : null;
  // «Ver mensajes anteriores» (ADR-084): quante pagine del filo mostrare.
  const messagePages = careMessagePages(query.mensajes);
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:read')) return <Forbidden />;
  const t = await getTranslations();
  const format = await getFormatter();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={routes.subscriptions.list()}>
        <ArrowLeft aria-hidden="true" />
        {t('care.contract.back')}
      </Link>
    </Button>
  );
  const contract = await loadContract(ctx, subscriptionId);
  if (!contract) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        {back}
        <CareUpsell ctx={ctx} />
      </div>
    );
  }

  // "Acceso del cliente" (ADR-084): solo per chi gestisce i contratti.
  const portal = hasPermission(ctx, 'subscriptions:write')
    ? await getCarePortalPanel(ctx, subscriptionId, carePortalDeps())
    : null;
  const currency = contract.currency;
  const isDraft = contract.status === 'DRAFT';
  const isActive = contract.status === 'ACTIVE' || contract.status === 'PAUSED';
  const canWrite = contract.canWrite;
  // Asistente de plantas (ADR-085): solo se configurato; le consultas nuove sui contratti aperti.
  const assistantOn = hasPermission(ctx, 'care:assistant') && isPlantAssistantAvailable();
  const canConsult = assistantOn && (isDraft || isActive);
  const dayName = await weekdayNamer();
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const longDay = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'long', timeZone: 'UTC' });
  const slotText = contract.slots
    .map((slot) =>
      t('care.slots.label', { day: dayName(slot.weekday), start: slot.start, end: slot.end }),
    )
    .join(' · ');
  const species = canWrite
    ? (await listCanonicalFlowers(ctx.locale))
        .filter((flower) => flower.category === 'PLANT' || flower.category === 'FOLIAGE')
        .map((flower) => ({ id: flower.id, name: flower.name }))
    : [];
  const form = canWrite ? await getCareContractForm(ctx, contract.customer.id) : null;
  const options = form ? await contractFormOptions(form) : null;
  const today = todayInTimeZone(ctx.timezone);
  const canExtra = canWrite && contract.status === 'ACTIVE';
  const canQuote = canWrite && isActive && hasPermission(ctx, 'quotes:write');
  const [extraOptions, assignees, contractQuotes] = await Promise.all([
    canExtra ? getCareExtraVisitOptions(ctx, contract.id) : Promise.resolve(null),
    canExtra ? listCareAssignees(ctx) : Promise.resolve([]),
    isDraft
      ? Promise.resolve([] as readonly CareContractQuoteDto[])
      : listCareContractQuotes(ctx, contract.id),
  ]);
  const seasonalPlants = contract.plants
    .filter((plant) => plant.seasonal)
    .reduce((total, plant) => total + plant.quantity, 0);
  const priceLabel = (minor: number) => money(minor, currency);
  const monthLabel = (monthly: { minMinor: number; maxMinor: number }) =>
    monthly.minMinor === monthly.maxMinor
      ? priceLabel(monthly.minMinor)
      : t('care.simulator.range', {
          min: priceLabel(monthly.minMinor),
          max: priceLabel(monthly.maxMinor),
        });

  const extraDialog = (
    kind: CareExtraKind,
    options: {
      readonly idPrefix: string;
      readonly trigger?: ReactNode;
      readonly open?: boolean;
      readonly followUpId?: string | null;
    },
  ) =>
    extraOptions ? (
      <ExtraVisitDialog
        action={createCareExtraVisitAction.bind(null, slug, contract.id)}
        idPrefix={options.idPrefix}
        options={extraOptions.options.map((option) => ({
          value: `${option.date}_${option.slotId}`,
          label: t('care.visit.option', {
            date: day(option.date),
            start: option.start,
            end: option.end,
            count: option.free,
          }),
        }))}
        quotes={extraOptions.quotes.map((quote) => ({
          id: quote.id,
          label: quote.title ? `${quote.numberLabel} · ${quote.title}` : quote.numberLabel,
        }))}
        assignees={assignees}
        visitFeeLabel={priceLabel(extraOptions.visitFeeMinor)}
        dates={{ first: extraOptions.firstDate, last: extraOptions.lastDate }}
        defaults={{
          kind,
          fee: options.followUpId
            ? 'FREE'
            : suggestedCareExtraFee(
                kind,
                extraOptions.deadPlantPolicy,
                extraOptions.quotes.length > 0,
              ),
          followUpId: options.followUpId ?? null,
        }}
        defaultOpen={options.open ?? false}
        trigger={options.trigger}
      />
    ) : null;
  const openKind = CARE_EXTRA_KINDS.find((kind) => kind === openExtra) ?? null;

  const visitRow = (visit: CareVisitSummaryDto) => (
    <li key={visit.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="font-medium">
          {visit.date ? (
            <Link href={routes.agenda.day({ date: visit.date })} className="hover:underline">
              {day(visit.date)}
              {visit.start && visit.end ? ` · ${visit.start}–${visit.end}` : ''}
            </Link>
          ) : (
            t('care.contract.wasOn', { date: day(visit.originalDate) })
          )}
        </p>
        {visit.assigneeName ? (
          <p className="text-xs text-muted-foreground">
            {t('care.contract.assignee', { name: visit.assigneeName })}
          </p>
        ) : null}
        {/* Sotto la data: due etichette lunghe accanto allo stato non stanno in 320 px. */}
        {visit.extraKind ? (
          <p className="mt-1">
            <ExtraVisitBadge kind={visit.extraKind} />
          </p>
        ) : null}
      </div>
      <span className="flex shrink-0 flex-wrap justify-end gap-1">
        <VisitStatusBadge status={visit.status} />
        {visit.cancelReason === 'SHOP' || visit.cancelReason === 'CUSTOMER' ? (
          <Badge variant="outline">{t(`care.cancelReasons.${visit.cancelReason}`)}</Badge>
        ) : null}
      </span>
    </li>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-3">
        {back}
        <PageHeader
          title={
            <>
              <span className="tabular-nums">{contract.numberLabel}</span> ·{' '}
              <Link
                href={routes.customers.detail(contract.customer.id)}
                className="hover:underline"
              >
                {contract.customer.name}
              </Link>
            </>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <ContractStatusBadge status={contract.status} />
              {contract.frequency ? (
                <span>{t(`care.offer.frequencyNames.${contract.frequency}`)}</span>
              ) : null}
              {slotText ? <span>{slotText}</span> : null}
            </span>
          }
        />
      </div>

      {created && isDraft ? (
        <Alert variant="success">
          <AlertDescription>{t('care.contracts.created')}</AlertDescription>
        </Alert>
      ) : null}
      {isDraft ? (
        <Alert variant="info">
          <Leaf aria-hidden="true" />
          <AlertDescription>{t('care.contract.draftNotice')}</AlertDescription>
        </Alert>
      ) : null}
      {contract.issues.archivedSlots ||
      contract.issues.frequencyUnavailable ||
      contract.issues.addressArchived ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            {[
              contract.issues.archivedSlots ? t('care.contract.issueSlots') : null,
              contract.issues.frequencyUnavailable ? t('care.contract.issueFrequency') : null,
              contract.issues.addressArchived ? t('care.contract.issueAddress') : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </AlertDescription>
        </Alert>
      ) : null}
      {contract.toReschedule > 0 ? (
        <Alert variant="warning">
          <CalendarClock aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('care.contract.toReschedule', { count: contract.toReschedule })}</span>
            <Button asChild size="sm" variant="outline">
              <Link href={routes.agenda.toReschedule}>{t('care.contract.toRescheduleLink')}</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {contract.priceOutdated && contract.saved && contract.current ? (
        <Alert variant="info">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {t('care.contract.priceOutdated', {
                saved: priceLabel(contract.saved.perVisitMinor),
                current: priceLabel(contract.current.perVisitMinor),
              })}
            </span>
            {canWrite ? (
              <CareRepriceDialog
                action={repriceCareContractAction.bind(null, slug, contract.id)}
                from={priceLabel(contract.saved.perVisitMinor)}
                to={priceLabel(contract.current.perVisitMinor)}
              />
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {contract.status === 'ENDED' && contract.endDate ? (
        <Alert variant="info">
          <AlertDescription>
            {t('care.contract.ended', { date: longDay(contract.endDate) })}
          </AlertDescription>
        </Alert>
      ) : null}
      {isActive && contract.endDate ? (
        <Alert variant="info">
          <AlertDescription>
            {t('care.contract.endsOn', { date: longDay(contract.endDate) })}
          </AlertDescription>
        </Alert>
      ) : null}

      {canWrite && isDraft ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <ConfirmActionDialog
            action={confirmCareContractAction.bind(null, slug, contract.id)}
            confirmVariant="default"
            trigger={
              <Button className="w-full sm:w-auto" disabled={contract.plants.length === 0}>
                <CheckCircle2 />
                {t('care.contract.confirm')}
              </Button>
            }
            title={t('care.contract.confirmTitle', { number: contract.numberLabel })}
            description={
              contract.current
                ? t('care.contract.confirmBody', {
                    price: priceLabel(contract.current.perVisitMinor),
                    month: monthLabel(contract.current.monthly),
                  })
                : t('care.contract.confirmBodyNoPrice')
            }
            confirmLabel={t('care.contract.confirmSubmit')}
          />
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={routes.subscriptions.edit(contract.id)}>
              <Pencil />
              {t('care.contract.editDraft')}
            </Link>
          </Button>
          <ConfirmActionDialog
            action={discardCareContractAction.bind(null, slug, contract.id)}
            trigger={
              <Button variant="ghost" className="w-full text-muted-foreground sm:ml-auto sm:w-auto">
                <Trash2 />
                {t('care.contract.discard')}
              </Button>
            }
            title={t('care.contract.discardTitle', { number: contract.numberLabel })}
            description={t('care.contract.discardBody')}
            confirmLabel={t('care.contract.discardSubmit')}
          />
        </div>
      ) : null}
      {canWrite && isActive && form && options && contract.frequency ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <CareScheduleDialog
            action={changeCareScheduleAction.bind(null, slug, contract.id)}
            frequencies={form.frequencies}
            slots={options.slots}
            start={{ min: form.startMin, max: form.startMax }}
            upcomingVisits={contract.upcomingCount}
            defaults={{
              frequency: contract.frequency,
              slotIds: contract.slots.filter((slot) => slot.active).map((slot) => slot.id),
              seats: String(contract.seats),
              startDate: toIsoDate(addDays(today, 1)),
            }}
          />
          <CareDetailsDialog
            action={updateCareContractDetailsAction.bind(null, slug, contract.id)}
            currency={currency}
            services={[
              ...options.services,
              // I servizi del contratto poi archiviati restano scelti.
              ...contract.services.filter(
                (service) =>
                  !options.services.some((option) => option.serviceId === service.serviceId),
              ),
            ]}
            defaults={{
              serviceIds: contract.services.map((service) => service.serviceId),
              contactName: contract.contactName ?? '',
              contactPhone: phoneForInput(contract.contactPhone),
              accessNotes: contract.accessNotes ?? '',
              notes: contract.notes ?? '',
            }}
          />
          {extraDialog(openKind ?? 'EXTRA', {
            idPrefix: 'extra-main',
            open: openKind !== null,
            followUpId: openKind === 'REPLACEMENT' ? fromFollowUp : null,
          })}
          {canQuote ? (
            <ActionButton
              action={createCareQuoteAction.bind(null, slug, contract.id, 'EXTRA', null)}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              <FileText />
              {t('care.extra.quoteButton')}
            </ActionButton>
          ) : null}
          <CareEndDialog
            action={endCareContractAction.bind(null, slug, contract.id)}
            upcomingVisits={contract.upcomingCount}
            range={{
              min: contract.startDate,
              max: toIsoDate(addDays(today, 365)),
              suggested:
                contract.startDate > toIsoDate(today) ? contract.startDate : toIsoDate(today),
            }}
          />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <CardTitle>{t('care.plants.title', { count: contract.plantCount })}</CardTitle>
              {canWrite && contract.plants.length < CARE_LIMITS.plants ? (
                <CarePlantDialog
                  action={addCarePlantAction.bind(null, slug, contract.id)}
                  idPrefix="plant-new"
                  species={species}
                  title={t('care.plants.addTitle')}
                  submitLabel={t('care.plants.add')}
                  defaults={{
                    name: '',
                    speciesId: '',
                    quantity: '1',
                    size: 'MEDIUM',
                    location: '',
                    light: '',
                    watering: '',
                    instructions: '',
                    seasonal: false,
                  }}
                  trigger={
                    <Button size="sm" variant="secondary">
                      <Plus />
                      {t('care.plants.add')}
                    </Button>
                  }
                />
              ) : null}
            </CardHeader>
            <CardContent>
              {contract.plants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {canWrite ? t('care.plants.emptyWrite') : t('care.plants.empty')}
                </p>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {contract.plants.map((plant) => (
                    <li key={plant.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium break-words">
                          <span className="tabular-nums">{plant.quantity}</span> × {plant.name}
                          {plant.seasonal ? (
                            <Badge variant="accent" className="ml-2 align-middle">
                              {t('care.plants.seasonalBadge')}
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            t(`care.offer.sizes.${plant.size}`),
                            plant.speciesName,
                            plant.location,
                            plant.light ? t(`care.plants.lights.${plant.light}`) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {plant.instructions ? (
                          <p className="text-xs whitespace-pre-line">{plant.instructions}</p>
                        ) : null}
                      </div>
                      {canWrite || canConsult ? (
                        <span className="flex shrink-0 gap-1">
                          {canConsult ? (
                            <Button
                              asChild
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('assistant.card.askPlant', { name: plant.name })}
                              title={t('assistant.card.askPlant', { name: plant.name })}
                            >
                              <Link
                                href={routes.subscriptions.assistant(contract.id, {
                                  plant: plant.id,
                                })}
                              >
                                <ScanSearch />
                              </Link>
                            </Button>
                          ) : null}
                          {canWrite ? (
                            <>
                              <CarePlantDialog
                                action={updateCarePlantAction.bind(
                                  null,
                                  slug,
                                  contract.id,
                                  plant.id,
                                )}
                                idPrefix={`plant-${plant.id}`}
                                species={species}
                                title={t('care.plants.editTitle', { name: plant.name })}
                                submitLabel={t('common.saveChanges')}
                                defaults={{
                                  name: plant.name,
                                  speciesId: plant.speciesId ?? '',
                                  quantity: String(plant.quantity),
                                  size: plant.size,
                                  location: plant.location ?? '',
                                  light: plant.light ?? '',
                                  watering: plant.watering ?? '',
                                  instructions: plant.instructions ?? '',
                                  seasonal: plant.seasonal,
                                }}
                                trigger={
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('care.plants.editLabel', { name: plant.name })}
                                  >
                                    <Pencil />
                                  </Button>
                                }
                              />
                              <ConfirmActionDialog
                                action={removeCarePlantAction.bind(
                                  null,
                                  slug,
                                  contract.id,
                                  plant.id,
                                )}
                                trigger={
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('care.plants.removeLabel', { name: plant.name })}
                                  >
                                    <Trash2 />
                                  </Button>
                                }
                                title={t('care.plants.removeTitle', { name: plant.name })}
                                description={t('care.plants.removeBody')}
                                confirmLabel={t('care.plants.removeSubmit')}
                              />
                            </>
                          ) : null}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {isDraft ? null : (
            <Card>
              <CardHeader>
                <CardTitle>{t('care.contract.visitsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {contract.upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('care.contract.noUpcoming')}</p>
                ) : (
                  <>
                    <ul className="divide-y rounded-xl border text-sm">
                      {contract.upcoming.map(visitRow)}
                    </ul>
                    {contract.upcomingCount > contract.upcoming.length ? (
                      <p className="text-xs text-muted-foreground">
                        {t('care.contract.moreUpcoming', {
                          count: contract.upcomingCount - contract.upcoming.length,
                        })}
                      </p>
                    ) : null}
                  </>
                )}
                {contract.recent.length > 0 ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">{t('care.contract.recentTitle')}</h3>
                    <ul className="divide-y rounded-xl border text-sm">
                      {contract.recent.map(visitRow)}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {isDraft ? null : (
            <CareMessagesCard ctx={ctx} subscriptionId={contract.id} pages={messagePages} />
          )}
          {assistantOn ? (
            <PlantAssistantCard ctx={ctx} subscriptionId={contract.id} canStart={canConsult} />
          ) : null}
          {contract.canPayments ? (
            <ContractChargesCard
              ctx={ctx}
              subscriptionId={contract.id}
              customerId={contract.customer.id}
            />
          ) : null}
          {isActive && (canWrite || contractQuotes.length > 0) ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sprout className="size-5 text-primary" aria-hidden="true" />
                  {t('care.seasonal.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {canWrite ? (
                  <>
                    <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                      <li>{t('care.seasonal.step1')}</li>
                      <li>{t('care.seasonal.step2', { count: seasonalPlants })}</li>
                      <li>{t('care.seasonal.step3')}</li>
                    </ol>
                    <div className="flex flex-col gap-2">
                      {canQuote ? (
                        <ActionButton
                          action={createCareQuoteAction.bind(
                            null,
                            slug,
                            contract.id,
                            'SEASONAL',
                            null,
                          )}
                          variant="secondary"
                          className="w-full"
                        >
                          <FileText />
                          {t('care.seasonal.quote')}
                        </ActionButton>
                      ) : null}
                      {extraDialog('SEASONAL_INSTALL', {
                        idPrefix: 'extra-install',
                        trigger: (
                          <Button variant="outline" className="w-full">
                            {t('care.seasonal.install')}
                          </Button>
                        ),
                      })}
                      {extraDialog('SEASONAL_PICKUP', {
                        idPrefix: 'extra-pickup',
                        trigger: (
                          <Button variant="outline" className="w-full">
                            {t('care.seasonal.pickup')}
                          </Button>
                        ),
                      })}
                    </div>
                  </>
                ) : null}
                {contractQuotes.length > 0 ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">{t('care.seasonal.quotesTitle')}</h3>
                    <ul className="divide-y rounded-xl border">
                      {contractQuotes.map((quote) => (
                        <li
                          key={quote.id}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <Link
                            href={routes.quotes.detail(quote.id)}
                            className="min-w-0 hover:underline"
                          >
                            <span className="block font-medium tabular-nums">
                              {quote.numberLabel}
                            </span>
                            {quote.title ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {quote.title}
                              </span>
                            ) : null}
                          </Link>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <QuoteStatusBadge status={quote.status} />
                            <span className="text-xs tabular-nums">
                              {money(quote.totalMinor, quote.currency)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{t('care.contract.priceTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {contract.saved ? (
                <dl className="grid gap-2 rounded-xl bg-muted/50 p-4">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('care.contract.savedPerVisit')}</dt>
                    <dd className="font-semibold tabular-nums">
                      {priceLabel(contract.saved.perVisitMinor)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('care.simulator.perMonth')}</dt>
                    <dd className="tabular-nums">{monthLabel(contract.saved.monthly)}</dd>
                  </div>
                  {contract.saved.oneTimeMinor > 0 ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t('care.contract.oneTime')}</dt>
                      <dd className="tabular-nums">{priceLabel(contract.saved.oneTimeMinor)}</dd>
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {t('care.contract.priceVersion', { version: contract.priceVersion })}
                  </p>
                </dl>
              ) : null}
              {contract.current && (isDraft || contract.priceOutdated) ? (
                <dl className="grid gap-2">
                  {isDraft ? null : (
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('care.contract.todayPrice')}
                    </p>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('care.contract.visitFee')}</dt>
                    <dd className="tabular-nums">{priceLabel(contract.current.visitFeeMinor)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {contract.travel?.kind === 'in_range' ||
                      contract.travel?.kind === 'out_of_range'
                        ? t('care.contract.travelKm', { km: contract.travel.distanceKm })
                        : t('care.contract.travel')}
                    </dt>
                    <dd className="tabular-nums">
                      {priceLabel(contract.current.travelSurchargeMinor)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {t('care.contract.care', { count: contract.current.plantCount })}
                    </dt>
                    <dd className="tabular-nums">{priceLabel(contract.current.careMinor)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('care.contract.extras')}</dt>
                    <dd className="tabular-nums">{priceLabel(contract.current.extrasMinor)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
                    <dt>{t('care.simulator.perVisit')}</dt>
                    <dd className="tabular-nums">{priceLabel(contract.current.perVisitMinor)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('care.simulator.perMonth')}</dt>
                    <dd className="tabular-nums">{monthLabel(contract.current.monthly)}</dd>
                  </div>
                  {contract.current.oneTimeMinor > 0 ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t('care.contract.oneTime')}</dt>
                      <dd className="tabular-nums">{priceLabel(contract.current.oneTimeMinor)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {isDraft && !contract.current ? (
                <p className="text-muted-foreground">{t('care.contract.noPriceYet')}</p>
              ) : null}
              {contract.travel?.kind === 'unknown' && contract.current ? (
                <p className="text-xs text-muted-foreground">{t('care.contract.travelUnknown')}</p>
              ) : null}
              {contract.outOfRange ? (
                <p className="text-xs text-[oklch(0.42_0.1_65)]">{t('care.contract.outOfRange')}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('care.contract.siteTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                {contract.address ? (
                  <div>
                    <dt className="text-muted-foreground">{t('care.contractForm.address')}</dt>
                    <dd>
                      {contract.address.label ? (
                        <span className="block font-medium">{contract.address.label}</span>
                      ) : null}
                      {contract.address.line}, {contract.address.city}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-muted-foreground">{t('care.contract.dates')}</dt>
                  <dd>
                    {contract.endDate
                      ? t('care.contract.fromTo', {
                          from: longDay(contract.startDate),
                          to: longDay(contract.endDate),
                        })
                      : t('care.contract.from', { from: longDay(contract.startDate) })}
                  </dd>
                </div>
                {contract.seats > 1 ? (
                  <div>
                    <dt className="text-muted-foreground">{t('care.contractForm.seats')}</dt>
                    <dd>{contract.seats}</dd>
                  </div>
                ) : null}
                {contract.contactName || contract.contactPhone ? (
                  <div>
                    <dt className="text-muted-foreground">{t('care.contractForm.contactName')}</dt>
                    <dd>
                      {[
                        contract.contactName,
                        contract.contactPhone ? phoneForInput(contract.contactPhone) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </dd>
                  </div>
                ) : null}
                {contract.accessNotes ? (
                  <div>
                    <dt className="text-muted-foreground">{t('care.contractForm.accessNotes')}</dt>
                    <dd className="whitespace-pre-line">{contract.accessNotes}</dd>
                  </div>
                ) : null}
                {contract.notes ? (
                  <div>
                    <dt className="text-muted-foreground">{t('care.contractForm.notes')}</dt>
                    <dd className="whitespace-pre-line">{contract.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('care.contractForm.servicesTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {contract.services.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('care.contract.noServices')}</p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {contract.services.map((service) => (
                    <li key={service.serviceId} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 break-words">{service.name}</span>
                      <Badge variant={service.pricing === 'INCLUDED' ? 'muted' : 'accent'}>
                        {service.pricing === 'INCLUDED'
                          ? t('care.services.included')
                          : t(`care.services.priceBy.${service.unit}`, {
                              price: priceLabel(service.priceMinor),
                            })}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {portal ? (
            <PortalAccessCard slug={ctx.tenantSlug} panel={portal} draft={isDraft} />
          ) : null}

          {contract.rules ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('care.rules.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <ul className="list-disc space-y-1 pl-5">
                  <li>{t(`care.rules.missed.${contract.rules.missedVisitPolicy}`)}</li>
                  <li>{t(`care.rules.deadPlant.${contract.rules.deadPlantPolicy}`)}</li>
                  <li>
                    {contract.rules.lateCancelHours > 0
                      ? t('care.rules.lateCancel', { hours: contract.rules.lateCancelHours })
                      : t('care.rules.lateCancelNever')}
                  </li>
                  <li>
                    {contract.rules.minNoticeHours > 0
                      ? t('care.rules.changeNotice', { hours: contract.rules.minNoticeHours })
                      : t('care.rules.changeNoticeNone')}
                  </li>
                </ul>
                <p className="text-xs text-muted-foreground">{t('care.rules.subtitle')}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
