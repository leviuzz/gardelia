'use client';

/**
 * Pagamenti di Floral Care (ADR-079): "Registrar pago" su un cargo o sull'estado de cuenta (un
 * solo pagamento per tutte le sedi), "Registrar devolución" di un saldo a favore, "Anular". Il
 * server ricontrolla tutto: qui solo i campi. La chiave del modulo (`submitKey`) fa sì che lo
 * stesso invio arrivato due volte non raddoppi il pagamento; cambia a ogni apertura riuscita.
 */
import { Banknote, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { CARE_CHARGE_LIMITS, PAYMENT_METHODS } from '@floral/domain';
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

/** Una chiave nuova per il modulo (UUID v4), anche nei browser senza `crypto.randomUUID`. */
function newSubmitKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function CarePaymentDialog({
  action,
  mode,
  idPrefix,
  currency,
  today,
  amountLabel,
  defaultAmount,
  trigger,
}: {
  readonly action: Action;
  /** Su un cargo, sull'estado de cuenta (distribuito) o una devolución. */
  readonly mode: 'charge' | 'statement' | 'refund';
  readonly idPrefix: string;
  readonly currency: string;
  /** "AAAA-MM-GG": un pagamento non può essere nel futuro. */
  readonly today: string;
  /** Quanto manca (o quanto è a favore del cliente), già formattato. */
  readonly amountLabel: string;
  /** Proposta: tutto quello che manca ("490.00"). */
  readonly defaultAmount: string;
  readonly trigger?: ReactNode;
}) {
  const t = useTranslations('care.payment');
  const tm = useTranslations('orders.methods');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [submitKey, setSubmitKey] = useState(newSubmitKey);
  const [state, formAction] = useToastActionState(action, () => {
    setOpen(false);
    setSubmitKey(newSubmitKey());
  });
  const err = (field: string) => fieldError(state, field);
  const id = (name: string) => `${idPrefix}-${name}`;
  const refund = mode === 'refund';
  const title = refund ? t('refundTitle') : mode === 'statement' ? t('statementTitle') : t('title');
  const body = refund
    ? t('refundBody', { credit: amountLabel })
    : mode === 'statement'
      ? t('statementBody', { balance: amountLabel })
      : t('body', { balance: amountLabel });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant={refund ? 'secondary' : 'default'} className="w-full sm:w-auto">
            {refund ? <Undo2 /> : <Banknote />}
            {title}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          <input type="hidden" name="submitKey" value={submitKey} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id={id('amount')}
              label={t('amount', { currency })}
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
            <Field id={id('method')} label={t('method')} error={err('method')} required>
              <NativeSelect
                {...controlProps(id('method'), err('method'))}
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
          <Field id={id('paidOn')} label={t('paidOn')} error={err('paidOn')}>
            <Input
              {...controlProps(id('paidOn'), err('paidOn'))}
              name="paidOn"
              type="date"
              max={today}
              defaultValue={today}
            />
          </Field>
          <Field id={id('reference')} label={t('reference')} error={err('reference')}>
            <Input
              {...controlProps(id('reference'), err('reference'))}
              name="reference"
              maxLength={CARE_CHARGE_LIMITS.paymentReference}
              placeholder={t('referencePlaceholder')}
              autoComplete="off"
            />
          </Field>
          <Field id={id('note')} label={t('note')} hint={t('noteHint')} error={err('note')}>
            <Textarea
              {...controlProps(id('note'), err('note'), true)}
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
            <SubmitButton className="w-full sm:w-auto">
              {refund ? t('refundSubmit') : t('submit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Anular" un movimento: resta nello storico con il suo storno, su tutti i cargos toccati. */
export function ReverseCarePaymentButton({
  action,
  label,
  chargeCount,
}: {
  readonly action: Action;
  /** Nome accessibile con l'importo ("Anular el movimiento de $490.00"). */
  readonly label: string;
  /** Su quanti cargos è distribuito il movimento. */
  readonly chargeCount: number;
}) {
  const t = useTranslations('care.payment');
  return (
    <ConfirmActionDialog
      action={action}
      trigger={
        <Button variant="ghost" size="sm" aria-label={label}>
          {t('reverse')}
        </Button>
      }
      title={t('reverseTitle')}
      description={
        chargeCount > 1 ? t('reverseSplitBody', { count: chargeCount }) : t('reverseBody')
      }
      confirmLabel={t('reverseConfirm')}
    />
  );
}
