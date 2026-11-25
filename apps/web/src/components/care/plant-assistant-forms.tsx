'use client';

/**
 * Asistente de plantas (ADR-085), lato fioreria: la foto da riconoscere e la domanda sul caso.
 * La foto si riduce nel browser prima dell'invio (il server la ricodifica comunque); specie,
 * domanda, limiti e budget li ricontrolla il servizio.
 */
import { ImagePlus, LoaderCircle, ScanSearch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { ASSISTANT_LIMITS, PHOTO_LIMITS } from '@floral/domain';
import { PrivateImage } from '@/components/common/private-image';
import { Field, controlProps } from '@/components/form/field';
import { FormAlert } from '@/components/form/form-alert';
import { RadioCard } from '@/components/form/radio-card';
import { SubmitButton } from '@/components/form/submit-button';
import { prepareImageForUpload } from '@/components/photos/use-photo-upload';
import { Button } from '@/components/ui/button';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface AssistantPlantOption {
  readonly id: string;
  readonly name: string;
}

/**
 * «Analizar foto»: una foto (fotocamera o galleria) e, se si sa, la pianta del contratto. Va al
 * caso appena creato (redirect dell'azione); errori, limiti e budget restano qui.
 */
export function AssistantPhotoForm({
  action,
  plants,
  defaultPlantId,
}: {
  readonly action: Action;
  readonly plants: readonly AssistantPlantOption[];
  readonly defaultPlantId: string | null;
}) {
  const t = useTranslations('assistant.new');
  const tValidation = useTranslations('validation');
  const [state, dispatch, pending] = useActionState(action, idleState);
  const input = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [plantId, setPlantId] = useState(defaultPlantId ?? '');
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = pending || preparing;

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  function choose(next: File | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = next ? URL.createObjectURL(next) : null;
    setFile(next);
    setPreview(previewUrl.current);
    setLocalError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setLocalError(t('photoRequired'));
      return;
    }
    setPreparing(true);
    let prepared: File;
    try {
      prepared = await prepareImageForUpload(file, PHOTO_LIMITS.clientMaxSide);
    } finally {
      setPreparing(false);
    }
    if (prepared.size > PHOTO_LIMITS.maxUploadBytes) {
      setLocalError(tValidation('file_too_large'));
      return;
    }
    const data = new FormData();
    data.set('file', prepared);
    data.set('plantId', plantId);
    setLocalError(null);
    startTransition(() => dispatch(data));
  }

  const photoError = localError ?? fieldError(state, 'file');
  // L'errore della foto sta accanto al campo: in alto resta solo il resto (limiti, budget…).
  const generalState = fieldError(state, 'file') ? idleState : state;
  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4" data-testid="assistant-photo">
      <FormAlert state={generalState} />
      {plants.length > 0 ? (
        <Field id="assistant-plant" label={t('plant')}>
          <NativeSelect
            id="assistant-plant"
            value={plantId}
            onChange={(event) => setPlantId(event.target.value)}
            disabled={busy}
          >
            <option value="">{t('plantNone')}</option>
            {plants.map((plant) => (
              <option key={plant.id} value={plant.id}>
                {plant.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <Field
        id="assistant-photo"
        label={t('photo')}
        error={photoError ?? undefined}
        hint={t('tip')}
      >
        <div className="grid gap-3">
          {preview ? (
            <PrivateImage
              src={preview}
              alt={t('previewAlt')}
              loading="eager"
              className="max-h-72 w-full rounded-xl border bg-muted object-contain"
            />
          ) : null}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            data-testid="assistant-photo-input"
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
            {...controlProps('assistant-photo', photoError ?? undefined, true)}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto sm:justify-self-start"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <ImagePlus aria-hidden="true" />
            {file ? t('changePhoto') : t('choosePhoto')}
          </Button>
        </div>
      </Field>
      <div className="grid gap-2">
        <Button
          type="submit"
          className="w-full sm:w-auto sm:justify-self-start"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <ScanSearch aria-hidden="true" />
          )}
          {t('submit')}
        </Button>
        {busy ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('analyzing')}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export interface AssistantSpeciesOption {
  readonly slug: string;
  readonly name: string;
  readonly scientificName: string;
}

export interface AssistantCandidateOption extends AssistantSpeciesOption {
  /** «Muy probable», «Según la ficha de la planta»…: già scritto. */
  readonly note: string;
}

const OTHER = '__other';

/**
 * La domanda sul caso: la specie (le candidate, «Otra» dall'elenco o «No sé») e che cosa le
 * succede. La prima volta la specie si sceglie; dopo resta quella dell'ultima risposta.
 */
export function AssistantQuestionForm({
  action,
  candidates,
  species,
  defaultSlug,
  again,
  remaining,
}: {
  readonly action: Action;
  readonly candidates: readonly AssistantCandidateOption[];
  /** Tutte le piante della lista, per «Otra». */
  readonly species: readonly AssistantSpeciesOption[];
  /** La specie scelta all'inizio ('' = «No sé»). */
  readonly defaultSlug: string;
  /** È «Otra pregunta» (il caso ha già una risposta). */
  readonly again: boolean;
  readonly remaining: number;
}) {
  const t = useTranslations('assistant.ask');
  const question = useRef<HTMLTextAreaElement>(null);
  // Fatta la domanda, il campo si svuota per «Otra pregunta» (la specie scelta resta).
  const [state, formAction] = useToastActionState(action, () => {
    if (question.current) question.current.value = '';
  });
  const inCandidates = defaultSlug === '' || candidates.some((item) => item.slug === defaultSlug);
  const [choice, setChoice] = useState(inCandidates ? defaultSlug : OTHER);
  const [other, setOther] = useState(inCandidates ? '' : defaultSlug);
  const [otherError, setOtherError] = useState<string | null>(null);
  const questionError = fieldError(state, 'question');
  const speciesError = otherError ?? fieldError(state, 'speciesSlug');
  const resolved = choice === OTHER ? other : choice;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (choice === OTHER && other === '') {
      event.preventDefault();
      setOtherError(t('otherRequired'));
      return;
    }
    setOtherError(null);
    preserveOnSubmit(formAction)(event);
  }

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="grid gap-4"
      data-testid="assistant-ask"
    >
      <input type="hidden" name="speciesSlug" value={resolved} />
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">
          {again ? t('speciesLegendAgain') : t('speciesLegend')}
        </legend>
        {candidates.map((item) => (
          <RadioCard
            key={item.slug}
            name="speciesChoice"
            value={item.slug}
            checked={choice === item.slug}
            onChange={() => setChoice(item.slug)}
          >
            <span className="block">{item.name}</span>
            <span className="block text-xs font-normal text-muted-foreground">
              <i>{item.scientificName}</i> · {item.note}
            </span>
          </RadioCard>
        ))}
        <RadioCard
          name="speciesChoice"
          value={OTHER}
          checked={choice === OTHER}
          onChange={() => setChoice(OTHER)}
        >
          {t('other')}
        </RadioCard>
        {choice === OTHER ? (
          <Field id="assistant-other" label={t('otherSelect')} error={speciesError ?? undefined}>
            <NativeSelect
              {...controlProps('assistant-other', speciesError ?? undefined)}
              value={other}
              onChange={(event) => {
                setOther(event.target.value);
                setOtherError(null);
              }}
            >
              <option value="">{t('otherPlaceholder')}</option>
              {species.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name} ({item.scientificName})
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <RadioCard
          name="speciesChoice"
          value=""
          checked={choice === ''}
          onChange={() => setChoice('')}
        >
          {t('unknown')}
        </RadioCard>
      </fieldset>
      <Field
        id="assistant-question"
        label={again ? t('questionAgain') : t('question')}
        error={questionError}
        hint={t('remaining', { count: remaining })}
      >
        <Textarea
          {...controlProps('assistant-question', questionError, true)}
          ref={question}
          name="question"
          required
          maxLength={ASSISTANT_LIMITS.question}
          rows={3}
          placeholder={t('placeholder')}
        />
      </Field>
      <div>
        <SubmitButton className="w-full sm:w-auto" pendingLabel={t('thinking')}>
          {t('submit')}
        </SubmitButton>
      </div>
    </form>
  );
}
