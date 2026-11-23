/**
 * Coppie di ID firmate dal server (HMAC con una chiave derivata dal segreto dell'app e dallo
 * scopo del link): nessuno può costruirne una per un altro tenant o un altro documento. Usate dai
 * link senza sessione: disiscrizione dalle promo (ADR-047) e link pubblici (ADR-056).
 *
 * Formato: 16 byte + 16 byte (due UUID) + 16 byte di firma → 64 caratteri base64url.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_BYTES = 16;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{64}$/;

function uuidBytes(id: string): Buffer {
  return Buffer.from(id.replaceAll('-', ''), 'hex');
}

function uuidFrom(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function signature(secret: string, purpose: string, payload: Buffer): Buffer {
  // Chiave propria di ogni scopo: il segreto dell'app non firma mai direttamente i link.
  const key = createHmac('sha256', secret).update(purpose).digest();
  return createHmac('sha256', key).update(payload).digest().subarray(0, SIGNATURE_BYTES);
}

export function signIdPair(secret: string, purpose: string, first: string, second: string): string {
  const payload = Buffer.concat([uuidBytes(first), uuidBytes(second)]);
  return Buffer.concat([payload, signature(secret, purpose, payload)]).toString('base64url');
}

/** I due ID di un token valido per questo scopo, o null (formato sbagliato o firma che non torna). */
export function readIdPair(
  secret: string,
  purpose: string,
  token: unknown,
): readonly [string, string] | null {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 32 + SIGNATURE_BYTES) return null;
  const payload = bytes.subarray(0, 32);
  if (!timingSafeEqual(signature(secret, purpose, payload), bytes.subarray(32))) return null;
  return [uuidFrom(payload.subarray(0, 16)), uuidFrom(payload.subarray(16))];
}
