'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { DISCOUNT_KINDS, PROMO_LIMITS, type DiscountKind } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Checkbox, Input } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';
import { cn } from '@/lib/utils';

/**
 * Promo delle date speciali: attivazione, tipo di sconto e valore. Si mostra (e si invia) solo il
 * campo del tipo scelto; il server rivalida tutto.
 */
export function OccasionPromoForm({
  action,
  defaults,
  currency,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: {
    readonly enabled: boolean;
    readonly kind: DiscountKind;
    readonly percent: string;
    readonly amount: string;
  };
  currency: string;
}) {
  const t = useTranslations('promotions.form');
  const tc = useTranslations('common');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  const [kind, setKind] = useState<DiscountKind>(defaults.kind);

  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="space-y-6">
      <label className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm font-medium">
        <Checkbox name="enabled" defaultChecked={defaults.enabled} className="mt-0.5" />
        <span>
          {t('enabled')}
          <span className="block text-xs font-normal text-muted-foreground">
            {t('enabledHint')}
          </span>
        </span>
      </label>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t('kind')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DISCOUNT_KINDS.map((option) => (
            <label
              key={option}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40',
                kind === option ? 'border-primary bg-secondary/70 font-medium' : 'hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="size-4 accent-primary"
              />
              {t(`kinds.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {kind === 'PERCENT' ? (
        <Field
          id="percent"
          label={t('percent')}
          hint={t('percentHint', { min: PROMO_LIMITS.percentMin, max: PROMO_LIMITS.percentMax })}
          error={err('percent')}
        >
          <div className="relative max-w-40">
            <Input
              {...controlProps('percent', err('percent'), true)}
              name="percent"
              inputMode="numeric"
              defaultValue={defaults.percent}
              className="pr-8"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground"
            >
              %
            </span>
          </div>
        </Field>
      ) : (
        <Field id="amount" label={t('amount', { currency })} error={err('amount')}>
          <Input
            {...controlProps('amount', err('amount'))}
            name="amount"
            inputMode="decimal"
            defaultValue={defaults.amount}
            className="max-w-48"
          />
        </Field>
      )}

      <SubmitButton>{tc('saveChanges')}</SubmitButton>
    </form>
  );
}
