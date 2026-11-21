'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { ActionState } from './action-state';

/**
 * Mostra un toast quando una server action termina. Gli errori di validazione per campo
 * restano accanto ai campi; gli altri errori diventano toast.
 */
export function useActionToast(state: ActionState): void {
  const previous = useRef(state);
  useEffect(() => {
    if (state === previous.current) return;
    previous.current = state;
    if (state.status === 'success' && state.message) toast.success(state.message);
    if (state.status === 'error' && !state.fieldErrors) toast.error(state.message);
  }, [state]);
}
