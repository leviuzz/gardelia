'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { idleState, type ActionState } from './action-state';
import { isStaleVersionError, reloadPage } from './stale-version';

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

function hasFieldErrors(state: ActionState): boolean {
  return state.status === 'error' && state.fieldErrors !== undefined;
}

/**
 * Gli errori per campo che la pagina non mostra diventano un toast: un errore di validazione non
 * resta mai silenzioso. Va chiamata DOPO il commit dello stato che porta gli errori (in un
 * effetto): solo allora gli errori accanto ai campi sono nel DOM, qualunque sia la velocità del
 * rendering. Prima si aspettavano due frame, e su un telefono lento o in CI l'errore già scritto
 * accanto al campo arrivava anche come toast.
 */
function notifyUnshownFieldErrors(state: ActionState): void {
  if (state.status !== 'error' || !state.fieldErrors) return;
  const unshown = unshownFieldErrors(state.fieldErrors, document.body.innerText);
  if (unshown.length === 0) return;
  const shownSome = unshown.length < new Set(Object.values(state.fieldErrors)).size;
  toast.error(shownSome ? `${state.message} ${unshown.join(' ')}` : unshown.join(' '));
}

/**
 * Successi con messaggio e errori senza campi diventano toast. Gli errori per campo restano
 * accanto ai campi: li controlla `notifyUnshownFieldErrors` dopo il commit.
 */
function notifyResult(state: ActionState): void {
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
    notifyResult(state);
    // L'effetto gira dopo il commit di `state`: gli errori accanto ai campi sono già nel DOM.
    notifyUnshownFieldErrors(state);
  }, [state]);
}

/**
 * `useActionState` con toast emesso appena l'action termina, prima del re-render: il
 * messaggio arriva anche quando il re-render smonta il componente (riga rimossa, form
 * chiuso, pulsante di uno stato non più disponibile). `onSuccess` gira nella stessa
 * transizione. Non usarlo con action che fanno redirect (gestite da useActionState).
 *
 * Gli errori per campo invece si controllano dopo il commit del nuovo stato (effetto qui
 * sotto): prima React non li ha ancora scritti accanto ai campi. Se il componente si smonta
 * prima del commit, i suoi campi non ci sono più e gli errori diventano un toast.
 */
export function useToastActionState(action: Action, onSuccess?: () => void) {
  const t = useTranslations('errors.staleVersion');
  // Risultato con errori per campo arrivato dal server e non ancora disegnato da React.
  const awaitingCommit = useRef<ActionState | null>(null);
  const actionState = useActionState(async (prev: ActionState, formData: FormData) => {
    let result: ActionState;
    try {
      result = await action(prev, formData);
    } catch (error) {
      // Pagina aperta prima di un rilascio: il form resta com'è e un avviso, che non sparisce da
      // solo, offre di ricaricare. Gli altri errori vanno al confine d'errore come sempre.
      if (!isStaleVersionError(error)) throw error;
      toast.error(t('toast'), {
        id: 'stale-version',
        duration: Infinity,
        action: { label: t('reload'), onClick: reloadPage },
      });
      return prev;
    }
    // Un risultato più recente sostituisce quello in attesa (i suoi errori non valgono più).
    awaitingCommit.current = hasFieldErrors(result) ? result : null;
    notifyResult(result);
    if (result.status === 'success') onSuccess?.();
    return result;
  }, idleState);
  const [state] = actionState;

  useEffect(() => {
    if (awaitingCommit.current !== state) return;
    awaitingCommit.current = null;
    notifyUnshownFieldErrors(state);
  }, [state]);

  useEffect(
    () => () => {
      const result = awaitingCommit.current;
      awaitingCommit.current = null;
      if (result) notifyUnshownFieldErrors(result);
    },
    [],
  );

  return actionState;
}
