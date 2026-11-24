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
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
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

/**
 * Spostare la visita: una delle fasce con posto, con la casella dell'avviso. Una visita extra può
 * andare anche a un'ora libera (`freeTime`: i giorni possibili), che non tocca i posti (ADR-078).
 */
export function VisitMoveForm({
  action,
  options,
  freeTime = null,
}: {
  readonly action: Action;
  readonly options: readonly MoveOptionView[];
  readonly freeTime?: { readonly first: string; readonly last: string } | null;
}) {
  const t = useTranslations('care.visit');
  const te = useTranslations('care.extra');
  const [state, formAction] = useToastActionState(action);
  const [placement, setPlacement] = useState<'SLOT' | 'TIME'>(
    options.length > 0 || !freeTime ? 'SLOT' : 'TIME',
  );
  const optionError =
    fieldError(state, 'date') ?? fieldError(state, 'slotId') ?? fieldError(state, 'option');
  if (options.length === 0 && !freeTime) {
    return <p className="text-sm text-muted-foreground">{t('noOptions')}</p>;
  }
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
      {freeTime ? (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{te('when')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={choice}>
              <input
                type="radio"
                name="placement"
                value="SLOT"
                checked={placement === 'SLOT'}
                onChange={() => setPlacement('SLOT')}
                disabled={options.length === 0}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>{te('inSlot')}</span>
            </label>
            <label className={choice}>
              <input
                type="radio"
                name="placement"
                value="TIME"
                checked={placement === 'TIME'}
                onChange={() => setPlacement('TIME')}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>{te('atTime')}</span>
            </label>
          </div>
        </fieldset>
      ) : null}
      {placement === 'SLOT' ? (
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
      ) : freeTime ? (
        <div className="grid gap-3">
          <Field
            id="move-date"
            label={te('date')}
            hint={te('atTimeHint')}
            error={fieldError(state, 'date')}
            required
          >
            <Input
              {...controlProps('move-date', fieldError(state, 'date'), true)}
              type="date"
              name="date"
              min={freeTime.first}
              max={freeTime.last}
              defaultValue={freeTime.first}
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="move-start" label={te('start')} error={fieldError(state, 'start')} required>
              <Input
                {...controlProps('move-start', fieldError(state, 'start'))}
                type="time"
                name="start"
                step={300}
                required
              />
            </Field>
            <Field id="move-end" label={te('end')} error={fieldError(state, 'end')} required>
              <Input
                {...controlProps('move-end', fieldError(state, 'end'))}
                type="time"
                name="end"
                step={300}
                required
              />
            </Field>
          </div>
        </div>
      ) : null}
      <CustomerNoticeCheckbox id="move-notice" error={fieldError(state, 'customerNotified')} />
      <div>
        <SubmitButton className="w-full sm:w-auto">{t('moveSubmit')}</SubmitButton>
      </div>
    </form>
  );
}

/** Cancellare la visita: chi la toglie, perché, e l'avviso al cliente. */
/** Cancelación del cliente (ADR-082): cosa succede adesso, testo già formattato dalla pagina. */
export interface LateCancelView {
  readonly message: string;
  /** Adesso si pagherebbe: c'è "No cobrar esta vez". */
  readonly chargedNow: boolean;
}

export function VisitCancelDialog({
  action,
  lateCancel,
}: {
  readonly action: Action;
  /** null per le visite extra (si cobrano solo se fatte). */
  readonly lateCancel: LateCancelView | null;
}) {
  const t = useTranslations('care.visit');
  const tr = useTranslations('care.cancelReasons');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(CARE_MANUAL_CANCEL_REASONS[0]);
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
            {CARE_MANUAL_CANCEL_REASONS.map((option, index) => (
              <label key={option} className={choice}>
                <input
                  type="radio"
                  name="reason"
                  value={option}
                  defaultChecked={index === 0}
                  onChange={() => setReason(option)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">{tr(option)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`cancelHints.${option}`)}
                  </span>
                </span>
              </label>
            ))}
            {err('reason') ? <p className="text-sm text-destructive">{err('reason')}</p> : null}
          </fieldset>
          {reason === 'CUSTOMER' && lateCancel ? (
            <div className="grid gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm">
              <p>{lateCancel.message}</p>
              {lateCancel.chargedNow ? (
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input type="checkbox" name="noCharge" className="mt-0.5 size-4 accent-primary" />
                  <span>
                    <span className="block font-medium">{t('noCharge')}</span>
                    <span className="block text-xs text-muted-foreground">{t('noChargeHint')}</span>
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}
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
