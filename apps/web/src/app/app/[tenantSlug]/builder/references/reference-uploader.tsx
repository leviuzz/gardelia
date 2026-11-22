'use client';

import { useTranslations } from 'next-intl';
import { controlProps, Field } from '@/components/form/field';
import { PhotoFilesField, PhotoUploadFooter } from '@/components/photos/photo-upload-parts';
import { usePhotoUpload } from '@/components/photos/use-photo-upload';
import { Checkbox, Input, NativeSelect } from '@/components/ui/input';
import type { ActionState } from '@/lib/action-state';

/** Caricamento in "Mis ramos": stile e nota valgono per tutte le foto; consenso obbligatorio. */
export function ReferenceUploader({
  upload,
  styles,
  remaining,
  maxSide,
  captionMax,
}: {
  upload: (formData: FormData) => Promise<ActionState>;
  styles: readonly { value: string; label: string }[];
  remaining: number;
  maxSide: number;
  captionMax: number;
}) {
  const t = useTranslations('styleReferences');
  const tPhotos = useTranslations('photos');
  const state = usePhotoUpload(upload, { maxFiles: remaining, maxSide });
  const err = (field: string) => state.fieldErrors[field];

  return (
    <form method="post" onSubmit={state.onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="reference-style" label={t('style')} error={err('style')}>
          <NativeSelect
            {...controlProps('reference-style', err('style'))}
            name="style"
            defaultValue=""
          >
            <option value="">{t('styleNone')}</option>
            {styles.map((style) => (
              <option key={style.value} value={style.value}>
                {style.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="reference-caption" label={t('caption')} error={err('caption')}>
          <Input
            {...controlProps('reference-caption', err('caption'))}
            name="caption"
            maxLength={captionMax}
            placeholder={t('captionPlaceholder')}
          />
        </Field>
      </div>
      <PhotoFilesField
        id="reference-files"
        hint={`${tPhotos('filesHint')} ${t('privacyHint')}`}
        error={err('files') ?? err('file')}
      />
      <div className="space-y-1.5">
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <Checkbox
            name="consent"
            className="mt-0.5"
            aria-invalid={err('consent') ? true : undefined}
            aria-describedby={err('consent') ? 'reference-consent-error' : undefined}
          />
          <span>{t('consent')}</span>
        </label>
        {err('consent') ? (
          <p id="reference-consent-error" className="text-sm text-destructive">
            {err('consent')}
          </p>
        ) : null}
      </div>
      <PhotoUploadFooter state={state} submitLabel={t('upload')} />
    </form>
  );
}
