import { unstable_isUnrecognizedActionError } from 'next/navigation';

/**
 * L'errore nasce da una pagina aperta prima di un rilascio: il browser ha ancora il codice della
 * versione precedente e chiede al server un'azione (o un pezzo di JavaScript) che non esiste più.
 * Non è un guasto e "Reintentar" non basta: serve ricaricare la pagina per avere la versione nuova.
 */
export function isStaleVersionError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'UnrecognizedActionError' ||
    error.name === 'ChunkLoadError' ||
    /Loading (CSS )?chunk [\w./-]+ failed/i.test(error.message)
  );
}

/** Ricarica la pagina dal server: arrivano il codice e le azioni della versione nuova. */
export function reloadPage(): void {
  window.location.reload();
}
