'use client';

import { ImagePlus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { PhotoFilesField, PhotoUploadFooter } from '@/components/photos/photo-upload-parts';
import { usePhotoUpload } from '@/components/photos/use-photo-upload';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/input';
import type { ActionState } from '@/lib/action-state';
import { cn } from '@/lib/utils';
import { PreviewPanel, type PreviewPanelData } from './preview-panel';

/** Foto vera del ramo di un disegno (ADR-052): dati preparati dalla pagina. */
export interface DesignPhotoData {
  /** Foto attuale (URL privato della fioreria); null se non c'è. */
  readonly current: { readonly url: string } | null;
  readonly upload: (formData: FormData) => Promise<ActionState>;
  readonly remove: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Proprietario o manager: può aggiungerla anche a "Mis ramos". */
  readonly canAddToReferences: boolean;
  /** Lato lungo massimo della riduzione nel browser. */
  readonly maxSide: number;
  readonly designName: string;
}

type Tab = 'ai' | 'own';

/**
 * Passo "Foto del ramo" del Diseñador: foto con l'IA (anteprima esatta o a parole) oppure la foto
 * vera del ramo fatta dalla fioreria. Senza AI configurata c'è solo la seconda.
 */
export function DesignPhotoStep({
  preview,
  photo,
  dirty,
}: {
  preview: PreviewPanelData | null;
  photo: DesignPhotoData;
  dirty: boolean;
}) {
  const t = useTranslations('builder.photo');
  const id = useId();
  const [tab, setTab] = useState<Tab>(photo.current || !preview ? 'own' : 'ai');
  const tabs: readonly { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'ai', label: t('tabAi'), icon: <Sparkles aria-hidden="true" /> },
    { key: 'own', label: t('tabOwn'), icon: <ImagePlus aria-hidden="true" /> },
  ];
  return (
    <div className="space-y-4">
      {preview ? (
        <div
          role="tablist"
          aria-label={t('choose')}
          className="grid grid-cols-2 gap-1 rounded-2xl border bg-card p-1"
        >
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`${id}-${item.key}-tab`}
              aria-selected={tab === item.key}
              aria-controls={`${id}-${item.key}-panel`}
              onClick={() => setTab(item.key)}
              className={cn(
                'flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors [&_svg]:size-4',
                tab === item.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        role={preview ? 'tabpanel' : undefined}
        id={`${id}-${tab}-panel`}
        aria-labelledby={preview ? `${id}-${tab}-tab` : undefined}
      >
        {tab === 'ai' && preview ? (
          <PreviewPanel data={preview} dirty={dirty} />
        ) : (
          <OwnPhotoPanel photo={photo} />
        )}
      </div>
    </div>
  );
}

function OwnPhotoPanel({ photo }: { photo: DesignPhotoData }) {
  const t = useTranslations('builder.photo');
  const [changing, setChanging] = useState(false);
  if (photo.current && !changing) {
    return (
      <Card>
        <CardContent className="space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- immagine privata della fioreria */}
          <img
            src={photo.current.url}
            alt={t('alt', { name: photo.designName })}
            className="mx-auto max-h-[28rem] w-auto rounded-2xl border object-contain"
          />
          <p className="text-sm text-muted-foreground">{t('inQuotes')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setChanging(true)}>
              <RefreshCw />
              {t('change')}
            </Button>
            <ConfirmActionDialog
              action={photo.remove}
              trigger={
                <Button type="button" variant="ghost" className="text-destructive">
                  <Trash2 />
                  {t('remove')}
                </Button>
              }
              title={t('removeTitle')}
              description={t('removeBody')}
              confirmLabel={t('remove')}
            />
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <OwnPhotoUploader photo={photo} onCancel={photo.current ? () => setChanging(false) : null} />
  );
}

function OwnPhotoUploader({
  photo,
  onCancel,
}: {
  photo: DesignPhotoData;
  onCancel: (() => void) | null;
}) {
  const t = useTranslations('builder.photo');
  const state = usePhotoUpload(photo.upload, { maxFiles: 1, maxSide: photo.maxSide });
  return (
    <Card>
      <CardContent>
        <form method="post" onSubmit={state.onSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('ownIntro')}</p>
          <PhotoFilesField
            id="design-photo-file"
            label={t('file')}
            hint={t('fileHint')}
            multiple={false}
            error={state.fieldErrors.files ?? state.fieldErrors.file}
          />
          {photo.canAddToReferences ? (
            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <Checkbox name="addToReferences" className="mt-0.5" />
              <span>{t('addToReferences')}</span>
            </label>
          ) : null}
          <div className="flex flex-wrap items-start gap-2">
            <PhotoUploadFooter state={state} submitLabel={t('upload')} />
            {onCancel ? (
              <Button type="button" variant="ghost" onClick={onCancel} disabled={state.busy}>
                {t('cancel')}
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
