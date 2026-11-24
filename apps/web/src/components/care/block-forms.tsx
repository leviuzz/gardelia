'use client';

/**
 * Floral Care, blocco 4 (ADR-083): il salvataggio di un blocco dall'anteprima (con l'email
 * facoltativa e "Sí, avisé al cliente"), "Quitar bloqueo", l'avviso a un contratto e "Alguien no
 * puede ir". Il server ricontrolla tutto: qui solo i campi.
 */
import { Mail, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ActionButton } from '@/components/form/action-button';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, NativeSelect } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';
import { CustomerNoticeCheckbox } from './customer-notice';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** I campi del blocco già scelti nell'anteprima, che il salvataggio rimanda uguali. */
export interface BlockFields {
  readonly startDate: string;
  readonly endDate: string;
  readonly slotId: string;
  readonly label: string;
  readonly action: string;
  readonly plan: string;
}

/**
 * "Guardar bloqueo": i campi dell'anteprima, l'email ai clienti (se la fioreria può mandarla e
 * qualcuno ha l'email) e la casella dell'avviso quando ci sono visite toccate.
 */
export function BlockConfirmForm({
  action,
  fields,
  touched,
  emailOption,
}: {
  readonly action: Action;
  readonly fields: BlockFields;
  /** Visite toccate: serve "Sí, avisé al cliente". */
  readonly touched: number;
  /** Clienti con email che possono ricevere l'avviso; null se la fioreria non manda email. */
  readonly emailOption: { readonly recipients: number; readonly withoutEmail: number } | null;
}) {
  const t = useTranslations('care.blocks');
  const [state, formAction] = useToastActionState(action);
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {emailOption && emailOption.recipients > 0 ? (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm">
          <Checkbox name="sendEmail" value="on" defaultChecked className="mt-0.5" />
          <span>
            <span className="flex items-center gap-1.5 font-medium">
              <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
              {t('sendEmail')}
            </span>
            <span className="block text-xs text-muted-foreground">
              {emailOption.withoutEmail > 0
                ? t('sendEmailHintMissing', {
                    count: emailOption.recipients,
                    missing: emailOption.withoutEmail,
                  })
                : t('sendEmailHint', { count: emailOption.recipients })}
            </span>
          </span>
        </label>
      ) : touched > 0 && emailOption === null ? (
        <p className="text-xs text-muted-foreground">{t('emailUnavailable')}</p>
      ) : null}
      {touched > 0 ? (
        <CustomerNoticeCheckbox
          id="block-notice"
          error={fieldError(state, 'customerNotified')}
          hint={t('noticeHint', { count: touched })}
        />
      ) : null}
      <div>
        <SubmitButton className="w-full sm:w-auto">{t('save')}</SubmitButton>
      </div>
    </form>
  );
}

export function RemoveBlockButton({ action }: { readonly action: Action }) {
  const t = useTranslations('care.blocks');
  return (
    <ConfirmActionDialog
      action={action}
      trigger={
        <Button variant="outline" className="w-full sm:w-auto">
          {t('remove')}
        </Button>
      }
      title={t('removeTitle')}
      description={t('removeBody')}
      confirmLabel={t('removeConfirm')}
    />
  );
}

/** "Enviar aviso" (o "Reintentar") per un contratto toccato. */
export function SendNoticeButton({
  action,
  retry,
  label,
}: {
  readonly action: Action;
  readonly retry: boolean;
  /** Nome accessibile con il cliente. */
  readonly label: string;
}) {
  const t = useTranslations('care.blocks');
  return (
    <ActionButton action={action} variant="outline" size="sm" aria-label={label}>
      {retry ? t('noticeRetry') : t('noticeSend')}
    </ActionButton>
  );
}

/** "Alguien no puede ir": de quién, a quién (o a nadie) y entre qué días. */
export function ReassignForm({
  action,
  assignees,
  today,
}: {
  readonly action: Action;
  readonly assignees: readonly { readonly membershipId: string; readonly name: string }[];
  /** "AAAA-MM-GG", il primo giorno possibile. */
  readonly today: string;
}) {
  const t = useTranslations('care.blocks');
  const tv = useTranslations('care.visit');
  const [state, formAction] = useToastActionState(action);
  const err = (field: string) => fieldError(state, field);
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="reassign-from"
          label={t('reassignFrom')}
          error={err('fromMembershipId')}
          required
        >
          <NativeSelect
            {...controlProps('reassign-from', err('fromMembershipId'), true)}
            name="fromMembershipId"
            defaultValue=""
            required
          >
            <option value="" disabled>
              {t('reassignChoose')}
            </option>
            {assignees.map((member) => (
              <option key={member.membershipId} value={member.membershipId}>
                {member.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="reassign-to" label={t('reassignTo')} error={err('toMembershipId')}>
          <NativeSelect
            {...controlProps('reassign-to', err('toMembershipId'))}
            name="toMembershipId"
            defaultValue=""
          >
            <option value="">{tv('nobody')}</option>
            {assignees.map((member) => (
              <option key={member.membershipId} value={member.membershipId}>
                {member.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="reassign-start" label={t('from')} error={err('startDate')} required>
          <Input
            {...controlProps('reassign-start', err('startDate'), true)}
            name="startDate"
            type="date"
            min={today}
            defaultValue={today}
            required
          />
        </Field>
        <Field id="reassign-end" label={t('until')} error={err('endDate')} required>
          <Input
            {...controlProps('reassign-end', err('endDate'), true)}
            name="endDate"
            type="date"
            min={today}
            defaultValue={today}
            required
          />
        </Field>
      </div>
      <div>
        <SubmitButton variant="outline" className="w-full sm:w-auto">
          <Users />
          {t('reassignSubmit')}
        </SubmitButton>
      </div>
    </form>
  );
}
