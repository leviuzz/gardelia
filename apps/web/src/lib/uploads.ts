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
