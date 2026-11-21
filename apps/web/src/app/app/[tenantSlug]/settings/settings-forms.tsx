'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Input, NativeSelect } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function ProfileForm({
  action,
  defaults,
  timezones,
}: {
  action: Action;
  defaults: { displayName: string; contactEmail: string; contactPhone: string; timezone: string };
  timezones: readonly { id: string; label: string }[];
}) {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-5 sm:grid-cols-2"
    >
      <Field
        id="displayName"
        label={t('displayName')}
        error={err('displayName')}
        required
        className="sm:col-span-2"
      >
        <Input
          {...controlProps('displayName', err('displayName'))}
          name="displayName"
          defaultValue={defaults.displayName}
          maxLength={80}
          required
        />
      </Field>
      <Field id="contactPhone" label={t('contactPhone')} error={err('contactPhone')}>
        <Input
          {...controlProps('contactPhone', err('contactPhone'))}
          name="contactPhone"
          type="tel"
          inputMode="tel"
          defaultValue={defaults.contactPhone}
        />
      </Field>
      <Field id="contactEmail" label={t('contactEmail')} error={err('contactEmail')}>
        <Input
          {...controlProps('contactEmail', err('contactEmail'))}
          name="contactEmail"
          type="email"
          defaultValue={defaults.contactEmail}
        />
      </Field>
      <Field id="timezone" label={t('timezone')} error={err('timezone')} className="sm:col-span-2">
        <NativeSelect
          {...controlProps('timezone', err('timezone'))}
          name="timezone"
          defaultValue={defaults.timezone}
        >
          {timezones.map((tz) => (
            <option key={tz.id} value={tz.id}>
              {tz.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{tc('saveChanges')}</SubmitButton>
      </div>
    </form>
  );
}

export function LegalForm({
  action,
  defaults,
  readOnly,
}: {
  action: Action;
  defaults: { legalName: string; taxId: string };
  readOnly: boolean;
}) {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-5 sm:grid-cols-2"
    >
      <fieldset disabled={readOnly} className="contents">
        <Field id="legalName" label={t('legalName')} error={err('legalName')}>
          <Input
            {...controlProps('legalName', err('legalName'))}
            name="legalName"
            defaultValue={defaults.legalName}
            maxLength={160}
          />
        </Field>
        <Field id="taxId" label={t('taxId')} error={err('taxId')}>
          <Input
            {...controlProps('taxId', err('taxId'))}
            name="taxId"
            defaultValue={defaults.taxId}
            maxLength={13}
            className="uppercase"
          />
        </Field>
        {readOnly ? null : (
          <div className="sm:col-span-2">
            <SubmitButton>{tc('saveChanges')}</SubmitButton>
          </div>
        )}
      </fieldset>
    </form>
  );
}

export function LocationForm({
  action,
  defaults,
  regions,
}: {
  action: Action;
  defaults: {
    addressLine1: string;
    addressLine2: string;
    neighborhood: string;
    city: string;
    region: string;
    postalCode: string;
    phone: string;
    deliveryRadiusKm: string;
  };
  regions: readonly { code: string; name: string }[];
}) {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-5 sm:grid-cols-6"
    >
      <Field
        id="addressLine1"
        label={t('addressLine1')}
        error={err('addressLine1')}
        required
        className="sm:col-span-4"
      >
        <Input
          {...controlProps('addressLine1', err('addressLine1'))}
          name="addressLine1"
          defaultValue={defaults.addressLine1}
          required
        />
      </Field>
      <Field
        id="addressLine2"
        label={t('addressLine2')}
        error={err('addressLine2')}
        className="sm:col-span-2"
      >
        <Input
          {...controlProps('addressLine2', err('addressLine2'))}
          name="addressLine2"
          defaultValue={defaults.addressLine2}
        />
      </Field>
      <Field
        id="neighborhood"
        label={t('neighborhood')}
        error={err('neighborhood')}
        className="sm:col-span-3"
      >
        <Input
          {...controlProps('neighborhood', err('neighborhood'))}
          name="neighborhood"
          defaultValue={defaults.neighborhood}
        />
      </Field>
      <Field
        id="postalCode"
        label={t('postalCode')}
        error={err('postalCode')}
        required
        className="sm:col-span-3"
      >
        <Input
          {...controlProps('postalCode', err('postalCode'))}
          name="postalCode"
          inputMode="numeric"
          maxLength={5}
          defaultValue={defaults.postalCode}
          required
        />
      </Field>
      <Field id="city" label={t('city')} error={err('city')} required className="sm:col-span-3">
        <Input
          {...controlProps('city', err('city'))}
          name="city"
          defaultValue={defaults.city}
          required
        />
      </Field>
      <Field
        id="region"
        label={t('region')}
        error={err('region')}
        required
        className="sm:col-span-3"
      >
        <NativeSelect
          {...controlProps('region', err('region'))}
          name="region"
          defaultValue={defaults.region}
        >
          {regions.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="phone" label={t('contactPhone')} error={err('phone')} className="sm:col-span-3">
        <Input
          {...controlProps('phone', err('phone'))}
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={defaults.phone}
        />
      </Field>
      <Field
        id="deliveryRadiusKm"
        label={t('deliveryRadiusKm')}
        error={err('deliveryRadiusKm')}
        className="sm:col-span-3"
      >
        <Input
          {...controlProps('deliveryRadiusKm', err('deliveryRadiusKm'))}
          name="deliveryRadiusKm"
          type="number"
          inputMode="numeric"
          min={0}
          max={200}
          defaultValue={defaults.deliveryRadiusKm}
        />
      </Field>
      <div className="sm:col-span-6">
        <SubmitButton>{tc('saveChanges')}</SubmitButton>
      </div>
    </form>
  );
}
