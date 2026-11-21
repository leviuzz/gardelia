/**
 * Identificativi UUID v7 (RFC 9562): 48 bit di timestamp in millisecondi + 74 bit casuali.
 * Ordinabili nel tempo (buona località degli indici B-tree) e generabili lato applicazione,
 * così il tenantId di una nuova fioreria è noto PRIMA dell'inserimento (necessario per
 * impostare il contesto RLS nella stessa transazione).
 */
export function newId(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const high = Math.floor(now / 0x1_0000_0000); // 16 bit alti dei 48
  const low = now >>> 0; // 32 bit bassi
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // versione 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122/9562

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Verifica sintattica di un UUID (qualsiasi versione 1–8). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
