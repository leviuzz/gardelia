/**
 * Attesa prima del nuovo tentativo quando una dipendenza (il database) non risponde all'avvio:
 * 2 s, 4 s, 8 s… fino a un massimo di 60 s. Mai zero, mai infinita.
 */
export function startupRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 10));
  return Math.min(60_000, 2_000 * 2 ** exponent);
}
