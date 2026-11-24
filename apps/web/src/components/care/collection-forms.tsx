'use client';

/**
 * Floral Care, blocco 3b (ADR-082): "Cobré en la visita" per chi fa la visita, "Confirmar" e
 * "Rechazar" per chi gestisce i soldi, "Ajuste para el próximo cargo" e "Quitar". Il server
 * ricontrolla tutto: qui solo i campi. La chiave del modulo (`submitKey`) fa sì che lo stesso invio
 * arrivato due volte non segni due incassi; cambia a ogni invio riuscito.
 */
import { Banknote, Check, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { CARE_ADJUSTMENT_DIRECTIONS, CARE_CHARGE_LIMITS, PAYMENT_METHODS } from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
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

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const choice =
  'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';

/** Una chiave nuova per il modulo (UUID v4), anche nei browser senza `crypto.randomUUID`. */
function newSubmitKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** "Cobré en la visita": quanto ha dato il cliente, come e una nota. Resta "por registrar". */
export function CareCollectionDialog({
  action,
  currency,
}: {
  readonly action: Action;
  readonly currency: string;
}) {
  const t = useTranslations('care.collection');
  const tp = useTranslations('care.payment');
  const tm = useTranslations('orders.methods');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [submitKey, setSubmitKey] = useState(newSubmitKey);
  const [state, formAction] = useToastActionState(action, () => {
    setOpen(false);
    setSubmitKey(newSubmitKey());
  });
  const err = (field: string) => fieldError(state, field);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="w-full sm:w-auto">
          <Banknote />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('open')}</DialogTitle>
          <DialogDescription>{t('dialogBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <input type="hidden" name="submitKey" value={submitKey} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="collection-amount"
              label={tp('amount', { currency })}
              error={err('amount')}
              required
            >
              <Input
                {...controlProps('collection-amount', err('amount'))}
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                required
              />
            </Field>
            <Field id="collection-method" label={tp('method')} error={err('method')} required>
              <NativeSelect
                {...controlProps('collection-method', err('method'))}
                name="method"
                defaultValue="CASH"
                required
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {tm(method)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id="collection-note" label={tp('note')} hint={t('noteHint')} error={err('note')}>
            <Textarea
              {...controlProps('collection-note', err('note'), true)}
              name="note"
              rows={2}
              maxLength={CARE_CHARGE_LIMITS.paymentNote}
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('submit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Confirmar": l'importo che entra davvero (proposto quello segnato) e la referencia. */
export function ConfirmCollectionDialog({
  action,
  idPrefix,
  currency,
  collectedLabel,
  defaultAmount,
  label,
}: {
  readonly action: Action;
  readonly idPrefix: string;
  readonly currency: string;
  /** Quanto è stato segnato, già formattato. */
  readonly collectedLabel: string;
  /** Proposta: quanto è stato segnato ("300.00"). */
  readonly defaultAmount: string;
  /** Nome accessibile del pulsante, con importo e cliente. */
  readonly label: string;
}) {
  const t = useTranslations('care.collections');
  const tp = useTranslations('care.payment');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" aria-label={label}>
          <Check />
          {t('confirm')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('confirmTitle')}</DialogTitle>
          <DialogDescription>{t('confirmBody', { amount: collectedLabel })}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <Field
            id={id('amount')}
            label={tp('amount', { currency })}
            error={err('amount')}
            required
          >
            <Input
              {...controlProps(id('amount'), err('amount'))}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={defaultAmount}
              required
            />
          </Field>
          <Field id={id('reference')} label={tp('reference')} error={err('reference')}>
            <Input
              {...controlProps(id('reference'), err('reference'))}
              name="reference"
              maxLength={CARE_CHARGE_LIMITS.paymentReference}
              placeholder={tp('referencePlaceholder')}
              autoComplete="off"
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('confirmSubmit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Rechazar": il motivo è obbligatorio; lo vede chi aveva segnato l'incasso. */
export function RejectCollectionDialog({
  action,
  idPrefix,
  label,
}: {
  readonly action: Action;
  readonly idPrefix: string;
  /** Nome accessibile del pulsante, con importo e cliente. */
  readonly label: string;
}) {
  const t = useTranslations('care.collections');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  const id = `${idPrefix}-reason`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={label}>
          <X />
          {t('reject')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('rejectTitle')}</DialogTitle>
          <DialogDescription>{t('rejectBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <Field id={id} label={t('reason')} error={err('reason')} required>
            <Textarea
              {...controlProps(id, err('reason'))}
              name="reason"
              rows={2}
              maxLength={CARE_CHARGE_LIMITS.rejectReason}
              required
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton variant="destructive" className="w-full sm:w-auto">
              {t('rejectSubmit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Ajuste para el próximo cargo": a favore o a carico del cliente, importo e motivo. */
export function CareAdjustmentDialog({
  action,
  currency,
  trigger,
}: {
  readonly action: Action;
  readonly currency: string;
  readonly trigger?: ReactNode;
}) {
  const t = useTranslations('care.adjustments');
  const tp = useTranslations('care.payment');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Plus />
            {t('add')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('dialogBody')}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('direction')}</legend>
            {CARE_ADJUSTMENT_DIRECTIONS.map((direction) => (
              <label key={direction} className={choice}>
                <input
                  type="radio"
                  name="direction"
                  value={direction}
                  defaultChecked={direction === 'CREDIT'}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>{t(`directions.${direction}`)}</span>
              </label>
            ))}
            {err('direction') ? (
              <p className="text-sm text-destructive">{err('direction')}</p>
            ) : null}
          </fieldset>
          <Field
            id="adjustment-amount"
            label={tp('amount', { currency })}
            error={err('amount')}
            required
          >
            <Input
              {...controlProps('adjustment-amount', err('amount'))}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              required
            />
          </Field>
          <Field id="adjustment-reason" label={t('reason')} error={err('reason')} required>
            <Input
              {...controlProps('adjustment-reason', err('reason'))}
              name="reason"
              maxLength={CARE_CHARGE_LIMITS.adjustmentReason}
              placeholder={t('reasonPlaceholder')}
              autoComplete="off"
              required
            />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{t('submit')}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Quitar" un ajuste prima che entri in un cargo. */
export function RemoveAdjustmentButton({
  action,
  label,
}: {
  readonly action: Action;
  /** Nome accessibile con il motivo. */
  readonly label: string;
}) {
  const t = useTranslations('care.adjustments');
  return (
    <ConfirmActionDialog
      action={action}
      trigger={
        <Button variant="ghost" size="sm" aria-label={label}>
          {t('remove')}
        </Button>
      }
      title={t('removeTitle')}
      description={t('removeBody')}
      confirmLabel={t('removeConfirm')}
    />
  );
}
