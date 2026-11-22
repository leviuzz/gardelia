'use client';

import { Check } from 'lucide-react';
import { controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';
import { cn } from '@/lib/utils';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Quantità di una riga (cotización, ricetta di un ramo): campo numerico e pulsante, errore sotto
 * il campo e collegato a esso per gli screen reader. `compact`: pulsante con la sola spunta.
 * Il server rivalida sempre la quantità.
 */
export function QuantityForm({
  action,
  id,
  quantity,
  max,
  label,
  submitLabel,
  compact = false,
  inputClassName,
}: {
  readonly action: Action;
  /** ID univoco nella pagina (una riga = un form). */
  readonly id: string;
  readonly quantity: number;
  readonly max: number;
  /** Nome accessibile del campo (es. "Cantidad de Rosa roja"). */
  readonly label: string;
  readonly submitLabel: string;
  readonly compact?: boolean;
  readonly inputClassName?: string;
}) {
  const [state, formAction] = useToastActionState(action);
  const error = fieldError(state, 'quantity');
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-1">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <Input
          {...controlProps(id, error)}
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          defaultValue={quantity}
          required
          className={cn('h-9 w-20 tabular-nums', inputClassName)}
        />
        {compact ? (
          <SubmitButton
            size="icon-sm"
            variant="outline"
            aria-label={submitLabel}
            icon={<Check />}
          />
        ) : (
          <SubmitButton size="sm" variant="secondary">
            {submitLabel}
          </SubmitButton>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
