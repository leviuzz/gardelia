import { AlertTriangle, ArrowLeft, ImageOff, MessageSquarePlus, Plus, Send } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import {
  getMyAssistantCase,
  getMyAssistantPanel,
  type AssistantSpeciesDto,
  type MyAssistantCaseDto,
  type MyAssistantPanelDto,
} from '@floral/core';
import { ASSISTANT_LIMITS, resolveLocale } from '@floral/domain';
import { AssistantAnswerView } from '@/components/care/assistant-answer';
import {
  AssistantPhotoForm,
  AssistantQuestionForm,
  type AssistantCandidateOption,
} from '@/components/care/plant-assistant-forms';
import { PrivateImage } from '@/components/common/private-image';
import { ActionButton } from '@/components/form/action-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getBuyerContext } from '@/lib/buyer';
import { orNotFound } from '@/lib/care-portal';
import { accountRoutes } from '@/lib/routes';
import {
  answerMyAssistantCaseAction,
  askMoreAssistantCreditsAction,
  sendMyAssistantCaseAction,
  startMyAssistantCaseAction,
} from './actions';

/** La risposta del modello arriva nella stessa richiesta (pochi secondi, tetto 45 s). */
export const maxDuration = 60;

type Translator = Awaited<ReturnType<typeof getTranslations>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('assistant');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** Senza crediti: il messaggio e «Pedir (más) consultas» alla fioreria. */
function AskForCredits({
  panel,
  subscriptionId,
  t,
}: {
  readonly panel: MyAssistantPanelDto;
  readonly subscriptionId: string;
  readonly t: Translator;
}) {
  const first = panel.credits.allocated === 0;
  return (
    <Alert variant="info" data-testid="assistant-no-credits">
      <AlertDescription className="grid gap-3">
        <span>
          {first
            ? t('assistant.none', { shop: panel.shopName })
            : t('assistant.noCredits', { shop: panel.shopName })}
        </span>
        <ActionButton
          action={askMoreAssistantCreditsAction.bind(null, subscriptionId)}
          variant="outline"
          size="sm"
          className="justify-self-start"
          icon={<MessageSquarePlus aria-hidden="true" />}
        >
          {first ? t('assistant.more.first') : t('assistant.more.action')}
        </ActionButton>
      </AlertDescription>
    </Alert>
  );
}

function CaseView({
  panel,
  found,
  subscriptionId,
  t,
  when,
}: {
  readonly panel: MyAssistantPanelDto;
  readonly found: MyAssistantCaseDto;
  readonly subscriptionId: string;
  readonly t: Translator;
  readonly when: (date: Date) => string;
}) {
  const routes = accountRoutes.care;
  const record = found.recordSpeciesSlug
    ? panel.species.find((item) => item.slug === found.recordSpeciesSlug)
    : undefined;
  // La specie della scheda della pianta viene per prima; poi le candidate del riconoscimento.
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
  const canAsk = panel.open && found.photoUsable && found.answersLeft > 0;

  let ask: ReactNode = null;
  if (canAsk) {
    if (panel.credits.remaining === 0) {
      ask = <AskForCredits panel={panel} subscriptionId={subscriptionId} t={t} />;
    } else if (panel.answersLimitReached) {
      ask = (
        <Alert variant="warning">
          <AlertDescription>
            {t('assistant.answersLimit', { limit: ASSISTANT_LIMITS.contractAnswersPerDay })}
          </AlertDescription>
        </Alert>
      );
    } else {
      ask = (
        <Card>
          <CardContent className="pt-6">
            <AssistantQuestionForm
              action={answerMyAssistantCaseAction.bind(null, subscriptionId, found.id)}
              candidates={candidates}
              species={panel.species.map((item) => ({
                slug: item.slug,
                name: item.name,
                scientificName: item.scientificName,
              }))}
              defaultSlug={defaultSlug}
              defaultKind={found.defaultKind}
              again={found.answers.length > 0}
              remaining={found.answersLeft}
            />
          </CardContent>
        </Card>
      );
    }
  } else if (panel.open && found.photoUsable) {
    ask = (
      <p className="text-sm text-muted-foreground">
        {t('assistant.case.full', { count: ASSISTANT_LIMITS.answersPerCase })}
      </p>
    );
  }

  return (
    <div className="grid gap-6" data-testid="assistant-case">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('assistant.case.title', { date: when(found.createdAt) })}</CardTitle>
          {found.plantName ? <Badge variant="muted">{found.plantName}</Badge> : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          {found.photoAvailable ? (
            <a
              href={routes.assistantPhoto(subscriptionId, found.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="justify-self-start"
              aria-label={t('assistant.case.openPhoto')}
            >
              <PrivateImage
                src={routes.assistantPhoto(subscriptionId, found.id, { thumb: true })}
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
                {panel.open ? (
                  <Button asChild size="sm" variant="outline" className="justify-self-start">
                    <Link href={routes.assistant(subscriptionId)}>
                      {t('assistant.case.retakePhoto')}
                    </Link>
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {found.photoUsable && found.condition ? (
            <div className="grid gap-1 text-sm">
              <p className="font-medium">{t('assistant.case.condition')}</p>
              <p className="break-words text-muted-foreground">{found.condition}</p>
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
            <AssistantAnswerView key={answer.id} answer={answer} t={t} when={when} />
          ))}
        </div>
      ) : null}

      {ask}

      {panel.open && found.answers.length > 0 ? (
        <Card data-testid="assistant-share">
          <CardHeader>
            <CardTitle>{t('assistant.share.title', { shop: panel.shopName })}</CardTitle>
            <CardDescription>{t('assistant.share.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionButton
              action={sendMyAssistantCaseAction.bind(null, subscriptionId, found.id)}
              variant="outline"
              className="w-full sm:w-auto"
              icon={<Send aria-hidden="true" />}
            >
              {t('assistant.share.action')}
            </ActionButton>
          </CardContent>
        </Card>
      ) : null}

      {panel.open ? (
        <Button asChild variant="outline" className="w-full sm:w-auto sm:justify-self-start">
          <Link href={routes.assistant(subscriptionId)}>
            <Plus aria-hidden="true" />
            {t('assistant.new.title')}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

function NewConsultation({
  panel,
  subscriptionId,
  t,
  when,
}: {
  readonly panel: MyAssistantPanelDto;
  readonly subscriptionId: string;
  readonly t: Translator;
  readonly when: (date: Date) => string;
}) {
  let start: ReactNode = null;
  if (panel.open) {
    if (panel.credits.remaining === 0) {
      start = <AskForCredits panel={panel} subscriptionId={subscriptionId} t={t} />;
    } else if (panel.photosLimitReached) {
      start = (
        <Alert variant="warning">
          <AlertDescription>
            {t('assistant.photosLimit', { limit: ASSISTANT_LIMITS.contractCasesPerDay })}
          </AlertDescription>
        </Alert>
      );
    } else {
      start = (
        <div className="grid gap-3">
          <AssistantPhotoForm
            action={startMyAssistantCaseAction.bind(null, subscriptionId)}
            plants={panel.plants}
            defaultPlantId={null}
          />
          <p className="text-xs text-muted-foreground">{t('assistant.new.free')}</p>
        </div>
      );
    }
  }
  return (
    <div className="grid gap-6">
      {panel.open ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('assistant.new.title')}</CardTitle>
          </CardHeader>
          <CardContent>{start}</CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('assistant.new.recentTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {panel.cases.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('assistant.new.recentEmpty')}</p>
          ) : (
            <ul className="divide-y rounded-xl border text-sm" data-testid="assistant-recent">
              {panel.cases.map((item) => (
                <li key={item.id}>
                  <Link
                    href={accountRoutes.care.assistant(subscriptionId, { caso: item.id })}
                    className="grid gap-0.5 px-4 py-2.5 hover:bg-muted"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="font-medium break-words">
                        {item.speciesName ?? t('assistant.new.unknownSpecies')}
                        {item.plantName ? (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            · {item.plantName}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{when(item.createdAt)}</span>
                    </span>
                    <span className="text-xs break-words text-muted-foreground">
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

/**
 * Asistente de plantas del cliente (ADR-085, blocco 6b): una foto → 2–3 specie della nostra lista
 * → «Cómo cuidarla» o «Tiene un problema» → la domanda → risposta breve con i passi, più cura e
 * avviso per cani e gatti dai nostri dati. 1 credito per risposta; «Enviar a la florería» manda il
 * caso nel filo dei messaggi. Senza assistente configurato la pagina lo dice e non offre nulla.
 */
export default async function MyAssistantPage({
  params,
  searchParams,
}: PageProps<'/cuenta/floral-care/[subscriptionId]/asistente'>) {
  const { subscriptionId } = await params;
  const query = await searchParams;
  const caseId = typeof query.caso === 'string' ? query.caso : null;
  const ctx = await getBuyerContext(
    accountRoutes.care.assistant(subscriptionId, caseId ? { caso: caseId } : undefined),
  );
  const [t, format, rawLocale] = await Promise.all([
    getTranslations(),
    getFormatter(),
    getLocale(),
  ]);
  const locale = resolveLocale(rawLocale);
  const [panel, found] = await Promise.all([
    orNotFound(getMyAssistantPanel(ctx, subscriptionId, locale)),
    caseId
      ? orNotFound(getMyAssistantCase(ctx, subscriptionId, caseId, locale))
      : Promise.resolve(null),
  ]);
  const when = (date: Date) =>
    format.dateTime(date, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: panel.shopTimeZone,
    });

  return (
    <div className="space-y-6">
      <Link
        href={accountRoutes.care.contract(subscriptionId)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('account.care.backContract')}
      </Link>
      <div className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-primary uppercase">{panel.shopName}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t('assistant.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('assistant.subtitle')}</p>
      </div>
      {panel.simulated ? (
        <Alert variant="warning" data-testid="assistant-simulated">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{t('assistant.simulated')}</AlertDescription>
        </Alert>
      ) : null}
      {!panel.available ? (
        <Alert variant="info">
          <AlertDescription>{t('assistant.unavailable')}</AlertDescription>
        </Alert>
      ) : panel.open ? (
        <div className="space-y-1">
          <p className="font-medium" data-testid="assistant-credits">
            {t('assistant.credits', { count: panel.credits.remaining })}
          </p>
          <p className="text-xs text-muted-foreground">{t('assistant.creditsHint')}</p>
        </div>
      ) : (
        <Alert variant="info">
          <AlertDescription>{t('assistant.closed')}</AlertDescription>
        </Alert>
      )}
      {!panel.available ? null : found ? (
        <CaseView panel={panel} found={found} subscriptionId={subscriptionId} t={t} when={when} />
      ) : (
        <NewConsultation panel={panel} subscriptionId={subscriptionId} t={t} when={when} />
      )}
    </div>
  );
}
