import 'server-only';
import { ValidationError } from '@floral/core';
import { PHOTO_LIMITS } from '@floral/domain';

/**
 * Byte del file inviato nel campo `file` di un form. Il limite si verifica prima di leggere
 * il contenuto; tipo e misure li rivalida il servizio. (Non è una server action: i moduli
 * 'use server' espongono come endpoint ogni funzione esportata.)
 */
export async function uploadedBytes(formData: FormData): Promise<Uint8Array> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    throw new ValidationError({ file: 'file_required' });
  }
  if (file.size > PHOTO_LIMITS.maxUploadBytes) {
    throw new ValidationError({ file: 'file_too_large' });
  }
  return new Uint8Array(await file.arrayBuffer());
}

/** Come `uploadedBytes`, ma il file è facoltativo (la foto di un messaggio): null se non c'è. */
export async function optionalUploadedBytes(formData: FormData): Promise<Uint8Array | null> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return null;
  return uploadedBytes(formData);
}

/**
 * Le foto di un campo con più file (le foto di ispirazione di una richiesta, M5): al massimo `max`,
 * ognuna e tutte insieme sotto il limite di una richiesta. Tipo e misure li rivalida il servizio.
 */
export async function uploadedPhotoList(
  formData: FormData,
  field: string,
  max: number,
): Promise<Uint8Array[]> {
  const files = formData
    .getAll(field)
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > max) throw new ValidationError({ [field]: 'too_many_photos' });
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > PHOTO_LIMITS.maxUploadBytes) {
    throw new ValidationError({ [field]: 'file_too_large' });
  }
  return Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())));
}
