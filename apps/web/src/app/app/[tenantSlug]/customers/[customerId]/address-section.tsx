'use client';

import { MapPin, Pencil, Plus, Trash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, NativeSelect } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface AddressView {
  readonly id: string;
  readonly label: string | null;
  readonly recipientName: string | null;
  readonly recipientPhone: string | null;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly neighborhood: string | null;
  readonly city: string;
  readonly region: string;
  readonly regionName: string;
  readonly postalCode: string;
  readonly deliveryNotes: string | null;
  readonly isDefault: boolean;
  readonly updateAction: Action;
  readonly archiveAction: Action;
}

interface Region {
  readonly code: string;
  readonly name: string;
}

function AddressForm({
  action,
  regions,
  defaults,
  idPrefix,
  onDone,
  submitLabel,
}: {
  action: Action;
  regions: readonly Region[];
  defaults?: Partial<AddressView> & { recipientPhoneInput?: string };
  idPrefix: string;
  onDone: () => void;
  submitLabel: string;
}) {
  const t = useTranslations('customers.addresses');
  const tOnboarding = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const [state, formAction] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.status === 'success') onDone();
    return result;
  }, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2"
    >
      <Field id={id('label')} label={t('label')} error={err('label')}>
        <Input
          {...controlProps(id('label'), err('label'))}
          name="label"
          defaultValue={defaults?.label ?? ''}
          placeholder={t('labelPlaceholder')}
          maxLength={40}
        />
      </Field>
      <Field id={id('recipientName')} label={t('recipientName')} error={err('recipientName')}>
        <Input
          {...controlProps(id('recipientName'), err('recipientName'))}
          name="recipientName"
          defaultValue={defaults?.recipientName ?? ''}
          maxLength={120}
        />
      </Field>
      <Field
        id={id('addressLine1')}
        label={tOnboarding('addressLine1')}
        error={err('addressLine1')}
        required
        className="sm:col-span-2"
      >
        <Input
          {...controlProps(id('addressLine1'), err('addressLine1'))}
          name="addressLine1"
          defaultValue={defaults?.addressLine1 ?? ''}
          required
        />
      </Field>
      <Field
        id={id('addressLine2')}
        label={tOnboarding('addressLine2')}
        error={err('addressLine2')}
      >
        <Input
          {...controlProps(id('addressLine2'), err('addressLine2'))}
          name="addressLine2"
          defaultValue={defaults?.addressLine2 ?? ''}
        />
      </Field>
      <Field
        id={id('neighborhood')}
        label={tOnboarding('neighborhood')}
        error={err('neighborhood')}
      >
        <Input
          {...controlProps(id('neighborhood'), err('neighborhood'))}
          name="neighborhood"
          defaultValue={defaults?.neighborhood ?? ''}
        />
      </Field>
      <Field
        id={id('postalCode')}
        label={tOnboarding('postalCode')}
        error={err('postalCode')}
        required
      >
        <Input
          {...controlProps(id('postalCode'), err('postalCode'))}
          name="postalCode"
          inputMode="numeric"
          maxLength={5}
          defaultValue={defaults?.postalCode ?? ''}
          required
        />
      </Field>
      <Field id={id('city')} label={tOnboarding('city')} error={err('city')} required>
        <Input
          {...controlProps(id('city'), err('city'))}
          name="city"
          defaultValue={defaults?.city ?? ''}
          required
        />
      </Field>
      <Field id={id('region')} label={tOnboarding('region')} error={err('region')} required>
        <NativeSelect
          {...controlProps(id('region'), err('region'))}
          name="region"
          defaultValue={defaults?.region ?? 'AGU'}
        >
          {regions.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={id('recipientPhone')} label={t('recipientPhone')} error={err('recipientPhone')}>
        <Input
          {...controlProps(id('recipientPhone'), err('recipientPhone'))}
          name="recipientPhone"
          type="tel"
          inputMode="tel"
          defaultValue={defaults?.recipientPhoneInput ?? ''}
        />
      </Field>
      <Field
        id={id('deliveryNotes')}
        label={t('deliveryNotes')}
        error={err('deliveryNotes')}
        className="sm:col-span-2"
      >
        <Input
          {...controlProps(id('deliveryNotes'), err('deliveryNotes'))}
          name="deliveryNotes"
          defaultValue={defaults?.deliveryNotes ?? ''}
          placeholder={t('deliveryNotesPlaceholder')}
          maxLength={500}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <Checkbox name="isDefault" defaultChecked={defaults?.isDefault ?? false} />
        {t('isDefault')}
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <SubmitButton size="sm">{submitLabel}</SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  );
}

function ArchiveAddressButton({ action, label }: { action: Action; label: string }) {
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

function formatPhone(e164: string | null): string {
  if (!e164) return '';
  const match = /^\+52(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : e164;
}

export function AddressSection({
  addresses,
  canWrite,
  addAction,
  regions,
}: {
  addresses: readonly AddressView[];
  canWrite: boolean;
  addAction: Action;
  regions: readonly Region[];
}) {
  const t = useTranslations('customers.addresses');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {addresses.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
      <ul className="space-y-3">
        {addresses.map((address) =>
          editing === address.id ? (
            <li key={address.id}>
              <AddressForm
                action={address.updateAction}
                regions={regions}
                defaults={{ ...address, recipientPhoneInput: formatPhone(address.recipientPhone) }}
                idPrefix={`edit-${address.id}`}
                onDone={() => setEditing(null)}
                submitLabel={t('save')}
              />
            </li>
          ) : (
            <li key={address.id} className="flex gap-3 rounded-xl border p-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {address.label ?? address.addressLine1}
                  {address.isDefault ? <Badge variant="secondary">{t('default')}</Badge> : null}
                </p>
                <p className="text-muted-foreground">
                  {[address.addressLine1, address.addressLine2, address.neighborhood]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                <p className="text-muted-foreground">
                  {t('cityLine', {
                    city: address.city,
                    region: address.regionName,
                    postalCode: address.postalCode,
                  })}
                </p>
                {address.recipientName ? (
                  <p className="text-muted-foreground">
                    {t('recipientName')}: {address.recipientName}
                    {address.recipientPhone ? ` · ${formatPhone(address.recipientPhone)}` : ''}
                  </p>
                ) : null}
                {address.deliveryNotes ? (
                  <p className="mt-1 text-xs text-muted-foreground">{address.deliveryNotes}</p>
                ) : null}
              </div>
              {canWrite ? (
                <div className="flex shrink-0 items-start gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('edit')}
                    onClick={() => setEditing(address.id)}
                  >
                    <Pencil />
                  </Button>
                  <ArchiveAddressButton action={address.archiveAction} label={t('remove')} />
                </div>
              ) : null}
            </li>
          ),
        )}
      </ul>
      {canWrite ? (
        adding ? (
          <AddressForm
            action={addAction}
            regions={regions}
            idPrefix="new-address"
            onDone={() => setAdding(false)}
            submitLabel={t('add')}
          />
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
