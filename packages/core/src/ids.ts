import { createHash, randomBytes } from 'node:crypto';

/**
 * UUID versione 7 (RFC 9562): i primi 48 bit sono i millisecondi, il resto è casuale. Come gli ID
 * che Prisma crea da solo (`uuid(7)`), ma noto prima dell'inserimento: serve quando si inseriscono
 * molte righe insieme e altre righe devono puntare a loro (es. clienti importati e loro date).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * UUID versione 8 (RFC 9562) calcolato da un testo: lo stesso testo dà sempre lo stesso ID. Serve
 * come chiave d'invio quando è il servizio a sapere che due richieste sono la stessa (es. «Enviar a
 * la florería» due volte sulla stessa consulta).
 */
export function uuidFromSeed(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
