'use client';

/**
 * Foto della visita dal telefono (ADR-076): "Tomar foto" (fotocamera) o "De la galería", ridotte
 * nel browser e mandate UNA alla volta. Ogni file ha la sua chiave (`uploadKey`): se la rete cade
 * e si riprova, il server riconosce lo stesso file e non crea una seconda foto.
 */
import { Camera, ImagePlus, LoaderCircle, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ChangeEvent } from 'react';
import { toast } from 'sonner';
import { PHOTO_LIMITS } from '@floral/domain';
import { PrivateImage } from '@/components/common/private-image';
import { RemovePhotoButton } from '@/components/photos/photo-upload-parts';
import { prepareImageForUpload } from '@/components/photos/use-photo-upload';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import type { ActionState } from '@/lib/action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface VisitPhotoView {
  readonly id: string;
  readonly plantName: string | null;
  readonly thumbUrl: string;
  readonly fullUrl: string;
  /** Togliere la foto; null se chi guarda non può. */
  readonly removeAction: Action | null;
}

export interface PhotoPlantOption {
  readonly plantId: string;
  readonly name: string;
}

export function VisitPhotos({
  upload,
  photos,
  plants,
  limit,
}: {
  /** Carica una foto (null: la visita non è in corso, si guardano soltanto). */
  readonly upload: ((formData: FormData) => Promise<ActionState>) | null;
  readonly photos: readonly VisitPhotoView[];
  readonly plants: readonly PhotoPlantOption[];
  readonly limit: number;
}) {
  const t = useTranslations('care.visitWork');
  const tPhotos = useTranslations('photos');
  const tValidation = useTranslations('validation');
  const router = useRouter();
  const keys = useRef(new WeakMap<File, string>());
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [plantId, setPlantId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [retry, setRetry] = useState<readonly File[]>([]);
  const room = Math.max(0, limit - photos.length);

  function keyOf(file: File): string {
    let key = keys.current.get(file);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(file, key);
    }
    return key;
  }

  async function send(files: readonly File[]) {
    if (!upload || busy || files.length === 0) return;
    if (files.length > room) {
      setProblems([t('photoLimit', { max: limit })]);
      return;
    }
    setBusy(true);
    setProblems([]);
    const found: string[] = [];
    const failed: File[] = [];
    let uploaded = 0;
    try {
      for (const [index, file] of files.entries()) {
        setProgress({ current: index + 1, total: files.length });
        const prepared = await prepareImageForUpload(file, PHOTO_LIMITS.clientMaxSide);
        if (prepared.size > PHOTO_LIMITS.maxUploadBytes) {
          found.push(
            tPhotos('fileProblem', { name: file.name, problem: tValidation('file_too_large') }),
          );
          continue;
        }
        const payload = new FormData();
        payload.set('file', prepared);
        payload.set('uploadKey', keyOf(file));
        if (plantId) payload.set('plantId', plantId);
        try {
          const result = await upload(payload);
          if (result.status === 'success') {
            uploaded += 1;
            continue;
          }
          const fileError = result.status === 'error' ? result.fieldErrors?.file : undefined;
          found.push(
            tPhotos('fileProblem', {
              name: file.name,
              problem: fileError ?? (result.status === 'error' ? result.message : ''),
            }),
          );
        } catch {
          // Senza rete: la foto resta da riprovare, con la stessa chiave.
          failed.push(file);
        }
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
    setProblems(
      failed.length > 0 ? [...found, t('photoOffline', { count: failed.length })] : found,
    );
    setRetry(failed);
    if (uploaded > 0) {
      toast.success(tPhotos('uploaded', { count: uploaded }));
      router.refresh();
    }
  }

  function picked(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])].filter((file) => file.size > 0);
    event.currentTarget.value = '';
    void send(files);
  }

  return (
    <div className="grid gap-4">
      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => (
            <li key={photo.id} className="relative overflow-hidden rounded-xl border bg-muted">
              <a href={photo.fullUrl} target="_blank" rel="noreferrer" className="block">
                <PrivateImage
                  src={photo.thumbUrl}
                  alt={photo.plantName ?? t('photoAlt')}
                  className="aspect-square w-full object-cover"
                />
              </a>
              {photo.plantName ? (
                <p className="truncate px-2 py-1 text-xs text-muted-foreground">
                  {photo.plantName}
                </p>
              ) : null}
              {photo.removeAction ? (
                <div className="absolute top-1.5 right-1.5">
                  <RemovePhotoButton action={photo.removeAction} label={t('photoRemove')} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('photosEmpty')}</p>
      )}

      {upload ? (
        <div className="grid gap-3">
          {plants.length > 0 ? (
            <div className="grid gap-1.5">
              <label htmlFor="photo-plant" className="text-sm font-medium">
                {t('photoPlant')}
              </label>
              <NativeSelect
                id="photo-plant"
                value={plantId}
                onChange={(event) => setPlantId(event.target.value)}
                disabled={busy}
              >
                <option value="">{t('photoNoPlant')}</option>
                {plants.map((plant) => (
                  <option key={plant.plantId} value={plant.plantId}>
                    {plant.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={picked}
          />
          <input
            ref={galleryInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="care-photo-gallery"
            onChange={picked}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              onClick={() => cameraInput.current?.click()}
              disabled={busy || room === 0}
              className="w-full sm:w-auto"
            >
              {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Camera />}
              {busy && progress
                ? tPhotos('uploading', { current: progress.current, total: progress.total })
                : t('photoTake')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => galleryInput.current?.click()}
              disabled={busy || room === 0}
              className="w-full sm:w-auto"
            >
              <ImagePlus />
              {t('photoGallery')}
            </Button>
            {retry.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void send(retry)}
                disabled={busy}
                className="w-full sm:w-auto"
              >
                <RefreshCw />
                {t('photoRetry', { count: retry.length })}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('photoHint', { count: photos.length, max: limit })}
          </p>
          {problems.length > 0 ? (
            <ul className="space-y-1 text-sm text-destructive" role="alert">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
