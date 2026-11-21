'use client';

import { useTranslations } from 'next-intl';
import { controlProps, Field } from '@/components/form/field';
import { PhotoFilesField, PhotoUploadFooter } from '@/components/photos/photo-upload-parts';
import { usePhotoUpload } from '@/components/photos/use-photo-upload';
import { NativeSelect } from '@/components/ui/input';
import type { ActionState } from '@/lib/action-state';

const VIEWS = ['FRONT', 'SIDE', 'TOP', 'DETAIL'] as const;

/**
 * Caricamento delle foto di un articolo: vista e (se l'articolo ha colori) colore valgono
 * per tutte le foto scelte. Carte, vasi e nastri: il colore è obbligatorio in UI.
 */
export function CatalogPhotoUploader({
  upload,
  colors,
  byColor,
  remaining,
  maxSide,
}: {
  upload: (formData: FormData) => Promise<ActionState>;
  colors: readonly { value: string; label: string }[];
  byColor: boolean;
  remaining: number;
  maxSide: number;
}) {
  const t = useTranslations('photos');
  const state = usePhotoUpload(upload, { maxFiles: remaining, maxSide });
  const err = (field: string) => state.fieldErrors[field];
  const colorRequired = byColor && colors.length > 0;

  return (
    <form onSubmit={state.onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="photo-view" label={t('view')} error={err('view')}>
          <NativeSelect
            {...controlProps('photo-view', err('view'))}
            name="view"
            defaultValue={byColor ? 'DETAIL' : 'FRONT'}
          >
            {VIEWS.map((view) => (
              <option key={view} value={view}>
                {t(`views.${view}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {colors.length > 0 ? (
          <Field
            id="photo-color"
            label={t('color')}
            hint={t('colorHint')}
            error={err('color')}
            required={colorRequired}
          >
            <NativeSelect
              {...controlProps('photo-color', err('color'), true)}
              name="color"
              required={colorRequired}
              defaultValue=""
            >
              <option value="" disabled={colorRequired}>
                {t('colorNone')}
              </option>
              {colors.map((color) => (
                <option key={color.value} value={color.value}>
                  {color.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      <PhotoFilesField id="photo-files" hint={t('filesHint')} error={err('files') ?? err('file')} />
      <PhotoUploadFooter state={state} submitLabel={t('upload')} />
    </form>
  );
}
