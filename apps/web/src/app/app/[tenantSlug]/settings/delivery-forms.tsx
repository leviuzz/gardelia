'use client';

import { Plus, Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionButton } from '@/components/form/action-button';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Checkbox, Input } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Giorni di chiusura e costo di consegna proposto (ADR-055). */
export function DeliveryDefaultsForm({
  action,
  currency,
  weekdays,
  defaults,
}: {
  readonly action: Action;
  readonly currency: string;
  /** Da lunedì a domenica, con il nome già tradotto. */
  readonly weekdays: readonly { readonly value: number; readonly label: string }[];
  readonly defaults: { readonly closedWeekdays: readonly number[]; readonly defaultFee: string };
}) {
  const t = useTranslations('settings.delivery');
  const tc = useTranslations('common');
  const [state, formAction] = useToastActionState(action);
  const err = (field: string) => fieldError(state, field);
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="grid gap-5">
      <fieldset>
        <legend className="text-sm font-medium">{t('closedDays')}</legend>
        <p className="mt-1 mb-3 text-sm text-muted-foreground">{t('closedDaysHint')}</p>
        <div className="flex flex-wrap gap-2">
          {weekdays.map((day) => (
            <label
              key={day.value}
              className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <Checkbox
                name="closedWeekdays"
                value={String(day.value)}
                defaultChecked={defaults.closedWeekdays.includes(day.value)}
              />
              {day.label}
            </label>
          ))}
        </div>
        {err('closedWeekdays') ? (
          <p className="mt-2 text-sm text-destructive">{err('closedWeekdays')}</p>
        ) : null}
      </fieldset>
      <Field
        id="delivery-default-fee"
        label={t('defaultFee', { currency })}
        hint={t('defaultFeeHint')}
        error={err('defaultFee')}
        className="max-w-xs"
      >
        <Input
          {...controlProps('delivery-default-fee', err('defaultFee'), true)}
          name="defaultFee"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          defaultValue={defaults.defaultFee}
        />
      </Field>
      <div>
        <SubmitButton variant="secondary">{tc('save')}</SubmitButton>
      </div>
    </form>
  );
}

export interface DeliveryFeeTierView {
  readonly id: string;
  /** "Hasta 3 km" già formattato. */
  readonly distanceLabel: string;
  /** "$80.00" già formattato. */
  readonly feeLabel: string;
  readonly removeAction: Action;
}

/** Costo per distanza (ADR-069): fasce "hasta X km" con il loro costo e form per aggiungerne. */
export function DeliveryFeeTiersEditor({
  tiers,
  addAction,
  max,
  currency,
}: {
  readonly tiers: readonly DeliveryFeeTierView[];
  readonly addAction: Action;
  readonly max: number;
  readonly currency: string;
}) {
  const t = useTranslations('settings.delivery');
  const [formKey, setFormKey] = useState(0);
  const [state, formAction] = useToastActionState(addAction, () => setFormKey((key) => key + 1));
  const err = (field: string) => fieldError(state, field);

  return (
    <div className="grid gap-4">
      {tiers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noTiers')}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {tiers.map((tier) => (
            <li key={tier.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="flex flex-wrap gap-x-3">
                <span className="font-medium">{tier.distanceLabel}</span>
                <span className="tabular-nums">{tier.feeLabel}</span>
              </span>
              <ActionButton
                action={tier.removeAction}
                size="icon-sm"
                variant="ghost"
                aria-label={t('removeTier', { tier: tier.distanceLabel })}
                icon={<Trash />}
              />
            </li>
          ))}
        </ul>
      )}
      {tiers.length < max ? (
        <form
          key={formKey}
          action={formAction}
          onSubmit={preserveOnSubmit(formAction)}
          className="grid grid-cols-2 gap-3 sm:grid-cols-[12rem_9rem_auto] sm:items-start"
        >
          <Field id="tier-km" label={t('tierKm')} error={err('upToKm')} required>
            <Input
              {...controlProps('tier-km', err('upToKm'))}
              name="upToKm"
              type="number"
              inputMode="decimal"
              min={0.1}
              max={100}
              step={0.1}
              required
            />
          </Field>
          <Field id="tier-fee" label={t('tierFee', { currency })} error={err('fee')} required>
            <Input
              {...controlProps('tier-fee', err('fee'))}
              name="fee"
              inputMode="decimal"
              autoComplete="off"
              required
            />
          </Field>
          <div className="col-span-2 sm:col-span-1 sm:pt-7">
            <SubmitButton variant="secondary" className="w-full sm:w-auto">
              <Plus />
              {t('addTier')}
            </SubmitButton>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t('tierLimit', { max })}</p>
      )}
    </div>
  );
}

export interface DeliveryWindowView {
  readonly id: string;
  /** "9:00 – 12:00" già formattato. */
  readonly label: string;
  readonly removeAction: Action;
}

/** Fasce orarie: elenco con "Quitar" e form per aggiungerne una. */
export function DeliveryWindowsEditor({
  windows,
  addAction,
  max,
}: {
  readonly windows: readonly DeliveryWindowView[];
  readonly addAction: Action;
  readonly max: number;
}) {
  const t = useTranslations('settings.delivery');
  // Dopo un'aggiunta riuscita si rimonta il form per svuotarlo.
  const [formKey, setFormKey] = useState(0);
  const [state, formAction] = useToastActionState(addAction, () => setFormKey((key) => key + 1));
  const err = (field: string) => fieldError(state, field);

  return (
    <div className="grid gap-4">
      {windows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noWindows')}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {windows.map((window) => (
            <li key={window.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="font-medium tabular-nums">{window.label}</span>
              <ActionButton
                action={window.removeAction}
                size="icon-sm"
                variant="ghost"
                aria-label={t('removeWindow', { window: window.label })}
                icon={<Trash />}
              />
            </li>
          ))}
        </ul>
      )}
      {windows.length < max ? (
        <form
          key={formKey}
          action={formAction}
          onSubmit={preserveOnSubmit(formAction)}
          className="grid grid-cols-2 gap-3 sm:grid-cols-[9rem_9rem_auto] sm:items-start"
        >
          <Field id="window-start" label={t('windowStart')} error={err('start')} required>
            <Input
              {...controlProps('window-start', err('start'))}
              name="start"
              type="time"
              step={900}
              required
            />
          </Field>
          <Field id="window-end" label={t('windowEnd')} error={err('end')} required>
            <Input
              {...controlProps('window-end', err('end'))}
              name="end"
              type="time"
              step={900}
              required
            />
          </Field>
          <div className="col-span-2 sm:col-span-1 sm:pt-7">
            <SubmitButton variant="secondary" className="w-full sm:w-auto">
              <Plus />
              {t('addWindow')}
            </SubmitButton>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t('windowLimit', { max })}</p>
      )}
    </div>
  );
}
