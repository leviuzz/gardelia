'use client';

import { Banknote, Check, Undo2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import {
  ORDER_LIMITS,
  ORDER_MONEY_LIMITS,
  ORDER_PAYMENT_INPUT_KINDS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@floral/domain';
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

/**
 * I moduli dei soldi di un ordine (M3-3, ADR-088): «Confermo» una prova di pagamento (il modulo di
 * «Registra pagamento» già compilato), «Non lo trovo» e il rifiuto dei contanti con un motivo, «Ho
 * incassato» e la sua conferma, «Registra rimborso». Importi e regole li ricontrolla il servizio;
 * qui solo le proposte (quanto manca, quanto è stato segnato) e i limiti di lunghezza.
 */

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Una finestra con un modulo: si chiude da sola quando il servizio risponde «fatto». */
function FormDialog({
  trigger,
  title,
  description,
  action,
  submitLabel,
  children,
}: {
  readonly trigger: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly action: Action;
  readonly submitLabel: string;
  readonly children: (err: (field: string) => string | undefined) => ReactNode;
}) {
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useToastActionState(action, () => setOpen(false));
  const err = (field: string) => fieldError(state, field);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
          {children(err)}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <SubmitButton className="w-full sm:w-auto">{submitLabel}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AmountField({
  id,
  currency,
  defaultValue,
  error,
  hint,
}: {
  readonly id: string;
  readonly currency: string;
  readonly defaultValue: string;
  readonly error: string | undefined;
  readonly hint?: string;
}) {
  const t = useTranslations('orders');
  return (
    <Field id={id} label={t('detail.amount', { currency })} hint={hint} error={error} required>
      <Input
        {...controlProps(id, error, Boolean(hint))}
        name="amount"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={defaultValue}
        required
      />
    </Field>
  );
}

function MethodField({
  id,
  defaultValue,
  error,
}: {
  readonly id: string;
  readonly defaultValue: PaymentMethod;
  readonly error: string | undefined;
}) {
  const t = useTranslations('orders');
  return (
    <Field id={id} label={t('detail.method')} error={error}>
      <NativeSelect {...controlProps(id, error)} name="method" defaultValue={defaultValue}>
        {PAYMENT_METHODS.map((method) => (
          <option key={method} value={method}>
            {t(`methods.${method}`)}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function DateField({
  id,
  today,
  error,
}: {
  readonly id: string;
  readonly today: string;
  readonly error: string | undefined;
}) {
  const t = useTranslations('orders');
  return (
    <Field id={id} label={t('detail.paidOn')} error={error}>
      <Input
        {...controlProps(id, error)}
        name="paidOn"
        type="date"
        max={today}
        defaultValue={today}
      />
    </Field>
  );
}

function ReferenceField({
  id,
  defaultValue,
  error,
}: {
  readonly id: string;
  readonly defaultValue?: string;
  readonly error: string | undefined;
}) {
  const t = useTranslations('orders');
  return (
    <Field id={id} label={t('detail.reference')} error={error}>
      <Input
        {...controlProps(id, error)}
        name="reference"
        maxLength={ORDER_LIMITS.paymentReference}
        placeholder={t('detail.referencePlaceholder')}
        defaultValue={defaultValue}
      />
    </Field>
  );
}

/**
 * «Confermo» una prova: si apre «Registra pagamento» già compilato (l'importo della prova fino a
 * quanto manca, Bonifico, «Comprobante del cliente»); diventa un pagamento.
 */
export function ConfirmProofDialog({
  proofId,
  action,
  currency,
  today,
  defaultAmount,
  defaultKind,
  amountLabel,
}: {
  readonly proofId: string;
  readonly action: Action;
  readonly currency: string;
  readonly today: string;
  readonly defaultAmount: string;
  readonly defaultKind: 'DEPOSIT' | 'BALANCE';
  /** L'importo della prova, per il nome accessibile del pulsante. */
  readonly amountLabel: string;
}) {
  const t = useTranslations('orders');
  const id = (name: string) => `proof-${proofId}-${name}`;
  return (
    <FormDialog
      trigger={
        <Button size="sm" aria-label={t('money.confirmProofLabel', { amount: amountLabel })}>
          <Check />
          {t('money.confirmProof')}
        </Button>
      }
      title={t('money.confirmProofTitle')}
      description={t('money.confirmProofBody')}
      action={action}
      submitLabel={t('money.confirmProofSubmit')}
    >
      {(err) => (
        <>
          <AmountField
            id={id('amount')}
            currency={currency}
            defaultValue={defaultAmount}
            error={err('amount')}
            hint={t('money.confirmProofAmountHint')}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={id('kind')} label={t('detail.kind')} error={err('kind')}>
              <NativeSelect
                {...controlProps(id('kind'), err('kind'))}
                name="kind"
                defaultValue={defaultKind}
              >
                {ORDER_PAYMENT_INPUT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`paymentKinds.${kind}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <MethodField id={id('method')} defaultValue="TRANSFER" error={err('method')} />
          </div>
          <DateField id={id('date')} today={today} error={err('paidOn')} />
          <ReferenceField
            id={id('reference')}
            defaultValue={t('money.proofReference')}
            error={err('reference')}
          />
        </>
      )}
    </FormDialog>
  );
}

/** «Non lo trovo» (prova) o il rifiuto dei contanti: il motivo è obbligatorio. */
export function RejectMoneyDialog({
  rowId,
  action,
  kind,
  amountLabel,
}: {
  readonly rowId: string;
  readonly action: Action;
  /** `proof`: lo legge chi compra (e gli arriva per email); `cash`: chi li aveva segnati. */
  readonly kind: 'proof' | 'cash';
  readonly amountLabel: string;
}) {
  const t = useTranslations('orders.money');
  const id = `reject-${rowId}-reason`;
  return (
    <FormDialog
      trigger={
        <Button
          size="sm"
          variant="ghost"
          aria-label={t(kind === 'proof' ? 'rejectProofLabel' : 'rejectCashLabel', {
            amount: amountLabel,
          })}
        >
          <X />
          {t(kind === 'proof' ? 'rejectProof' : 'rejectCash')}
        </Button>
      }
      title={t(kind === 'proof' ? 'rejectProofTitle' : 'rejectCashTitle')}
      description={t(kind === 'proof' ? 'rejectProofBody' : 'rejectCashBody')}
      action={action}
      submitLabel={t(kind === 'proof' ? 'rejectProofSubmit' : 'rejectCashSubmit')}
    >
      {(err) => (
        <Field id={id} label={t('reason')} error={err('reason')} required>
          <Textarea
            {...controlProps(id, err('reason'))}
            name="reason"
            maxLength={ORDER_MONEY_LIMITS.rejectReason}
            rows={3}
            required
          />
        </Field>
      )}
    </FormDialog>
  );
}

/**
 * «Ho incassato $X in contanti»: chi prepara o consegna lo segna (proposta: quanto manca). La chiave
 * dell'invio resta la stessa finché non va a buon fine: un doppio clic non segna due volte.
 */
export function CashCollectionDialog({
  orderId,
  action,
  currency,
  defaultAmount,
  compact = false,
}: {
  readonly orderId: string;
  readonly action: Action;
  readonly currency: string;
  readonly defaultAmount: string;
  /** Nelle fermate del percorso: il pulsante più piccolo. */
  readonly compact?: boolean;
}) {
  const t = useTranslations('orders.money');
  const [submitKey, setSubmitKey] = useState(() => crypto.randomUUID());
  const id = (name: string) => `cash-${orderId}-${name}`;
  const run: Action = async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.status === 'success') setSubmitKey(crypto.randomUUID());
    return result;
  };
  return (
    <FormDialog
      trigger={
        <Button
          size="sm"
          variant={compact ? 'outline' : 'secondary'}
          data-testid="cash-collect"
          className={compact ? undefined : 'w-full sm:w-auto'}
        >
          <Banknote />
          {t('collect')}
        </Button>
      }
      title={t('collectTitle')}
      description={t('collectBody')}
      action={run}
      submitLabel={t('collectSubmit')}
    >
      {(err) => (
        <>
          <input type="hidden" name="submitKey" value={submitKey} />
          <AmountField
            id={id('amount')}
            currency={currency}
            defaultValue={defaultAmount}
            error={err('amount')}
          />
          <Field id={id('note')} label={t('note')} hint={t('noteHint')} error={err('note')}>
            <Textarea
              {...controlProps(id('note'), err('note'), true)}
              name="note"
              maxLength={ORDER_MONEY_LIMITS.cashNote}
              rows={2}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** Proprietario o gerente confermano i contanti: fino a quanto segnato e a quanto manca. */
export function ConfirmCashDialog({
  collectionId,
  action,
  currency,
  defaultAmount,
  amountLabel,
}: {
  readonly collectionId: string;
  readonly action: Action;
  readonly currency: string;
  readonly defaultAmount: string;
  readonly amountLabel: string;
}) {
  const t = useTranslations('orders.money');
  const id = (name: string) => `cash-confirm-${collectionId}-${name}`;
  return (
    <FormDialog
      trigger={
        <Button size="sm" aria-label={t('confirmCashLabel', { amount: amountLabel })}>
          <Check />
          {t('confirmCash')}
        </Button>
      }
      title={t('confirmCashTitle')}
      description={t('confirmCashBody')}
      action={action}
      submitLabel={t('confirmCashSubmit')}
    >
      {(err) => (
        <>
          <AmountField
            id={id('amount')}
            currency={currency}
            defaultValue={defaultAmount}
            error={err('amount')}
            hint={t('confirmCashAmountHint')}
          />
          <ReferenceField id={id('reference')} error={err('reference')} />
        </>
      )}
    </FormDialog>
  );
}

/** «Registra rimborso» su un ordine annullato: fino a quanto è stato pagato, anche in più volte. */
export function RefundForm({
  action,
  currency,
  today,
  defaultAmount,
}: {
  readonly action: Action;
  readonly currency: string;
  readonly today: string;
  /** Proposta: tutto il pagato. */
  readonly defaultAmount: string;
}) {
  const t = useTranslations('orders.money');
  const [state, formAction] = useToastActionState(action);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      key={defaultAmount}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-4 rounded-xl border p-4"
      data-testid="refund-form"
    >
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Undo2 className="size-4 text-primary" aria-hidden="true" />
          {t('refundTitle')}
        </p>
        <p className="text-sm text-muted-foreground">{t('refundBody')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <AmountField
          id="refund-amount"
          currency={currency}
          defaultValue={defaultAmount}
          error={err('amount')}
        />
        <MethodField id="refund-method" defaultValue="TRANSFER" error={err('method')} />
        <DateField id="refund-date" today={today} error={err('paidOn')} />
        <ReferenceField id="refund-reference" error={err('reference')} />
      </div>
      <div>
        <SubmitButton variant="secondary">{t('refundSubmit')}</SubmitButton>
      </div>
    </form>
  );
}
