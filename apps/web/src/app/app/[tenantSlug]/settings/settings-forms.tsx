'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { AddressFields } from '@/components/form/address-fields';
import { LegalFields } from '@/components/form/legal-fields';
import { ShopProfileFields } from '@/components/form/shop-profile-fields';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Input } from '@/components/ui/input';
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
      <ShopProfileFields defaults={defaults} error={err} timezones={timezones} />
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
        <LegalFields defaults={defaults} error={err} />
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
  onMap,
}: {
  action: Action;
  /** La sede ha la posizione di Google ancora valida (la trova chi cerca il proprio indirizzo). */
  onMap: boolean;
  defaults: {
    addressLine1: string;
    addressLine2: string;
    neighborhood: string;
    city: string;
    region: string;
    postalCode: string;
    phone: string;
    deliveryRadiusKm: string;
    placeId: string;
  };
  regions: readonly { code: string; name: string }[];
}) {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const tSettings = useTranslations('settings');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = (field: string) => fieldError(state, field);
  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-5 sm:grid-cols-6"
    >
      <AddressFields
        regions={regions}
        defaults={defaults}
        error={err}
        layout="wide"
        mapStatus={{
          onMap,
          onMapText: tSettings('locationOnMap'),
          offMapText: tSettings('locationOffMap'),
        }}
      />
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

export function BuilderSettingsForm({
  action,
  laborFee,
  currency,
}: {
  action: Action;
  laborFee: string;
  currency: string;
}) {
  const t = useTranslations('builder.settings');
  const tc = useTranslations('common');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(state);
  const err = fieldError(state, 'laborFee');
  return (
    <form
      action={formAction}
      onSubmit={preserveOnSubmit(formAction)}
      className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-start"
    >
      <Field id="laborFee" label={t('laborFee', { currency })} hint={t('laborFeeHint')} error={err}>
        <Input
          {...controlProps('laborFee', err, true)}
          name="laborFee"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={laborFee}
          placeholder="0"
        />
      </Field>
      <div className="sm:pt-7">
        <SubmitButton variant="secondary">{tc('save')}</SubmitButton>
      </div>
    </form>
  );
}
