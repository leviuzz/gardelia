/**
 * Riconoscimento degli errori del database, indipendente dai messaggi testuali.
 * Con i driver adapter di Prisma 7 gli errori noti arrivano come
 * PrismaClientKnownRequestError (codici P2xxx); per gli altri si risale al codice SQLSTATE.
 */
import { Prisma } from './generated/prisma/client.ts';

/** Violazione di vincolo univoco (P2002), opzionalmente su un campo specifico. */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  if (!field) return true;
  return JSON.stringify(error.meta ?? {}).includes(field);
}

/** Violazione di chiave esterna (P2003): ad esempio un riferimento a un record di un altro tenant. */
export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

/** Record da aggiornare/eliminare non trovato (P2025). */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/** Codice SQLSTATE dell'errore Postgres sottostante, se disponibile. */
export function sqlStateOf(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      originalCode?: unknown;
      cause?: unknown;
      meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } };
    };
    for (const code of [
      candidate.originalCode,
      candidate.meta?.driverAdapterError?.cause?.originalCode,
      candidate.code,
    ]) {
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !code.startsWith('P')) {
        return code;
      }
    }
    current = candidate.cause;
  }
  return null;
}

/** Violazione di una policy RLS (SQLSTATE 42501, insufficient_privilege). */
export function isRlsViolation(error: unknown): boolean {
  if (sqlStateOf(error) === '42501') return true;
  return error instanceof Error && /row-level security/i.test(error.message);
}
