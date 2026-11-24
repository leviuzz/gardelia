'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { tenantDeletionSchema } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Conferma con il nome della fioreria: il pulsante si accende solo quando il nome corrisponde
 * (stessa regola del server, che lo ricontrolla).
 */
export function DeleteShopForm({
  action,
  shopName,
}: {
  readonly action: Action;
  readonly shopName: string;
}) {
  const t = useTranslations('settings.deleteShop');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const [typed, setTyped] = useState('');
  const matches = tenantDeletionSchema(shopName).safeParse({ confirmName: typed }).success;
  const error = fieldError(state, 'confirmName');
  return (
    <form action={formAction} className="grid gap-4">
      <Field id="confirmName" label={t('confirmLabel', { name: shopName })} error={error} required>
        <Input
          {...controlProps('confirmName', error)}
          name="confirmName"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </Field>
      <div>
        <SubmitButton
          variant="destructive"
          disabled={!matches}
          icon={<Trash2 aria-hidden="true" />}
          className="w-full sm:w-auto"
        >
          {t('submit')}
        </SubmitButton>
      </div>
    </form>
  );
}
