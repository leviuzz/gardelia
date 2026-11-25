'use client';

/**
 * La pagina del cliente di Floral Care (ADR-084): "Cambiar fecha" fra le fasce libere e
 * "Aceptar invitación". Il server ricontrolla tutto (accesso, mese, preavviso, posti, email).
 */
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormAlert } from '@/components/form/form-alert';
import { SubmitButton } from '@/components/form/submit-button';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface DateOptionGroup {
  /** "AAAA-MM-GG". */
  readonly date: string;
  /** Il giorno già scritto nella lingua di chi guarda. */
  readonly label: string;
  readonly options: readonly {
    readonly slotId: string;
    readonly start: string;
    readonly end: string;
  }[];
}

const choice =
  'flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5';

/** "Cambiar fecha": un orario per volta (giorno e fascia nello stesso valore, `choice`). */
export function ChangeDateForm({
  action,
  groups,
}: {
  readonly action: Action;
  readonly groups: readonly DateOptionGroup[];
}) {
  const t = useTranslations('account.care.change');
  const [state, formAction] = useToastActionState(action);
  const error = fieldError(state, 'date') ?? fieldError(state, 'slotId');
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-4">
      <fieldset className="grid gap-4" data-testid="change-date-options">
        <legend className="mb-2 text-sm font-medium">{t('choose')}</legend>
        {groups.map((group) => (
          <div key={group.date} className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground first-letter:uppercase">
              {group.label}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.options.map((option) => (
                <label key={option.slotId} className={choice}>
                  <input
                    type="radio"
                    name="choice"
                    value={`${group.date}|${option.slotId}`}
                    required
                    className="size-4 accent-primary"
                  />
                  <span className="tabular-nums">
                    {option.start}–{option.end}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div>
        <SubmitButton className="w-full sm:w-auto" pendingLabel={t('saving')}>
          {t('submit')}
        </SubmitButton>
      </div>
    </form>
  );
}

/** "Aceptar invitación" (con la sessione dell'email invitata). */
export function AcceptPortalInviteForm({ action }: { readonly action: Action }) {
  const t = useTranslations('account.care.invite');
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
