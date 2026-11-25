'use client';

/**
 * «Dar créditos» (ADR-085, blocco 6b): quanti crediti della fioreria dare a un contratto. Il saldo
 * e il permesso li ricontrolla il servizio; qui il massimo serve solo al telefono (tastiera numerica).
 */
import { Gift } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ASSISTANT_CREDITS } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function AssistantCreditsForm({
  action,
  available,
}: {
  readonly action: Action;
  /** I crediti della fioreria ancora da dare. */
  readonly available: number;
}) {
  const t = useTranslations('care.assistant.card');
  const [formKey, setFormKey] = useState(0);
  const [state, formAction] = useToastActionState(action, () => setFormKey((key) => key + 1));
  const error = fieldError(state, 'credits');
  return (
    <form
      key={formKey}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      data-testid="assistant-give"
    >
      <Field id="assistant-credits" label={t('credits')} error={error} className="sm:w-32">
        <Input
          {...controlProps('assistant-credits', error, true)}
          name="credits"
          type="number"
          inputMode="numeric"
          min={1}
          max={Math.max(1, Math.min(available, ASSISTANT_CREDITS.maxGive))}
          step={1}
          required
        />
      </Field>
      <SubmitButton className="w-full sm:w-auto" icon={<Gift aria-hidden="true" />}>
        {t('give')}
      </SubmitButton>
    </form>
  );
}
