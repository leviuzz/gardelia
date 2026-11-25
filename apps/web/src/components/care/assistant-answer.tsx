import 'server-only';
import { AlertTriangle, Bot, PawPrint } from 'lucide-react';
import type { getTranslations } from 'next-intl/server';
import type { AssistantSpeciesDto, MyAssistantAnswerDto } from '@floral/core';
import { Alert, AlertDescription } from '@/components/ui/alert';

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * Luce, acqua, umidità e l'avviso per cani e gatti della specie: SOLO dai nostri dati
 * (`CanonicalFlower.care`, con la fonte), mai dal modello (ADR-085).
 */
export function AssistantSpeciesFacts({
  species,
  t,
}: {
  readonly species: AssistantSpeciesDto;
  readonly t: Translator;
}) {
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

/** Una risposta: la domanda, la specie, la risposta breve con i passi, i nostri dati e l'avviso dell'IA. */
export function AssistantAnswerView({
  answer,
  t,
  when,
}: {
  readonly answer: MyAssistantAnswerDto;
  readonly t: Translator;
  readonly when: (date: Date) => string;
}) {
  return (
    <article className="grid gap-3 rounded-xl border p-4" data-testid="assistant-answer">
      <div className="grid gap-1">
        <p className="text-xs text-muted-foreground">
          {when(answer.createdAt)} · {t(`assistant.ask.kind.${answer.kind}`)}
        </p>
        <p className="text-sm break-words">
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
      <p className="text-sm break-words whitespace-pre-line">{answer.answer}</p>
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
      {answer.species ? <AssistantSpeciesFacts species={answer.species} t={t} /> : null}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Bot className="size-3.5 shrink-0" aria-hidden="true" />
        {t('assistant.aiNotice')}
      </p>
    </article>
  );
}
