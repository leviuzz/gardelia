import { CircleCheck, TriangleExclamationPoint } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { ActionState } from '@/lib/action-state';

/** Messaggio generale di un form (errore o conferma), annunciato agli screen reader. */
export function FormAlert({ state }: { state: ActionState }) {
  if (state.status === 'error') {
    return (
      <Alert variant="destructive">
        <TriangleExclamationPoint aria-hidden="true" />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  if (state.status === 'success' && state.message) {
    return (
      <Alert variant="success">
        <CircleCheck aria-hidden="true" />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
