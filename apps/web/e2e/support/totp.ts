import { createHmac } from 'node:crypto';

/**
 * Codice di un'app di autenticazione (RFC 6238: SHA-1, 6 cifre, 30 secondi), come quello che
 * l'app calcola dalla chiave mostrata in "Seguridad de la cuenta" (base32, a gruppi di 4).
 */
function base32Decode(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = value.replace(/[\s=]/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Carattere base32 non valido: ${char}`);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, now: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(binary).padStart(6, '0');
}
