'use client';

import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { idleState, type ActionState } from './action-state';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Gli errori di validazione per campo restano accanto ai campi; successi con messaggio
 * e altri errori diventano toast.
 */
function notify(state: ActionState | undefined): void {
  if (!state) return;
  if (state.status === 'success' && state.message) toast.success(state.message);
  if (state.status === 'error' && !state.fieldErrors) toast.error(state.message);
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
