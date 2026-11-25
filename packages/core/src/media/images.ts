/**
 * Immagini caricate dai fioristi (ADR-029) e ricevute dai provider AI: dati NON fidati.
 *
 *  - Il tipo si riconosce dai primi byte (JPEG/PNG/WebP), mai dal nome o dal Content-Type.
 *  - Limiti di byte e di pixel decodificati (niente immagini "bomba").
 *  - L'orientamento EXIF si applica e TUTTI i metadati si eliminano: niente coordinate GPS
 *    della fioreria o di casa, né dati del telefono.
 *  - Si salva un JPEG grande (lato lungo ≤ 1600 px) e una miniatura (≤ 480 px); le eventuali
 *    trasparenze diventano bianco.
 */
import sharp from 'sharp';
import { PHOTO_LIMITS } from '@floral/domain';
import { ValidationError } from '../errors';
import { sniffImageType } from './image-type';

export { sniffImageType, type ImageContentType } from './image-type';

export interface ProcessedImage {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly contentType: 'image/jpeg';
}

export interface NormalizedPhoto {
  readonly full: ProcessedImage;
  readonly thumb: ProcessedImage;
}

const DECODE_OPTIONS = {
  limitInputPixels: PHOTO_LIMITS.maxInputPixels,
  // Tollera le piccole anomalie dei JPEG dei telefoni; i file corrotti falliscono comunque.
  failOn: 'error',
} as const;

async function toJpeg(
  input: Uint8Array,
  maxSide: number,
  quality: number,
): Promise<ProcessedImage> {
  // .rotate() senza argomenti applica l'orientamento EXIF; sharp non copia i metadati.
  const { data, info } = await sharp(input, DECODE_OPTIONS)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: new Uint8Array(data),
    width: info.width,
    height: info.height,
    contentType: 'image/jpeg',
  };
}

/**
 * Una copia ridotta di una foto già normalizzata, da mandare a un modello di visione
 * (l'Asistente de plantas, ADR-085): meno token, abbastanza dettagli per foglie e macchie.
 */
export async function downscaleForModel(
  input: Uint8Array,
  maxSide: number,
): Promise<ProcessedImage> {
  return toJpeg(input, maxSide, 85);
}

/**
 * Valida e normalizza una foto caricata. Lancia `ValidationError` con codici traducibili
 * (`file_required`, `file_too_large`, `invalid_image`, `image_too_small`) sul campo indicato.
 */
export async function normalizeUploadedPhoto(
  bytes: Uint8Array,
  field = 'file',
): Promise<NormalizedPhoto> {
  if (bytes.byteLength === 0) throw new ValidationError({ [field]: 'file_required' });
  if (bytes.byteLength > PHOTO_LIMITS.maxUploadBytes) {
    throw new ValidationError({ [field]: 'file_too_large' });
  }
  if (!sniffImageType(bytes)) throw new ValidationError({ [field]: 'invalid_image' });

  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = await sharp(bytes, DECODE_OPTIONS).metadata());
  } catch (error) {
    const tooBig = error instanceof Error && /pixel limit/i.test(error.message);
    throw new ValidationError({ [field]: tooBig ? 'file_too_large' : 'invalid_image' });
  }
  if (!width || !height) throw new ValidationError({ [field]: 'invalid_image' });
  if (Math.min(width, height) < PHOTO_LIMITS.minSide) {
    throw new ValidationError({ [field]: 'image_too_small' });
  }

  try {
    const full = await toJpeg(bytes, PHOTO_LIMITS.fullMaxSide, 85);
    const thumb = await toJpeg(full.bytes, PHOTO_LIMITS.thumbMaxSide, 80);
    return { full, thumb };
  } catch {
    throw new ValidationError({ [field]: 'invalid_image' });
  }
}
