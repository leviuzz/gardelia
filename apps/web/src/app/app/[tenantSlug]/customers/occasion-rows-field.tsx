'use client';

import { Plus, Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CUSTOMER_LIMITS, OCCASION_TYPES, type OccasionType } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';

interface OccasionRow {
  readonly key: number;
  readonly type: OccasionType;
  readonly label: string;
  readonly personName: string;
  readonly day: string;
  readonly month: string;
  readonly year: string;
  readonly remindDaysBefore: string;
}

/**
 * Date speciali dentro il modulo "Nuevo cliente": righe aggiunte e tolte nel browser, inviate
 * insieme al cliente come JSON nel campo nascosto `occasions` (il server le valida una per una
 * e salva tutto nella stessa transazione). Gli errori arrivano come `occasions.<n>.<campo>`.
 */
export function OccasionRowsField({ error }: { error: (field: string) => string | undefined }) {
  const t = useTranslations('customers.occasions');
  const tCustomers = useTranslations('customers');
  const months = tCustomers.raw('months') as string[];
  const [rows, setRows] = useState<readonly OccasionRow[]>([]);
  const [nextKey, setNextKey] = useState(1);

  function add() {
    setRows((current) => [
      ...current,
      {
        key: nextKey,
        type: 'BIRTHDAY',
        label: '',
        personName: '',
        day: '',
        month: '1',
        year: '',
        remindDaysBefore: '7',
      },
    ]);
    setNextKey((key) => key + 1);
  }

  function update(key: number, patch: Partial<OccasionRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  const payload = JSON.stringify(rows.map(({ key: _key, ...row }) => row));

  return (
    <div className="space-y-4">
      <input type="hidden" name="occasions" value={payload} />
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : null}
      {rows.map((row, index) => {
        const id = (field: string) => `occasion-${row.key}-${field}`;
        const err = (field: string) => error(`occasions.${index}.${field}`);
        return (
          <fieldset
            key={row.key}
            className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-12"
          >
            <legend className="sr-only">{t('rowLabel', { number: index + 1 })}</legend>
            <Field id={id('type')} label={t('type')} error={err('type')} className="sm:col-span-4">
              <NativeSelect
                {...controlProps(id('type'), err('type'))}
                value={row.type}
                onChange={(event) => update(row.key, { type: event.target.value as OccasionType })}
              >
                {OCCASION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`types.${value}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {row.type === 'CUSTOM' ? (
              <Field
                id={id('label')}
                label={t('label')}
                error={err('label')}
                required
                className="sm:col-span-4"
              >
                <Input
                  {...controlProps(id('label'), err('label'))}
                  value={row.label}
                  onChange={(event) => update(row.key, { label: event.target.value })}
                  placeholder={t('labelPlaceholder')}
                  maxLength={CUSTOMER_LIMITS.occasionLabel}
                />
              </Field>
            ) : null}
            <Field
              id={id('personName')}
              label={t('personName')}
              hint={t('personNameHint')}
              error={err('personName')}
              className={row.type === 'CUSTOM' ? 'sm:col-span-4' : 'sm:col-span-8'}
            >
              <Input
                {...controlProps(id('personName'), err('personName'), true)}
                value={row.personName}
                onChange={(event) => update(row.key, { personName: event.target.value })}
                maxLength={CUSTOMER_LIMITS.recipientName}
              />
            </Field>
            <Field
              id={id('day')}
              label={t('day')}
              error={err('day')}
              required
              className="sm:col-span-2"
            >
              <Input
                {...controlProps(id('day'), err('day'))}
                value={row.day}
                onChange={(event) => update(row.key, { day: event.target.value })}
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
              />
            </Field>
            <Field
              id={id('month')}
              label={t('month')}
              error={err('month')}
              required
              className="sm:col-span-3"
            >
              <NativeSelect
                {...controlProps(id('month'), err('month'))}
                value={row.month}
                onChange={(event) => update(row.key, { month: event.target.value })}
              >
                {months.map((name, monthIndex) => (
                  <option key={name} value={monthIndex + 1}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id={id('year')} label={t('year')} error={err('year')} className="sm:col-span-3">
              <Input
                {...controlProps(id('year'), err('year'))}
                value={row.year}
                onChange={(event) => update(row.key, { year: event.target.value })}
                type="number"
                inputMode="numeric"
                min={1900}
                max={2100}
              />
            </Field>
            <Field
              id={id('remindDaysBefore')}
              label={t('remindDaysBefore')}
              error={err('remindDaysBefore')}
              className="sm:col-span-4"
            >
              <Input
                {...controlProps(id('remindDaysBefore'), err('remindDaysBefore'))}
                value={row.remindDaysBefore}
                onChange={(event) => update(row.key, { remindDaysBefore: event.target.value })}
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
              />
            </Field>
            <div className="flex items-end sm:col-span-12 sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
              >
                <Trash aria-hidden="true" />
                {t('remove')}
              </Button>
            </div>
          </fieldset>
        );
      })}
      {error('occasions') ? <p className="text-sm text-destructive">{error('occasions')}</p> : null}
      <Button
        type="button"
        variant="outline"
        onClick={add}
        disabled={rows.length >= CUSTOMER_LIMITS.occasionsPerCustomer}
      >
        <Plus aria-hidden="true" />
        {t('add')}
      </Button>
    </div>
  );
}
