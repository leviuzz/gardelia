'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { ActionState } from '@/lib/action-state';

/**
 * Riduce una foto nel browser prima dell'invio (lato lungo ≤ `maxSide`, JPEG): caricamenti
 * più rapidi da telefono e niente metadati EXIF già in partenza. È solo una comodità: il
 * server rivalida e ricodifica sempre. Se il browser non riesce, si invia il file originale.
 */
export async function prepareImageForUpload(file: File, maxSide: number): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.88),
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, '') || 'foto';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export interface PhotoUploadState {
  readonly busy: boolean;
  readonly progress: { readonly current: number; readonly total: number } | null;
  /** Errori dei campi comuni (colore, consenso…) o della scelta dei file. */
  readonly fieldErrors: Readonly<Record<string, string>>;
  /** Problemi di singole foto ("rosa.jpg: la foto è troppo piccola"). */
  readonly fileErrors: readonly string[];
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

/**
 * Carica le foto scelte UNA PER VOLTA (richieste piccole, avanzamento visibile, una foto
 * sbagliata non blocca le altre). I campi comuni del form accompagnano ogni foto.
 */
export function usePhotoUpload(
  upload: (formData: FormData) => Promise<ActionState>,
  options: { readonly maxFiles: number; readonly maxSide: number },
): PhotoUploadState {
  const t = useTranslations('photos');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PhotoUploadState['progress']>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [fileErrors, setFileErrors] = useState<readonly string[]>([]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = data
      .getAll('files')
      .filter((value): value is File => value instanceof File && value.size > 0);
    setFileErrors([]);
    if (files.length === 0) {
      setFieldErrors({ files: t('pickFiles') });
      return;
    }
    if (files.length > options.maxFiles) {
      setFieldErrors({ files: t('tooManyFiles', { max: options.maxFiles }) });
      return;
    }

    setBusy(true);
    setFieldErrors({});
    let uploaded = 0;
    const problems: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress({ current: index + 1, total: files.length });
        const payload = new FormData();
        for (const [key, value] of data.entries()) {
          if (key !== 'files') payload.append(key, value);
        }
        payload.set('file', await prepareImageForUpload(file, options.maxSide));
        const result = await upload(payload);
        if (result.status === 'success') {
          uploaded += 1;
          continue;
        }
        const { file: fileError, ...others } =
          result.status === 'error' ? (result.fieldErrors ?? {}) : {};
        if (Object.keys(others).length > 0) {
          // Errore di un campo comune: vale per tutte le foto, inutile proseguire.
          setFieldErrors(others);
          break;
        }
        problems.push(
          t('fileProblem', {
            name: file.name,
            problem: fileError ?? (result.status === 'error' ? result.message : ''),
          }),
        );
      }
    } catch {
      problems.push(t('networkError'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
    setFileErrors(problems);
    if (uploaded > 0) {
      toast.success(t('uploaded', { count: uploaded }));
      const input = form.elements.namedItem('files');
      if (input instanceof HTMLInputElement) input.value = '';
      router.refresh();
    }
  }

  return { busy, progress, fieldErrors, fileErrors, onSubmit };
}
