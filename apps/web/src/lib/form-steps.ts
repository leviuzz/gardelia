/**
 * Moduli a passi (procedura guidata dentro un solo `<form>`, ADR-044): tutti i campi restano nel
 * modulo, i passi non correnti sono nascosti. Il modulo usa `noValidate` (il browser non può
 * mostrare l'errore di un campo nascosto e bloccherebbe l'invio senza dire nulla) e i controlli
 * del browser si fanno qui, un passo alla volta. Stesso schema di "Nuevo producto".
 */

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function controlsOf(section: HTMLElement | null): Control[] {
  if (!section) return [];
  return Array.from(section.querySelectorAll<Control>('input, select, textarea')).filter(
    (control) => !control.disabled && control.type !== 'hidden',
  );
}

/** Primo campo non valido di un passo (required, pattern, min/max…), anche se è nascosto. */
export function firstInvalidControl(section: HTMLElement | null): Control | null {
  return controlsOf(section).find((control) => !control.checkValidity()) ?? null;
}

/** Porta il cursore sul primo campo del passo appena aperto (tastiera e lettori di schermo). */
export function focusFirstControl(section: HTMLElement | null): void {
  controlsOf(section)[0]?.focus({ preventScroll: true });
}

/** Indice del primo passo che contiene un campo con un errore del server (o null). */
export function firstStepWithError(
  fieldErrors: Readonly<Record<string, string>> | undefined,
  stepOf: (fieldName: string) => number,
): number | null {
  if (!fieldErrors) return null;
  const steps = Object.keys(fieldErrors).map(stepOf);
  return steps.length > 0 ? Math.min(...steps) : null;
}
