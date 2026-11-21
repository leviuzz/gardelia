'use client';

import { ChevronRight, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { SubmitButton } from '@/components/form/submit-button';
import { idleState, type ActionState } from '@/lib/action-state';
import { initials } from '@/lib/format';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface PickableCustomer {
  readonly id: string;
  readonly displayName: string;
  readonly detail: string | null;
}

function PickButton({ customer, label }: { customer: PickableCustomer; label: string }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get('customerId') === customer.id;
  return (
    <button
      type="submit"
      name="customerId"
      value={customer.id}
      disabled={pending}
      aria-busy={mine}
      aria-label={label}
      className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none disabled:cursor-wait disabled:opacity-70"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
        aria-hidden="true"
      >
        {initials(customer.displayName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{customer.displayName}</span>
        {customer.detail ? (
          <span className="block truncate text-sm text-muted-foreground">{customer.detail}</span>
        ) : null}
      </span>
      {mine ? (
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * Elenco di clienti: un solo form, un pulsante di invio per cliente (il valore del
 * pulsante premuto arriva nel FormData). La server action crea il preventivo e reindirizza.
 */
export function CustomerPicker({
  action,
  customers,
  configurationId,
}: {
  action: Action;
  customers: readonly PickableCustomer[];
  /** Disegno del Builder da trasformare in preventivo (facoltativo). */
  configurationId: string | null;
}) {
  const t = useTranslations('quotes.new');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)}>
      {configurationId ? (
        <input type="hidden" name="configurationId" value={configurationId} />
      ) : null}
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {customers.map((customer) => (
          <li key={customer.id}>
            <PickButton customer={customer} label={t('quoteFor', { name: customer.displayName })} />
          </li>
        ))}
      </ul>
    </form>
  );
}

/** Conferma della creazione per un cliente già scelto (es. dalla sua scheda). */
export function CreateForCustomer({
  action,
  customerId,
  configurationId,
}: {
  action: Action;
  customerId: string;
  configurationId: string | null;
}) {
  const t = useTranslations('quotes.new');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)}>
      <input type="hidden" name="customerId" value={customerId} />
      {configurationId ? (
        <input type="hidden" name="configurationId" value={configurationId} />
      ) : null}
      <SubmitButton size="lg" className="w-full sm:w-auto" pendingLabel={t('creating')}>
        {t('create')}
      </SubmitButton>
    </form>
  );
}
