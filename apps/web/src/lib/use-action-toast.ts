'use client';

import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { idleState, type ActionState } from './action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Messaggi d'errore per campo che la pagina non mostra: il campo non è nel form (es. un valore
 * nascosto o il pulsante premuto) oppure il form non c'è più. Funzione pura: `visibleText` è il
 * testo visibile della pagina dopo il rendering.
 */
export function unshownFieldErrors(
  fieldErrors: Readonly<Record<string, string>>,
  visibleText: string,
): string[] {
  return [...new Set(Object.values(fieldErrors))].filter(
    (message) => message !== '' && !visibleText.includes(message),
  );
}

/**
 * Dopo il disegno della pagina controlla che ogni errore per campo sia visibile; quelli che non
 * lo sono diventano un toast. Così un errore di validazione non resta mai silenzioso.
 */
function notifyUnshownFieldErrors(
  message: string,
  fieldErrors: Readonly<Record<string, string>>,
): void {
  if (typeof window === 'undefined') return;
  // Due frame: il primo arriva prima che React mostri il nuovo stato, il secondo dopo.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const unshown = unshownFieldErrors(fieldErrors, document.body.innerText);
      if (unshown.length === 0) return;
      const shownSome = unshown.length < new Set(Object.values(fieldErrors)).size;
      toast.error(shownSome ? `${message} ${unshown.join(' ')}` : unshown.join(' '));
    }),
  );
}

/**
 * Gli errori di validazione per campo restano accanto ai campi (quelli senza un campo visibile
 * diventano un toast); successi con messaggio e altri errori diventano toast.
 */
function notify(state: ActionState | undefined): void {
  if (!state) return;
  if (state.status === 'success' && state.message) toast.success(state.message);
  if (state.status === 'error' && !state.fieldErrors) toast.error(state.message);
  if (state.status === 'error' && state.fieldErrors) {
    notifyUnshownFieldErrors(state.message, state.fieldErrors);
  }
}

/**
 * Mostra un toast quando una server action termina, osservando lo stato con un effetto.
 * Adatto ai componenti che restano montati dopo l'azione; altrimenti usare
 * `useToastActionState`.
 */
export function useActionToast(state: ActionState): void {
  const previous = useRef(state);
  useEffect(() => {
    if (state === previous.current) return;
    previous.current = state;
    notify(state);
  }, [state]);
}

/**
 * `useActionState` con toast emesso appena l'action termina, prima del re-render: il
 * messaggio arriva anche quando il re-render smonta il componente (riga rimossa, form
 * chiuso, pulsante di uno stato non più disponibile). `onSuccess` gira nella stessa
 * transizione. Non usarlo con action che fanno redirect (gestite da useActionState).
 */
export function useToastActionState(action: Action, onSuccess?: () => void) {
  return useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    notify(result);
    if (result.status === 'success') onSuccess?.();
    return result;
  }, idleState);
}
