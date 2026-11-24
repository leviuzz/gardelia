'use client';

import { useTranslations } from 'next-intl';
import { useOptimistic } from 'react';
import type { ActionState } from '@/lib/action-state';
import { useToastActionState } from '@/lib/use-action-toast';
import { cn } from '@/lib/utils';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Interruttore "Tienda en línea" di un prodotto nell'elenco del catalogo. Cambia subito
 * (ottimistico) e torna com'era se il server rifiuta; il pulsante manda il valore nuovo.
 */
export function OnlineToggle({
  action,
  isOnline,
  name,
}: {
  readonly action: Action;
  readonly isOnline: boolean;
  readonly name: string;
}) {
  const t = useTranslations('catalog');
  const [on, setOn] = useOptimistic(isOnline);
  const [, formAction, pending] = useToastActionState(action);
  return (
    <form
      action={(formData) => {
        setOn(formData.get('online') === 'on');
        formAction(formData);
      }}
    >
      <button
        type="submit"
        name="online"
        value={on ? 'off' : 'on'}
        role="switch"
        aria-checked={on}
        aria-label={t('onlineToggle', { name })}
        disabled={pending}
        className={cn(
          // Area di tocco di 44 px attorno all'interruttore.
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none before:absolute before:-inset-2.5 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60',
          on ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'block size-5 rounded-full bg-card shadow-sm transition-transform',
            on ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </form>
  );
}
