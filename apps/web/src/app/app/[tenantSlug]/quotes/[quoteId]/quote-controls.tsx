'use client';

import { Ban, CircleCheck, CircleX, LoaderCircle, Printer, Send, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { QuoteStatus } from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer />
      {label}
    </Button>
  );
}

type DirectTransition = Exclude<QuoteStatus, 'EXPIRED' | 'CANCELLED'>;

const TRANSITION_STYLE: Record<
  DirectTransition,
  { variant: ButtonProps['variant']; icon: ReactNode }
> = {
  SENT: { variant: 'default', icon: <Send /> },
  ACCEPTED: { variant: 'default', icon: <CircleCheck /> },
  REJECTED: { variant: 'outline', icon: <CircleX /> },
  DRAFT: { variant: 'outline', icon: <Undo2 /> },
};

function isDirect(status: QuoteStatus): status is DirectTransition {
  return status !== 'EXPIRED' && status !== 'CANCELLED';
}

/** Pulsante di un form con più invii: mostra l'attesa solo sul pulsante premuto. */
function TransitionButton({ status, label }: { status: DirectTransition; label: string }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get('status') === status;
  const style = TRANSITION_STYLE[status];
  return (
    <Button
      type="submit"
      name="status"
      value={status}
      variant={style.variant}
      disabled={pending}
      aria-busy={mine}
      className="w-full"
    >
      {mine ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : style.icon}
      {label}
    </Button>
  );
}

/**
 * Cambi di stato consentiti (calcolati dal servizio, che li riverifica). Un solo stato
 * d'azione per tutti i pulsanti: il componente resta montato anche quando, dopo il
 * cambio, l'elenco delle transizioni cambia o si svuota.
 */
export function QuoteStatusActions({
  action,
  transitions,
}: {
  action: Action;
  transitions: readonly QuoteStatus[];
}) {
  const t = useTranslations();
  const [, formAction] = useToastActionState(action);
  const direct = transitions.filter(isDirect);

  if (transitions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('quotes.editor.noTransitions')}</p>;
  }

  return (
    <div className="grid gap-2">
      {direct.length > 0 ? (
        <form action={formAction} className="grid gap-2">
          {direct.map((status) => (
            <TransitionButton
              key={status}
              status={status}
              label={t(`quotes.editor.transitions.${status}`)}
            />
          ))}
        </form>
      ) : null}
      {transitions.includes('CANCELLED') ? (
        <ConfirmActionDialog
          action={action}
          trigger={
            <Button variant="ghost" className="w-full text-destructive hover:text-destructive">
              <Ban />
              {t('quotes.editor.transitions.CANCELLED')}
            </Button>
          }
          title={t('quotes.editor.cancelTitle')}
          description={t('quotes.editor.cancelBody')}
          confirmLabel={t('quotes.editor.transitions.CANCELLED')}
          fields={{ status: 'CANCELLED' }}
        />
      ) : null}
    </div>
  );
}

export interface QuoteDetailsDefaults {
  readonly title: string;
  readonly validUntil: string;
  readonly discount: string;
  readonly notes: string;
}

export function QuoteDetailsForm({
  action,
  defaults,
  formKey,
  currency,
  dateMin,
  dateMax,
}: {
  action: Action;
  defaults: QuoteDetailsDefaults;
  /** Cambia quando il server modifica i valori (es. sconto ridotto al subtotale). */
  formKey: string;
  currency: string;
  dateMin: string;
  dateMax: string;
}) {
  const t = useTranslations('quotes.editor');
  const [state, formAction] = useToastActionState(action);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      key={formKey}
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-4"
    >
      <Field id="quote-title" label={t('titleField')} error={err('title')}>
        <Input
          {...controlProps('quote-title', err('title'))}
          name="title"
          defaultValue={defaults.title}
          placeholder={t('titlePlaceholder')}
          maxLength={120}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Field
          id="quote-valid-until"
          label={t('validUntilField')}
          error={err('validUntil')}
          hint={t('validUntilHint')}
        >
          <Input
            {...controlProps('quote-valid-until', err('validUntil'), true)}
            name="validUntil"
            type="date"
            min={dateMin}
            max={dateMax}
            defaultValue={defaults.validUntil}
          />
        </Field>
        <Field id="quote-discount" label={t('discountField', { currency })} error={err('discount')}>
          <Input
            {...controlProps('quote-discount', err('discount'))}
            name="discount"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={defaults.discount}
            placeholder="0"
          />
        </Field>
      </div>
      <Field id="quote-notes" label={t('notes')} error={err('notes')}>
        <Textarea
          {...controlProps('quote-notes', err('notes'))}
          name="notes"
          defaultValue={defaults.notes}
          maxLength={2000}
          rows={4}
        />
      </Field>
      <div>
        <SubmitButton variant="secondary">{t('saveDetails')}</SubmitButton>
      </div>
    </form>
  );
}
