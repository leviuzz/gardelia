'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * `true` solo dopo l'idratazione. Prima, i gestori di eventi di React non sono ancora collegati:
 * un pulsante che lavora solo in JavaScript (accesso, Google, uscita) premuto in quel momento non
 * farebbe nulla, e un modulo con `onSubmit` partirebbe come modulo HTML normale. Questi pulsanti
 * restano disattivati finché non funzionano davvero (telefoni lenti, test automatici).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
