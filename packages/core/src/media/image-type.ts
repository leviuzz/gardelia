/** Riconoscimento del formato dai primi byte (modulo leggero, senza librerie native). */

export type ImageContentType = 'image/png' | 'image/jpeg' | 'image/webp';

/** Tipo dell'immagine dai primi byte; null se non è un formato ammesso. */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  const startsWith = (offset: number, signature: readonly number[]) =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (startsWith(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // "RIFF" … "WEBP"
  if (startsWith(0, [0x52, 0x49, 0x46, 0x46]) && startsWith(8, [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }
  return null;
}
