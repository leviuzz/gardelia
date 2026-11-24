import {
  ArrowLeft,
  CalendarPlus,
  CircleAlert,
  KeyRound,
  MailCheck,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Play,
  UserRound,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getCareExtraVisitOptions,
  getCareVisitMoveOptions,
  getCareVisitSheet,
  getPublicLink,
  hasPermission,
  listCareAssignees,
  listCareMaterialOptions,
  listCareVisitCollections,
  publicLinkUrl,
  type CareVisitSheetDto,
  type TenantContext,
} from '@floral/core';
import {
  CARE_EMAIL_RETRY,
  CARE_LIMITS,
  addDays,
  getMarket,
  mapsPlaceUrl,
  todayInTimeZone,
  toIsoDate,
  whatsappLink,
} from '@floral/domain';
import { ExtraVisitBadge, VisitStatusBadge } from '@/components/care/care-ui';
import { CollectionStatusBadge } from '@/components/care/charge-ui';
import { CareCollectionDialog } from '@/components/care/collection-forms';
import { ExtraVisitDialog } from '@/components/care/extra-forms';
import { CareUpsell } from '@/components/care/care-upsell';
import { VisitAssignForm, VisitCancelDialog, VisitMoveForm } from '@/components/care/visit-forms';
import { VisitPhotos } from '@/components/care/visit-photos';
import { VisitReportView } from '@/components/care/visit-report';
import {
  AllPlantsOkButton,
  FinishVisitDialog,
  FollowUpForm,
  MaterialsEditor,
  NotDoneDialog,
  PlantChecklistItem,
  SendReportButton,
  ServiceChecklistItem,
  VisitNoteForm,
} from '@/components/care/visit-work';
import { ShareLinkPanel } from '@/components/common/share-link-card';
import { ActionButton } from '@/components/form/action-button';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { serverEnv } from '@/lib/env';
import { money, phoneForInput } from '@/lib/format';
import { calendarDate } from '@/lib/quote-ui';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import {
  addCareFollowUpAction,
  assignCareVisitAction,
  cancelCareVisitAction,
  finishCareVisitAction,
  markAllCarePlantsOkAction,
  markCareVisitNotDoneAction,
  moveCareVisitAction,
  removeCareVisitPhotoAction,
  revokeCareVisitLinkAction,
  saveCareVisitNoteAction,
  sendCareVisitReportAction,
  setCareMaterialAction,
  setCarePlantResultAction,
  setCareServiceResultAction,
  shareCareVisitLinkAction,
  startCareVisitAction,
  submitCareVisitCollectionAction,
  uploadCareVisitPhotoAction,
} from '../../actions';
import { createCareExtraVisitAction } from '../../../subscriptions/actions';

async function loadSheet(ctx: TenantContext, visitId: string): Promise<CareVisitSheetDto | null> {
  try {
    return await getCareVisitSheet(ctx, visitId);
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
  const sheet = await loadSheet(ctx, visitId);
  return { title: sheet ? `${t('title')} · ${sheet.visit.numberLabel}` : t('title') };
}

/**
 * Una visita di Floral Care (ADR-075, ADR-078). Programmata: "Empezar visita" o "No se pudo".
 * In corso: la visita dal telefono (servizi, piante, foto, materiali, nota, avvisi) e "Terminar".
 * Chiusa: il resoconto con il suo link e l'email al cliente. Chi gestisce sposta, assegna e
 * cancella (spostare e cancellare con "Sí, avisé al cliente").
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
  const today = todayInTimeZone(ctx.timezone);
  const sheet = await loadSheet(ctx, visitId);
  if (!sheet) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <CareUpsell ctx={ctx} />
      </div>
    );
  }
  const { visit } = sheet;
  const env = serverEnv();
  // Blocco 3b: gli incassi segnati in questa visita e, per una visita da recuperare, il modulo
  // della visita di recupero.
  const canCollect = hasPermission(ctx, 'care:visit');
  const scheduleRecovery = visit.recovery?.canSchedule ?? false;
  const [moveOptions, assignees, materialOptions, link, collections, recoveryOptions] =
    await Promise.all([
      visit.canManage ? getCareVisitMoveOptions(ctx, visit.id) : Promise.resolve(null),
      visit.canManage ? listCareAssignees(ctx) : Promise.resolve(null),
      sheet.can.work && sheet.inventoryEnabled
        ? listCareMaterialOptions(ctx, visit.id)
        : Promise.resolve([]),
      sheet.can.share
        ? getPublicLink(ctx, env.BETTER_AUTH_SECRET, { kind: 'CARE_VISIT', id: visit.id })
        : Promise.resolve(null),
      canCollect ? listCareVisitCollections(ctx, visit.id) : Promise.resolve([]),
      scheduleRecovery
        ? getCareExtraVisitOptions(ctx, visit.subscriptionId)
        : Promise.resolve(null),
    ]);
  const recoveryAssignees =
    recoveryOptions === null ? [] : (assignees ?? (await listCareAssignees(ctx)));
  const collectable = visit.status === 'IN_PROGRESS' || visit.status === 'DONE';
  const pendingCollection = collections.some((collection) => collection.status === 'PENDING');
  const price = (minor: number) => money(minor, ctx.currency);
  const shopLocale = getMarket(ctx.country).defaultLocale;
  const tShop = await getTranslations({ locale: shopLocale });

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
  const working = visit.status === 'IN_PROGRESS';
  const closed = sheet.report !== null;
  const channel = { emailsAllowed: sheet.emailsAllowed, customerHasEmail: sheet.customerHasEmail };
  const progress = t('care.visitWork.progress', {
    servicesDone: sheet.progress.servicesDone,
    services: sheet.progress.services,
    plantsMarked: sheet.progress.plantsMarked,
    plants: sheet.progress.plants,
    photos: sheet.progress.photos,
  });
  const phone = sheet.place.contactPhone ?? sheet.place.customerPhone;
  const activePlants = sheet.plants.filter((plant) => !plant.removed);
  const plantDetails = (plant: (typeof sheet.plants)[number]) =>
    [t(`care.offer.sizes.${plant.size}`), plant.speciesName, plant.location, plant.watering]
      .filter(Boolean)
      .join(' · ');
  const publicUrl = link ? publicLinkUrl(env.APP_URL, 'CARE_VISIT', link.token) : null;
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
            <Link
              href={routes.subscriptions.detail(visit.subscriptionId)}
              className="hover:underline"
            >
              {label}
            </Link>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {visit.extra ? <ExtraVisitBadge kind={visit.extra.kind} /> : null}
              <VisitStatusBadge status={visit.status} />
              {visit.status === 'NOT_DONE' && visit.notDoneCause ? (
                <span>{t(`care.visit.notDoneCauses.${visit.notDoneCause}`)}</span>
              ) : null}
              {visit.recovery && !visit.recovery.visitId ? (
                <Badge variant="warning">{t('care.recovery.toRecover')}</Badge>
              ) : null}
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
        {visit.recoveryOf ? (
          <p className="text-sm">
            <Link
              href={routes.agenda.visit(visit.recoveryOf.visitId)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {t('care.recovery.recoveryOf', { date: shortDay(visit.recoveryOf.date) })}
            </Link>
          </p>
        ) : null}
        {visit.recovery?.visitId && visit.recovery.date ? (
          <p className="text-sm">
            <Link
              href={routes.agenda.visit(visit.recovery.visitId)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {t('care.recovery.recoveredOn', { date: shortDay(visit.recovery.date) })}
            </Link>
          </p>
        ) : null}
        {visit.recovery && !visit.recovery.visitId ? (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground">{t('care.recovery.toRecoverHint')}</p>
            {recoveryOptions ? (
              <ExtraVisitDialog
                action={createCareExtraVisitAction.bind(null, slug, visit.subscriptionId)}
                idPrefix="recovery"
                options={recoveryOptions.options.map((option) => ({
                  value: `${option.date}_${option.slotId}`,
                  label: t('care.visit.option', {
                    date: shortDay(option.date),
                    start: option.start,
                    end: option.end,
                    count: option.free,
                  }),
                }))}
                quotes={[]}
                assignees={recoveryAssignees}
                visitFeeLabel={price(recoveryOptions.visitFeeMinor)}
                dates={{ first: recoveryOptions.firstDate, last: recoveryOptions.lastDate }}
                defaults={{
                  kind: 'EXTRA',
                  fee: 'FREE',
                  followUpId: null,
                  recovery: {
                    visitId: visit.id,
                    dateLabel: shortDay(visit.date ?? visit.originalDate),
                  },
                }}
                trigger={
                  <Button className="w-full shrink-0 sm:w-auto">
                    <CalendarPlus />
                    {t('care.recovery.schedule')}
                  </Button>
                }
              />
            ) : null}
          </div>
        ) : null}
        {visit.extra ? (
          <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
            {t(`care.extra.fees.${visit.extra.fee}`)}
            {visit.extra.fee === 'VISIT_FEE' && hasPermission(ctx, 'subscriptions:write')
              ? ` · ${money(visit.extra.feeMinor, ctx.currency)}`
              : ''}
            {visit.extra.note ? (
              <span className="block break-words text-muted-foreground">{visit.extra.note}</span>
            ) : null}
          </p>
        ) : null}
        {working ? (
          <p className="text-sm text-muted-foreground">
            {sheet.startedAt
              ? t('care.visitWork.startedAt', {
                  time: format.dateTime(sheet.startedAt, {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: ctx.timezone,
                  }),
                  name: sheet.startedBy ?? '',
                })
              : null}{' '}
            · {progress}
          </p>
        ) : null}
      </div>

      {visit.canStart || (visit.canMarkNotDone && !working) ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {visit.canStart ? (
            <ActionButton
              action={startCareVisitAction.bind(null, slug, visit.id)}
              size="lg"
              icon={<Play />}
              className="w-full sm:w-auto"
            >
              {t('care.visitWork.start')}
            </ActionButton>
          ) : null}
          {visit.canMarkNotDone && !working ? (
            <NotDoneDialog
              action={markCareVisitNotDoneAction.bind(null, slug, visit.id)}
              label={label}
              note={visit.outcomeNote}
              channel={channel}
            />
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('care.visit.siteTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {sheet.place.address ? (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 break-words">{sheet.place.address}</span>
            </p>
          ) : null}
          {sheet.place.contactName || phone ? (
            <p className="flex items-start gap-2">
              <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                {[sheet.place.contactName, phone ? phoneForInput(phone) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </p>
          ) : null}
          {sheet.place.accessNotes ? (
            <p className="flex items-start gap-2">
              <KeyRound
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="whitespace-pre-line">{sheet.place.accessNotes}</span>
            </p>
          ) : null}
          {visit.assignee ? (
            <p className="flex items-center gap-2">
              <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {t('care.contract.assignee', { name: visit.assignee.name })}
            </p>
          ) : null}
          {sheet.place.address || phone ? (
            <div className="flex flex-wrap gap-2">
              {sheet.place.address ? (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={mapsPlaceUrl(sheet.place.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Navigation />
                    {t('care.visitWork.go')}
                  </a>
                </Button>
              ) : null}
              {phone ? (
                <Button asChild variant="outline" size="sm">
                  <a href={`tel:${phone}`}>
                    <Phone />
                    {t('care.visitWork.call')}
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {working ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('care.visitWork.servicesTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {sheet.checklist.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('care.visitWork.servicesEmpty')}</p>
              ) : (
                <ul className="divide-y rounded-xl border text-sm">
                  {sheet.checklist.map((item) => (
                    <ServiceChecklistItem
                      key={item.serviceId}
                      action={setCareServiceResultAction.bind(null, slug, visit.id)}
                      item={item}
                      disabled={item.removed}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle>
                {t('care.visitWork.plantsTitle', {
                  marked: sheet.progress.plantsMarked,
                  total: sheet.progress.plants,
                })}
              </CardTitle>
              {sheet.progress.plantsMarked < sheet.progress.plants ? (
                <AllPlantsOkButton action={markAllCarePlantsOkAction.bind(null, slug, visit.id)} />
              ) : null}
            </CardHeader>
            <CardContent>
              <ul className="divide-y rounded-xl border text-sm">
                {activePlants.map((plant) => (
                  <PlantChecklistItem
                    key={plant.plantId}
                    action={setCarePlantResultAction.bind(null, slug, visit.id)}
                    plant={{
                      plantId: plant.plantId,
                      name: plant.name,
                      quantity: plant.quantity,
                      details: plantDetails(plant),
                      instructions: plant.instructions,
                      condition: plant.condition,
                      affected: plant.affected,
                      note: plant.note,
                      seasonal: plant.seasonal,
                    }}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      ) : null}

      {working || sheet.photos.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('care.visitWork.photosTitle')}</CardTitle>
            {working ? <CardDescription>{t('care.visitWork.photosHint')}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            <VisitPhotos
              upload={working ? uploadCareVisitPhotoAction.bind(null, slug, visit.id) : null}
              limit={sheet.photoLimit}
              plants={activePlants.map((plant) => ({ plantId: plant.plantId, name: plant.name }))}
              photos={sheet.photos.map((photo) => ({
                id: photo.id,
                plantName:
                  sheet.plants.find((plant) => plant.plantId === photo.plantId)?.name ?? null,
                thumbUrl: routes.agenda.visitPhoto(visit.id, photo.id, { thumb: true }),
                fullUrl: routes.agenda.visitPhoto(visit.id, photo.id),
                removeAction: sheet.can.removePhotos
                  ? removeCareVisitPhotoAction.bind(null, slug, visit.id, photo.id)
                  : null,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {working && sheet.inventoryEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('care.visitWork.materialsTitle')}</CardTitle>
            <CardDescription>{t('care.visitWork.materialsHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <MaterialsEditor
              action={setCareMaterialAction.bind(null, slug, visit.id)}
              materials={sheet.materials}
              options={materialOptions.map((option) => ({
                catalogItemId: option.catalogItemId,
                label: t('care.visitWork.materialOption', {
                  name: option.name,
                  count: option.onHand,
                }),
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {working ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('care.visitWork.noteTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <VisitNoteForm
              action={saveCareVisitNoteAction.bind(null, slug, visit.id)}
              note={visit.outcomeNote}
            />
          </CardContent>
        </Card>
      ) : null}

      {working || sheet.followUps.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('care.followUps.visitTitle')}</CardTitle>
            {working ? <CardDescription>{t('care.followUps.visitHint')}</CardDescription> : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            {sheet.followUps.length > 0 ? (
              <ul className="divide-y rounded-xl border text-sm">
                {sheet.followUps.map((followUp) => (
                  <li
                    key={followUp.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">
                        {t(`care.followUps.kinds.${followUp.kind}`)}
                        {followUp.plantName ? ` · ${followUp.plantName}` : ''}
                      </p>
                      {followUp.note ? (
                        <p className="break-words text-muted-foreground">{followUp.note}</p>
                      ) : null}
                      {followUp.resolutionNote ? (
                        <p className="text-xs break-words text-muted-foreground">
                          {t('care.followUps.resolution', { note: followUp.resolutionNote })}
                        </p>
                      ) : null}
                    </div>
                    {followUp.status === 'OPEN' && sheet.can.resolveFollowUps ? (
                      // Le scelte (reposición, cotización…) stanno nella pagina degli avvisi.
                      <Button asChild variant="secondary" size="sm">
                        <Link href={routes.agenda.followUps()}>{t('care.followUps.resolve')}</Link>
                      </Button>
                    ) : followUp.resolution ? (
                      <Badge variant="muted">
                        {t(`care.followUps.resolutions.${followUp.resolution}`)}
                      </Badge>
                    ) : (
                      <Badge variant={followUp.status === 'OPEN' ? 'warning' : 'muted'}>
                        {t(`care.followUps.statuses.${followUp.status}`)}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {working ? (
              <FollowUpForm
                action={addCareFollowUpAction.bind(null, slug, visit.id)}
                plants={activePlants.map((plant) => ({ plantId: plant.plantId, name: plant.name }))}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {working ? (
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <FinishVisitDialog
            action={finishCareVisitAction.bind(null, slug, visit.id)}
            allOkAction={markAllCarePlantsOkAction.bind(null, slug, visit.id)}
            summary={progress}
            unmarked={sheet.progress.plants - sheet.progress.plantsMarked}
            hasMaterials={sheet.materials.length > 0}
            channel={channel}
            seasonalPlants={sheet.seasonalPickup?.plants ?? null}
          />
          {visit.canMarkNotDone ? (
            <NotDoneDialog
              action={markCareVisitNotDoneAction.bind(null, slug, visit.id)}
              label={label}
              note={visit.outcomeNote}
              channel={channel}
            />
          ) : null}
        </div>
      ) : null}

      {canCollect && (collectable || collections.length > 0) ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>{t('care.collection.title')}</CardTitle>
            {collectable && !pendingCollection ? (
              <CareCollectionDialog
                action={submitCareVisitCollectionAction.bind(null, slug, visit.id)}
                currency={ctx.currency}
              />
            ) : null}
          </CardHeader>
          {collections.length > 0 ? (
            <CardContent>
              <ul className="divide-y rounded-xl border text-sm">
                {collections.map((collection) => (
                  <li key={collection.id} className="space-y-1 px-3 py-2.5">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium tabular-nums">
                        {price(collection.collectedMinor)} ·{' '}
                        {t(`orders.methods.${collection.method}`)}
                      </span>
                      <CollectionStatusBadge status={collection.status} />
                    </p>
                    {collection.status === 'RECORDED' &&
                    collection.amountMinor < collection.collectedMinor ? (
                      <p className="text-muted-foreground">
                        {t('care.collection.recordedLess', {
                          amount: price(collection.amountMinor),
                        })}
                      </p>
                    ) : null}
                    {collection.status === 'REJECTED' && collection.rejectReason ? (
                      <p className="break-words text-[oklch(0.45_0.17_27)]">
                        {t('care.collection.rejectedBecause', {
                          reason: collection.rejectReason,
                        })}
                      </p>
                    ) : null}
                    {collection.note ? (
                      <p className="break-words text-muted-foreground">{collection.note}</p>
                    ) : null}
                    {collection.createdByName ? (
                      <p className="text-xs text-muted-foreground">
                        {t('care.collection.by', { name: collection.createdByName })}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {closed && sheet.report ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('care.report.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <VisitReportView
                report={sheet.report}
                locale={ctx.locale}
                photoSrc={(photoId, thumb) =>
                  routes.agenda.visitPhoto(visit.id, photoId, { thumb })
                }
              />
            </CardContent>
          </Card>

          {sheet.can.share ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('care.report.shareTitle')}</CardTitle>
                <CardDescription>{t('care.report.shareHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ShareLinkPanel
                  shareAction={shareCareVisitLinkAction.bind(null, slug, visit.id)}
                  revokeAction={revokeCareVisitLinkAction.bind(null, slug, visit.id)}
                  unavailableHint={null}
                  manage={sheet.can.manageLink}
                  link={
                    link && publicUrl
                      ? {
                          url: publicUrl,
                          expiresLabel: t('shareLink.expires', {
                            date: format.dateTime(link.expiresAt, {
                              dateStyle: 'long',
                              timeZone: ctx.timezone,
                            }),
                          }),
                          whatsappHref: phone
                            ? whatsappLink(
                                phone,
                                tShop('care.report.whatsapp', {
                                  shop: ctx.tenantName,
                                  url: publicUrl,
                                }),
                              )
                            : null,
                        }
                      : null
                  }
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t('care.report.emailTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {sheet.email?.status === 'SENT' && sheet.email.sentAt ? (
                <p className="flex items-center gap-2">
                  <MailCheck className="size-4 text-success" aria-hidden="true" />
                  {t('care.report.emailSent', {
                    date: format.dateTime(sheet.email.sentAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: ctx.timezone,
                    }),
                  })}
                </p>
              ) : sheet.email &&
                (sheet.email.status === 'PENDING' || sheet.email.status === 'SENDING') ? (
                <p>{t('care.report.emailPending')}</p>
              ) : sheet.email?.status === 'FAILED' ? (
                <p className="flex items-start gap-2 text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t('care.report.emailFailed')}
                </p>
              ) : !sheet.emailsAllowed ? (
                <p className="text-muted-foreground">{t('care.visitWork.reportDemoHint')}</p>
              ) : !sheet.customerHasEmail ? (
                <p className="text-muted-foreground">{t('care.visitWork.reportNoEmailHint')}</p>
              ) : (
                <p className="text-muted-foreground">{t('care.report.emailNotSent')}</p>
              )}
              {sheet.can.sendReport &&
              sheet.emailsAllowed &&
              sheet.customerHasEmail &&
              (!sheet.email ||
                (sheet.email.status === 'FAILED' &&
                  sheet.email.attempts < CARE_EMAIL_RETRY.maxAttempts)) ? (
                <SendReportButton
                  action={sendCareVisitReportAction.bind(null, slug, visit.id)}
                  retry={sheet.email !== null}
                />
              ) : null}
              {phone && publicUrl ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageCircle className="size-3.5" aria-hidden="true" />
                  {t('care.report.whatsappHint')}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      {!working && !closed ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('care.plants.title', { count: visit.plantCount })}</CardTitle>
          </CardHeader>
          <CardContent>
            {activePlants.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('care.plants.empty')}</p>
            ) : (
              <ul className="divide-y rounded-xl border text-sm">
                {activePlants.map((plant) => (
                  <li key={plant.plantId} className="space-y-0.5 px-4 py-3">
                    <p className="font-medium break-words">
                      <span className="tabular-nums">{plant.quantity}</span> × {plant.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{plantDetails(plant)}</p>
                    {plant.instructions ? (
                      <p className="text-xs whitespace-pre-line">{plant.instructions}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {sheet.checklist.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {sheet.checklist.map((service) => (
                  <Badge key={service.serviceId} variant="muted">
                    {service.name}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {visit.canManage && moveOptions ? (
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
              freeTime={
                moveOptions.freeTime
                  ? {
                      first: toIsoDate(today),
                      last: toIsoDate(addDays(today, CARE_LIMITS.moveDaysMax)),
                    }
                  : null
              }
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

      {visit.canManage && assignees && visit.status === 'SCHEDULED' ? (
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

      {visit.canManage ? (
        <div className="flex justify-end">
          <VisitCancelDialog action={cancelCareVisitAction.bind(null, slug, visit.id)} />
        </div>
      ) : null}
    </div>
  );
}
