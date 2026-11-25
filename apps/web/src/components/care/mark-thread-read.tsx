'use client';

import { useEffect, useRef } from 'react';

/**
 * Segna come letto il filo dei messaggi DOPO che la pagina si è vista (ADR-084), mai durante il
 * render: una sola chiamata. L'azione non ricarica la pagina, così il separatore di ciò che era
 * nuovo resta finché si legge.
 */
export function MarkThreadRead({ action }: { readonly action: () => Promise<unknown> }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    action().catch(() => undefined);
  }, [action]);
  return null;
}
