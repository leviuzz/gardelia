/**
 * Stato restituito dalle server action ai form (useActionState).
 * Modulo condiviso client/server: nessuna dipendenza server-only.
 */
export type ActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly message?: string }
  | {
      readonly status: 'error';
      readonly message: string;
      readonly fieldErrors?: Readonly<Record<string, string>>;
    };

export const idleState: ActionState = { status: 'idle' };

export function fieldError(state: ActionState, field: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.[field] : undefined;
}
