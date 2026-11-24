'use client';

import { CalendarX2, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CARE_LIMITS, CARE_MANUAL_CANCEL_REASONS } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';
import { CustomerNoticeCheckbox } from './customer-notice';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const choice =
  'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';

export interface MoveOptionView {
  /** "AAAA-MM-GG_idFascia". */
  readonly value: string;
  /** "jue 3 dic · 09:00–12:00 · 2 lugares" già formattato. */
  readonly label: string;
}

/** Spostare la visita: una delle fasce con posto, con la casella dell'avviso. */
export function VisitMoveForm({
  action,
  options,
}: {
  readonly action: Action;
  readonly options: readonly MoveOptionView[];
}) {
  const t = useTranslations('care.visit');
  const [state, formAction] = useToastActionState(action);
  const optionError =
    fieldError(state, 'date') ?? fieldError(state, 'slotId') ?? fieldError(state, 'option');
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noOptions')}</p>;
  }
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
      <Field id="move-option" label={t('moveTo')} error={optionError} required>
        <NativeSelect {...controlProps('move-option', optionError)} name="option" required>
          <option value="">{t('chooseOption')}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <CustomerNoticeCheckbox id="move-notice" error={fieldError(state, 'customerNotified')} />
      <div>
        <SubmitButton className="w-full sm:w-auto">{t('moveSubmit')}</SubmitButton>
      </div>
    </form>
  );
}

/** Cancellare la visita: chi la toglie, perché, e l'avviso al cliente. */
export function VisitCancelDialog({ action }: { readonly action: Action }) {
  const t = useTranslations('care.visit');
  const tr = useTranslations('care.cancelReasons');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="w-full text-muted-foreground sm:w-auto">
          <CalendarX2 />
          {t('cancel')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('cancelTitle')}</DialogTitle>
          <DialogDescription>{t('cancelBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('cancelWho')}</legend>
            {CARE_MANUAL_CANCEL_REASONS.map((reason, index) => (
              <label key={reason} className={choice}>
                <input
                  type="radio"
                  name="reason"
                  value={reason}
                  defaultChecked={index === 0}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">{tr(reason)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`cancelHints.${reason}`)}
                  </span>
                </span>
              </label>
            ))}
            {err('reason') ? <p className="text-sm text-destructive">{err('reason')}</p> : null}
          </fieldset>
          <Field id="cancel-note" label={t('cancelNote')} error={err('note')}>
            <Textarea
              {...controlProps('cancel-note', err('note'))}
              name="note"
              rows={2}
              maxLength={CARE_LIMITS.notes}
            />
          </Field>
          <CustomerNoticeCheckbox id="cancel-notice" error={err('customerNotified')} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton variant="destructive" className="w-full sm:w-auto">
              {t('cancelSubmit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Chi fa la visita: cambia solo la persona, non l'ora (niente avviso al cliente). */
export function VisitAssignForm({
  action,
  assignees,
  current,
}: {
  readonly action: Action;
  readonly assignees: readonly { readonly membershipId: string; readonly name: string }[];
  readonly current: string | null;
}) {
  const t = useTranslations('care.visit');
  const [state, formAction] = useToastActionState(action);
  const error = fieldError(state, 'assignee');
  return (
    <form action={formAction} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
      <Field id="visit-assignee" label={t('assignee')} error={error}>
        <NativeSelect
          {...controlProps('visit-assignee', error)}
          name="assignee"
          defaultValue={current ?? ''}
        >
          <option value="">{t('nobody')}</option>
          {assignees.map((member) => (
            <option key={member.membershipId} value={member.membershipId}>
              {member.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <SubmitButton variant="secondary" icon={<UserRound />}>
        {t('assign')}
      </SubmitButton>
    </form>
  );
}
