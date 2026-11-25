import { AlertTriangle, ArrowLeft, Bot, ImageOff, PawPrint, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  PlanRequiredError,
  getAssistantCase,
  getAssistantPanel,
  getCareContract,
  hasPermission,
  listAssistantCases,
  type AssistantAnswerDto,
  type AssistantCaseDto,
  type AssistantSpeciesDto,
  type CareContractDetailDto,
  type TenantContext,
} from '@floral/core';
import { ASSISTANT_LIMITS, isUuid } from '@floral/domain';
import { CareUpsell } from '@/components/care/care-upsell';
import {
  AssistantPhotoForm,
  AssistantQuestionForm,
  type AssistantCandidateOption,
} from '@/components/care/plant-assistant-forms';
import { PrivateImage } from '@/components/common/private-image';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { answerAssistantCaseAction, startAssistantCaseAction } from './actions';

/** La risposta del modello arriva nella stessa richiesta (fino a ~20 s, tetto 45 s). */
export const maxDuration = 60;

type Translator = Awaited<ReturnType<typeof getTranslations>>;

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

async function loadCase(
  ctx: TenantContext,
  caseId: string,
  subscriptionId: string,
): Promise<AssistantCaseDto> {
  try {
    return await getAssistantCase(ctx, caseId, subscriptionId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('assistant');
  return { title: t('title') };
}

/** Luce, acqua, umidità e l'avviso per cani e gatti: SOLO dai nostri dati, mai dal modello. */
function SpeciesFacts({ species, t }: { species: AssistantSpeciesDto; t: Translator }) {
  const care = species.care;
  if (!care) return null;
  const toxicity = [
    t(`assistant.toxicity.${care.petToxicity}`),
    care.toxicitySource ? t('assistant.toxicity.sourceASPCA') : t('assistant.toxicity.noSource'),
    care.reviewed ? null : t('assistant.toxicity.unreviewed'),
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5 rounded-xl bg-muted/50 p-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">
          {t('assistant.answer.careTitle')}
        </p>
        <dl className="grid gap-1">
          <div className="sm:flex sm:gap-2">
            <dt className="font-medium">{t('assistant.answer.light')}</dt>
            <dd>{t(`assistant.care.light.${care.light}`)}</dd>
          </div>
          <div className="sm:flex sm:gap-2">
            <dt className="font-medium">{t('assistant.answer.watering')}</dt>
            <dd>{t(`assistant.care.watering.${care.watering}`)}</dd>
          </div>
          <div className="sm:flex sm:gap-2">
            <dt className="font-medium">{t('assistant.answer.humidity')}</dt>
            <dd>{t(`assistant.care.humidity.${care.humidity}`)}</dd>
          </div>
        </dl>
      </div>
      <Alert
        variant={
          care.petToxicity === 'NON_TOXIC'
            ? 'success'
            : care.petToxicity === 'VARIES'
              ? 'info'
              : 'warning'
        }
        data-testid="assistant-toxicity"
      >
        <PawPrint aria-hidden="true" />
        <AlertDescription>{toxicity}</AlertDescription>
      </Alert>
    </div>
  );
}

function AnswerView({
  answer,
  t,
  when,
}: {
  answer: AssistantAnswerDto;
  t: Translator;
  when: (date: Date) => string;
}) {
  return (
    <article className="grid gap-3 rounded-xl border p-4" data-testid="assistant-answer">
      <div className="grid gap-1">
        <p className="text-xs text-muted-foreground">
          {[
            when(answer.createdAt),
            answer.askedByName ? t('assistant.case.askedBy', { name: answer.askedByName }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p className="text-sm">
          <span className="sr-only">{t('assistant.answer.question')}: </span>
          <q className="italic">{answer.question}</q>
        </p>
      </div>
      <p className="font-medium">
        {answer.species
          ? t('assistant.answer.species', { name: answer.species.name })
          : t('assistant.answer.speciesUnknown')}
        {answer.species ? (
          <span className="ml-1 text-sm font-normal text-muted-foreground italic">
            ({answer.species.scientificName})
          </span>
        ) : null}
      </p>
      <p className="text-sm whitespace-pre-line">{answer.answer}</p>
      {answer.steps.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-sm font-medium">{t('assistant.answer.steps')}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {answer.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {answer.unsure || answer.askFlorist ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{t('assistant.answer.unsure')}</AlertDescription>
        </Alert>
      ) : null}
      {answer.species ? <SpeciesFacts species={answer.species} t={t} /> : null}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Bot className="size-3.5 shrink-0" aria-hidden="true" />
        {t('assistant.aiNotice')}
      </p>
    </article>
  );
}

/**
 * Asistente de plantas (ADR-085), lato fioreria: una foto → 2–3 specie della nostra lista → si
 * conferma o si corregge → che cosa le succede → risposta breve con i passi, più cura e tossicità
 * dai nostri dati. Senza assistente configurato la pagina lo dice e non offre nulla da fare.
 */
export default async function PlantAssistantPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/subscriptions/[subscriptionId]/assistant'>) {
  const { tenantSlug, subscriptionId } = await params;
  const query = await searchParams;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'subscriptions:read') || !hasPermission(ctx, 'care:assistant')) {
    return <Forbidden />;
  }
  const t = await getTranslations();
  const format = await getFormatter();
  const routes = tenantRoutes(ctx.tenantSlug);
  const contract = await loadContract(ctx, subscriptionId);
  if (!contract) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <CareUpsell ctx={ctx} />
      </div>
    );
  }
  const caseId = typeof query.case === 'string' ? query.case : null;
  const [panel, found, recent] = await Promise.all([
    getAssistantPanel(ctx),
    caseId ? loadCase(ctx, caseId, contract.id) : Promise.resolve(null),
    listAssistantCases(ctx, contract.id, 10),
  ]);
  // Pianta e visita da cui si parte (link della scheda e della visita): solo se sono del contratto
  // (la visita la ricontrolla il servizio).
  const plantParam = typeof query.plant === 'string' ? query.plant : null;
  const startPlant = contract.plants.find((plant) => plant.id === plantParam) ?? null;
  const visitParam = typeof query.visit === 'string' && isUuid(query.visit) ? query.visit : null;
  const open =
    contract.status === 'DRAFT' || contract.status === 'ACTIVE' || contract.status === 'PAUSED';
  const limitReached = panel.usedToday >= panel.dailyLimit;
  const when = (date: Date) =>
    format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short', timeZone: ctx.timezone });
  const newHref = routes.subscriptions.assistant(contract.id, {
    plant: found?.plantId ?? startPlant?.id,
    visit: found?.visitId ?? visitParam ?? undefined,
  });

  const header = (
    <div className="space-y-3">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={routes.subscriptions.detail(contract.id)}>
          <ArrowLeft aria-hidden="true" />
          {t('assistant.back', { number: contract.numberLabel })}
        </Link>
      </Button>
      <PageHeader
        title={t('assistant.title')}
        description={
          <span className="flex flex-col gap-1">
            <span>
              <span className="tabular-nums">{contract.numberLabel}</span> ·{' '}
              {contract.customer.name}
            </span>
            <span>{t('assistant.subtitle')}</span>
          </span>
        }
      />
    </div>
  );

  let body: ReactNode;
  if (found) {
    const record = found.recordSpeciesSlug
      ? panel.species.find((item) => item.slug === found.recordSpeciesSlug)
      : undefined;
    // La specie della scheda viene per prima; poi le candidate del riconoscimento.
    const option = (item: AssistantSpeciesDto, note: string): AssistantCandidateOption => ({
      slug: item.slug,
      name: item.name,
      scientificName: item.scientificName,
      note,
    });
    const candidates: AssistantCandidateOption[] = [
      ...(record ? [option(record, t('assistant.ask.fromRecord'))] : []),
      ...found.candidates
        .filter((item) => item.slug !== record?.slug)
        .map((item) => option(item, t(`assistant.ask.likelihood.${item.likelihood}`))),
    ];
    const last = found.answers.at(-1);
    const defaultSlug = last ? (last.species?.slug ?? '') : (candidates[0]?.slug ?? '');
    const remaining = ASSISTANT_LIMITS.answersPerCase - found.answers.length;
    body = (
      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>{t('assistant.case.title', { date: when(found.createdAt) })}</CardTitle>
            {found.plantName ? <Badge variant="muted">{found.plantName}</Badge> : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            {found.photoAvailable ? (
              <a
                href={routes.subscriptions.assistantPhoto(contract.id, found.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="justify-self-start"
                aria-label={t('assistant.case.openPhoto')}
              >
                <PrivateImage
                  src={routes.subscriptions.assistantPhoto(contract.id, found.id, { thumb: true })}
                  alt={t('assistant.case.photoAlt')}
                  className="size-40 rounded-xl border bg-muted object-cover"
                />
              </a>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <ImageOff className="size-4" aria-hidden="true" />
                {t('assistant.case.photoDeleted')}
              </p>
            )}
            {!found.photoUsable ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription className="grid gap-3">
                  <span>{t('assistant.case.unusable')}</span>
                  {open ? (
                    <Button asChild size="sm" variant="outline" className="justify-self-start">
                      <Link href={newHref}>{t('assistant.case.retakePhoto')}</Link>
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            {found.photoUsable && found.condition ? (
              <div className="grid gap-1 text-sm">
                <p className="font-medium">{t('assistant.case.condition')}</p>
                <p className="text-muted-foreground">{found.condition}</p>
              </div>
            ) : null}
            {found.photoUsable && found.notInList && found.answers.length === 0 ? (
              <Alert variant="info">
                <AlertDescription>{t('assistant.case.notInList')}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        {found.answers.length > 0 ? (
          <div className="grid gap-4" data-testid="assistant-answers">
            {found.answers.map((answer) => (
              <AnswerView key={answer.id} answer={answer} t={t} when={when} />
            ))}
          </div>
        ) : null}

        {found.photoUsable && panel.available ? (
          found.canAsk ? (
            limitReached ? (
              <Alert variant="warning">
                <AlertDescription>
                  {t('assistant.limitReached', { limit: panel.dailyLimit })}
                </AlertDescription>
              </Alert>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <AssistantQuestionForm
                    action={answerAssistantCaseAction.bind(
                      null,
                      ctx.tenantSlug,
                      contract.id,
                      found.id,
                    )}
                    candidates={candidates}
                    species={panel.species.map((item) => ({
                      slug: item.slug,
                      name: item.name,
                      scientificName: item.scientificName,
                    }))}
                    defaultSlug={defaultSlug}
                    again={found.answers.length > 0}
                    remaining={remaining}
                  />
                </CardContent>
              </Card>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('assistant.case.full', { count: ASSISTANT_LIMITS.answersPerCase })}
            </p>
          )
        ) : null}

        {open && panel.available ? (
          <Button asChild variant="outline" className="w-full sm:w-auto sm:justify-self-start">
            <Link href={newHref}>
              <Plus aria-hidden="true" />
              {t('assistant.new.title')}
            </Link>
          </Button>
        ) : null}
      </div>
    );
  } else {
    body = (
      <div className="grid gap-6">
        {panel.available && open ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('assistant.new.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {limitReached ? (
                <Alert variant="warning">
                  <AlertDescription>
                    {t('assistant.limitReached', { limit: panel.dailyLimit })}
                  </AlertDescription>
                </Alert>
              ) : (
                <AssistantPhotoForm
                  action={startAssistantCaseAction.bind(
                    null,
                    ctx.tenantSlug,
                    contract.id,
                    visitParam,
                  )}
                  plants={contract.plants.map((plant) => ({
                    id: plant.id,
                    name: plant.speciesName ? `${plant.name} · ${plant.speciesName}` : plant.name,
                  }))}
                  defaultPlantId={startPlant?.id ?? null}
                />
              )}
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>{t('assistant.new.recentTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('assistant.new.recentEmpty')}</p>
            ) : (
              <ul className="divide-y rounded-xl border text-sm" data-testid="assistant-recent">
                {recent.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={routes.subscriptions.assistant(contract.id, { case: item.id })}
                      className="grid gap-0.5 px-4 py-2.5 hover:bg-muted"
                    >
                      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="font-medium">
                          {item.speciesName ?? t('assistant.new.unknownSpecies')}
                          {item.plantName ? (
                            <span className="font-normal text-muted-foreground">
                              {' '}
                              · {item.plantName}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {when(item.createdAt)}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.firstQuestion
                          ? `${item.firstQuestion} · ${t('assistant.new.answers', { count: item.answers })}`
                          : t('assistant.new.answers', { count: item.answers })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {header}
      {panel.simulated ? (
        <Alert variant="warning" data-testid="assistant-simulated">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{t('assistant.simulated')}</AlertDescription>
        </Alert>
      ) : null}
      {panel.available ? (
        <p className="text-sm text-muted-foreground" data-testid="assistant-usage">
          {t('assistant.usage', { used: panel.usedToday, limit: panel.dailyLimit })}
        </p>
      ) : (
        <Alert variant="info">
          <AlertDescription>{t('assistant.unavailable')}</AlertDescription>
        </Alert>
      )}
      {body}
    </div>
  );
}
