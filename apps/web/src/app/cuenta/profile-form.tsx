'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Input } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Telefono di chi compra: lo vedrà solo la fioreria a cui farà un ordine. */
export function BuyerProfileForm({
  action,
  defaultPhone,
}: {
  readonly action: Action;
  readonly defaultPhone: string;
}) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = fieldError(state, 'phone');
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-3">
      <Field id="phone" label={t('phone')} hint={t('phoneHint')} error={err}>
        <Input
          {...controlProps('phone', err)}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={defaultPhone}
        />
      </Field>
      <SubmitButton className="w-fit">{tc('save')}</SubmitButton>
    </form>
  );
}
