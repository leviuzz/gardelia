'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PrivateImage } from '@/components/common/private-image';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { PhotoFilesField, PhotoUploadFooter } from '@/components/photos/photo-upload-parts';
import { usePhotoUpload } from '@/components/photos/use-photo-upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface HandoverPanelProps {
  /** Foto attuale del ramo finito, o null. */
  readonly photo: {
    readonly thumbUrl: string;
    readonly fullUrl: string;
    readonly alt: string;
  } | null;
  /** Caricamento (una foto per richiesta), o null se chi guarda non può caricare adesso. */
  readonly upload: ((formData: FormData) => Promise<ActionState>) | null;
  readonly maxSide: number;
  readonly receiver: {
    readonly current: string | null;
    /** null se non si può ancora indicare (prima della consegna o senza permesso). */
    readonly action: Action | null;
  };
}

/** Prova di consegna (ADR-058): foto del ramo finito e chi l'ha ricevuto. */
export function HandoverPanel({ photo, upload, maxSide, receiver }: HandoverPanelProps) {
  const t = useTranslations('orders.handover');
  const [changing, setChanging] = useState(false);
  return (
    <div className="grid gap-5">
      {photo && !changing ? (
        <div className="flex flex-wrap items-end gap-4">
          <a href={photo.fullUrl} target="_blank" rel="noopener noreferrer">
            <PrivateImage
              src={photo.thumbUrl}
              alt={photo.alt}
              className="size-32 rounded-xl border bg-muted object-cover"
            />
          </a>
          {upload ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setChanging(true)}>
              {t('changePhoto')}
            </Button>
          ) : null}
        </div>
      ) : upload ? (
        <PhotoUploader
          upload={upload}
          maxSide={maxSide}
          onCancel={photo ? () => setChanging(false) : null}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('noPhotoYet')}</p>
      )}
      {receiver.action ? (
        <ReceiverForm action={receiver.action} current={receiver.current} />
      ) : receiver.current ? (
        <p className="text-sm">{t('receivedBy', { name: receiver.current })}</p>
      ) : null}
    </div>
  );
}

function PhotoUploader({
  upload,
  maxSide,
  onCancel,
}: {
  readonly upload: (formData: FormData) => Promise<ActionState>;
  readonly maxSide: number;
  readonly onCancel: (() => void) | null;
}) {
  const t = useTranslations('orders.handover');
  const state = usePhotoUpload(upload, { maxFiles: 1, maxSide });
  return (
    <form method="post" onSubmit={state.onSubmit} className="grid gap-3">
      <PhotoFilesField
        id="order-photo-file"
        label={t('photo')}
        hint={t('photoHint')}
        multiple={false}
        error={state.fieldErrors.files ?? state.fieldErrors.file}
      />
      <div className="flex flex-wrap items-start gap-2">
        <PhotoUploadFooter state={state} submitLabel={t('uploadPhoto')} />
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={state.busy}>
            {t('cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ReceiverForm({
  action,
  current,
}: {
  readonly action: Action;
  readonly current: string | null;
}) {
  const t = useTranslations('orders.handover');
  const [state, formAction] = useToastActionState(action);
  const err = fieldError(state, 'receivedBy');
  return (
    <form
      key={current ?? ''}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="flex flex-wrap items-end gap-2"
    >
      <Field
        id="order-received-by"
        label={t('receivedByLabel')}
        error={err}
        className="min-w-48 flex-1"
      >
        <Input
          {...controlProps('order-received-by', err)}
          name="receivedBy"
          defaultValue={current ?? ''}
          maxLength={120}
          autoComplete="off"
        />
      </Field>
      <SubmitButton variant="secondary">{t('save')}</SubmitButton>
    </form>
  );
}
