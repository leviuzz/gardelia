'use client';

import { XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import {
  SERVICE_DECLINE_REASONS,
  SERVICE_REQUEST_LIMITS,
  type ServiceDeclineReason,
} from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { RadioCard } from '@/components/form/radio-card';
import { SubmitButton } from '@/components/form/submit-button';
import { Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';

/**
 * «Rifiuta» una richiesta (M5): un motivo pronto, che chi compra legge nella lingua del mercato, e un
 * dettaglio (obbligatorio con «Altro motivo»).
 */
export function DeclineRequestForm({
  action,
}: {
  readonly action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const t = useTranslations('requests.decline');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const [reason, setReason] = useState<ServiceDeclineReason>('NO_AVAILABILITY');
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-4"
      data-testid="decline-request-form"
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('reason')}</legend>
        {SERVICE_DECLINE_REASONS.map((code) => (
          <RadioCard
            key={code}
            name="reasonCode"
            value={code}
            checked={reason === code}
            onChange={() => setReason(code)}
          >
            {t(`reasons.${code}`)}
          </RadioCard>
        ))}
        {err('reasonCode') ? <p className="text-sm text-destructive">{err('reasonCode')}</p> : null}
      </fieldset>
      <Field
        id="decline-detail"
        label={reason === 'OTHER' ? t('detailRequired') : t('detail')}
        hint={t('detailHint')}
        error={err('detail')}
        required={reason === 'OTHER'}
      >
        <Textarea
          {...controlProps('decline-detail', err('detail'), reason === 'OTHER')}
          name="detail"
          maxLength={SERVICE_REQUEST_LIMITS.declineDetail}
          rows={3}
        />
      </Field>
      <SubmitButton variant="destructive" className="w-fit" icon={<XCircle />}>
        {t('submit')}
      </SubmitButton>
    </form>
  );
}
