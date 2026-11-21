'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormAlert } from '@/components/form/form-alert';
import { SubmitButton } from '@/components/form/submit-button';
import { idleState, type ActionState } from '@/lib/action-state';

export function AcceptInvitationForm({
  action,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const t = useTranslations('invite');
  const [state, formAction] = useActionState(action, idleState);
  return (
    <form action={formAction} className="space-y-4">
      <FormAlert state={state} />
      <SubmitButton size="lg" className="w-full" pendingLabel={t('accepting')}>
        {t('accept')}
      </SubmitButton>
    </form>
  );
}
