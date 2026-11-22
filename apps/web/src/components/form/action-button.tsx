'use client';

import type { ComponentProps } from 'react';
import type { ActionState } from '@/lib/action-state';
import { useToastActionState } from '@/lib/use-action-toast';
import { SubmitButton } from './submit-button';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Un pulsante che esegue una server action (un form con un solo pulsante): rotella al posto
 * dell'icona durante l'invio, toast dell'esito anche quando il pulsante sparisce dopo l'azione
 * (riga rimossa, invito revocato).
 */
export function ActionButton({
  action,
  onSuccess,
  ...props
}: Omit<ComponentProps<typeof SubmitButton>, 'type'> & {
  readonly action: Action;
  readonly onSuccess?: () => void;
}) {
  const [, formAction] = useToastActionState(action, onSuccess);
  return (
    <form action={formAction}>
      <SubmitButton {...props} />
    </form>
  );
}
