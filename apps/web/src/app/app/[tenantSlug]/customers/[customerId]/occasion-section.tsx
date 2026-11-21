'use client';

import { CalendarHeart, Plus, Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { OCCASION_TYPES, type OccasionType } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface OccasionView {
  readonly id: string;
  readonly type: OccasionType;
  readonly label: string | null;
  readonly personName: string | null;
  readonly month: number;
  readonly day: number;
  readonly year: number | null;
  readonly daysUntil: number;
  readonly removeAction: Action;
}

function RemoveOccasionButton({ action, label }: { action: Action; label: string }) {
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  return (
    <form action={formAction}>
      <SubmitButton size="icon-sm" variant="ghost" aria-label={label}>
        <Trash />
      </SubmitButton>
    </form>
  );
}

function AddOccasionForm({ action, onDone }: { action: Action; onDone: () => void }) {
  const t = useTranslations('customers.occasions');
  const tCustomers = useTranslations('customers');
  const tCommon = useTranslations('common');
  const [type, setType] = useState<OccasionType>('BIRTHDAY');
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.status === 'success') onDone();
    return result;
  }, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  const months = tCustomers.raw('months') as string[];

  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2"
    >
      <Field id="occasion-type" label={t('type')} error={err('type')}>
        <NativeSelect
          {...controlProps('occasion-type', err('type'))}
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value as OccasionType)}
        >
          {OCCASION_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`types.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {type === 'CUSTOM' ? (
        <Field id="occasion-label" label={t('label')} error={err('label')} required>
          <Input
            {...controlProps('occasion-label', err('label'))}
            name="label"
            placeholder={t('labelPlaceholder')}
            maxLength={80}
            required
          />
        </Field>
      ) : (
        <div className="hidden sm:block" />
      )}
      <Field
        id="occasion-person"
        label={t('personName')}
        hint={t('personNameHint')}
        error={err('personName')}
        className="sm:col-span-2"
      >
        <Input
          {...controlProps('occasion-person', err('personName'), true)}
          name="personName"
          maxLength={120}
        />
      </Field>
      <Field id="occasion-month" label={t('month')} error={err('month')} required>
        <NativeSelect
          {...controlProps('occasion-month', err('month'))}
          name="month"
          defaultValue="1"
        >
          {months.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="occasion-day" label={t('day')} error={err('day')} required>
        <Input
          {...controlProps('occasion-day', err('day'))}
          name="day"
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          required
        />
      </Field>
      <Field id="occasion-year" label={t('year')} error={err('year')}>
        <Input
          {...controlProps('occasion-year', err('year'))}
          name="year"
          type="number"
          inputMode="numeric"
          min={1900}
          max={2100}
        />
      </Field>
      <Field id="occasion-remind" label={t('remindDaysBefore')} error={err('remindDaysBefore')}>
        <Input
          {...controlProps('occasion-remind', err('remindDaysBefore'))}
          name="remindDaysBefore"
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          defaultValue={7}
        />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <SubmitButton size="sm">{t('add')}</SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  );
}

export function OccasionSection({
  occasions,
  canWrite,
  addAction,
}: {
  occasions: readonly OccasionView[];
  canWrite: boolean;
  addAction: Action;
}) {
  const t = useTranslations('customers.occasions');
  const tCustomers = useTranslations('customers');
  const [adding, setAdding] = useState(false);
  const months = tCustomers.raw('months') as string[];

  return (
    <div className="space-y-3">
      {occasions.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
      <ul className="space-y-2">
        {occasions.map((occasion) => (
          <li key={occasion.id} className="flex items-center gap-3 rounded-xl border p-3">
            <CalendarHeart className="size-4 shrink-0 text-accent-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                {occasion.type === 'CUSTOM' && occasion.label
                  ? occasion.label
                  : t(`types.${occasion.type}`)}
                {occasion.personName ? (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {t('of', { name: occasion.personName })}
                  </span>
                ) : null}
              </p>
              <p className="text-muted-foreground">
                {occasion.year
                  ? t('dateWithYear', {
                      day: occasion.day,
                      month: months[occasion.month - 1] ?? '',
                      year: occasion.year,
                    })
                  : t('date', { day: occasion.day, month: months[occasion.month - 1] ?? '' })}
              </p>
            </div>
            <Badge variant={occasion.daysUntil <= 7 ? 'accent' : 'muted'}>
              {occasion.daysUntil === 0 ? t('today') : t('inDays', { count: occasion.daysUntil })}
            </Badge>
            {canWrite ? (
              <RemoveOccasionButton action={occasion.removeAction} label={t('remove')} />
            ) : null}
          </li>
        ))}
      </ul>
      {canWrite ? (
        adding ? (
          <AddOccasionForm action={addAction} onDone={() => setAdding(false)} />
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            {t('add')}
          </Button>
        )
      ) : null}
    </div>
  );
}
