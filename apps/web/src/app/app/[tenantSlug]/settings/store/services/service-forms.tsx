'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { PHOTO_LIMITS, STOREFRONT_SERVICE_LIMITS } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { PhotoFilesField, PhotoUploadFooter } from '@/components/photos/photo-upload-parts';
import { usePhotoUpload } from '@/components/photos/use-photo-upload';
import { Checkbox, Input, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * I testi di un servizio in vetrina (M5): descrizione, cosa include e «Desde $X»; per un servizio
 * della fioreria anche il nome e se il modulo chiede la data e l'indirizzo. I predefiniti hanno il
 * nome tradotto da noi e le loro domande.
 */
export function ServiceTextsForm({
  action,
  custom,
  currency,
  defaults,
}: {
  readonly action: Action;
  readonly custom: boolean;
  readonly currency: string;
  readonly defaults: {
    readonly name: string;
    readonly description: string;
    readonly includes: string;
    readonly priceFrom: string;
    readonly askDate: boolean;
    readonly askAddress: boolean;
  };
}) {
  const t = useTranslations('storeServices.form');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-5"
      data-testid="service-texts-form"
    >
      {custom ? (
        <Field id="service-name" label={t('name')} error={err('name')} required>
          <Input
            {...controlProps('service-name', err('name'), true)}
            name="name"
            defaultValue={defaults.name}
            maxLength={STOREFRONT_SERVICE_LIMITS.name}
            required
          />
        </Field>
      ) : null}
      <Field
        id="service-description"
        label={t('description')}
        hint={t('descriptionHint')}
        error={err('description')}
      >
        <Textarea
          {...controlProps('service-description', err('description'))}
          name="description"
          defaultValue={defaults.description}
          maxLength={STOREFRONT_SERVICE_LIMITS.description}
          rows={4}
        />
      </Field>
      <Field
        id="service-includes"
        label={t('includes')}
        hint={t('includesHint')}
        error={err('includes')}
      >
        <Textarea
          {...controlProps('service-includes', err('includes'))}
          name="includes"
          defaultValue={defaults.includes}
          maxLength={STOREFRONT_SERVICE_LIMITS.includes}
          rows={3}
        />
      </Field>
      <Field
        id="service-price-from"
        label={t('priceFrom', { currency })}
        hint={t('priceFromHint')}
        error={err('priceFrom')}
        className="sm:max-w-xs"
      >
        <Input
          {...controlProps('service-price-from', err('priceFrom'))}
          name="priceFrom"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaults.priceFrom}
        />
      </Field>
      {custom ? (
        <div className="grid gap-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
            <Checkbox name="askDate" defaultChecked={defaults.askDate} className="mt-0.5" />
            <span className="grid gap-1">
              <span className="text-sm font-medium">{t('askDate')}</span>
              <span className="text-sm text-muted-foreground">{t('askDateHint')}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
            <Checkbox name="askAddress" defaultChecked={defaults.askAddress} className="mt-0.5" />
            <span className="grid gap-1">
              <span className="text-sm font-medium">{t('askAddress')}</span>
              <span className="text-sm text-muted-foreground">{t('askAddressHint')}</span>
            </span>
          </label>
        </div>
      ) : null}
      <SubmitButton className="w-fit">{t('save')}</SubmitButton>
    </form>
  );
}

/** «Nuovo servizio»: basta il nome; il resto si scrive nella sua scheda. */
export function NewServiceForm({ action }: { readonly action: Action }) {
  const t = useTranslations('storeServices.new');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      data-testid="new-service-form"
    >
      <Field id="new-service-name" label={t('name')} hint={t('nameHint')} error={err('name')}>
        <Input
          {...controlProps('new-service-name', err('name'), true)}
          name="name"
          maxLength={STOREFRONT_SERVICE_LIMITS.name}
          required
        />
      </Field>
      <SubmitButton className="w-fit">{t('create')}</SubmitButton>
    </form>
  );
}

/** Le foto del servizio, una alla volta e ridotte nel browser (come le foto del catalogo). */
export function ServicePhotoUploader({
  upload,
  remaining,
}: {
  readonly upload: (formData: FormData) => Promise<ActionState>;
  readonly remaining: number;
}) {
  const t = useTranslations('storeServices.photos');
  const state = usePhotoUpload(upload, {
    maxFiles: remaining,
    maxSide: PHOTO_LIMITS.clientMaxSide,
  });
  return (
    <form method="post" onSubmit={state.onSubmit} className="space-y-4">
      <PhotoFilesField
        id="service-photo-files"
        hint={t('hint', { max: STOREFRONT_SERVICE_LIMITS.photos })}
        error={state.fieldErrors.files ?? state.fieldErrors.file}
      />
      <PhotoUploadFooter state={state} submitLabel={t('upload')} />
    </form>
  );
}
