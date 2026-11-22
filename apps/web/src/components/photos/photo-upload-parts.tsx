'use client';

import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionButton } from '@/components/form/action-button';
import { controlProps, Field } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/action-state';

import type { PhotoUploadState } from './use-photo-upload';

/** Selettore dei file (più foto insieme) con suggerimento ed errore. */
export function PhotoFilesField({
  id,
  hint,
  error,
}: {
  id: string;
  hint: string;
  error?: string | undefined;
}) {
  const t = useTranslations('photos');
  return (
    <Field id={id} label={t('files')} hint={hint} error={error} required>
      <Input
        {...controlProps(id, error, true)}
        name="files"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="h-auto cursor-pointer py-2 file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
      />
    </Field>
  );
}

/** Pulsante di invio, avanzamento ("Subiendo 2 de 5…") e problemi delle singole foto. */
export function PhotoUploadFooter({
  state,
  submitLabel,
}: {
  state: PhotoUploadState;
  submitLabel: string;
}) {
  const t = useTranslations('photos');
  return (
    <div className="space-y-3">
      <Button type="submit" disabled={state.busy} aria-busy={state.busy}>
        {state.busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ImagePlus />}
        {state.busy && state.progress
          ? t('uploading', { current: state.progress.current, total: state.progress.total })
          : submitLabel}
      </Button>
      {state.fileErrors.length > 0 ? (
        <ul className="space-y-1 text-sm text-destructive" role="alert">
          {state.fileErrors.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Toglie (archivia) una foto, con toast di conferma. */
export function RemovePhotoButton({
  action,
  label,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
}) {
  return (
    <ActionButton
      action={action}
      variant="secondary"
      size="icon-sm"
      className="bg-card/90 shadow-sm backdrop-blur"
      aria-label={label}
      title={label}
      icon={<Trash2 />}
    />
  );
}
