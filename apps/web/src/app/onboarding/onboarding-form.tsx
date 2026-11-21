'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Field, controlProps } from '@/components/form/field';
import { FormAlert } from '@/components/form/form-alert';
import { SubmitButton } from '@/components/form/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';

interface Props {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  timezones: readonly { id: string; label: string }[];
  regions: readonly { code: string; name: string }[];
  defaultContactEmail: string;
}

export function OnboardingForm({ action, timezones, regions, defaultContactEmail }: Props) {
  const t = useTranslations('onboarding');
  const [state, formAction] = useActionState(action, idleState);
  const err = (field: string) => fieldError(state, field);

  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="mt-8 space-y-6">
      <FormAlert state={state} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              1
            </span>
            {t('stepShop')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field
            id="displayName"
            label={t('displayName')}
            hint={t('displayNameHint')}
            error={err('displayName')}
            required
            className="sm:col-span-2"
          >
            <Input
              {...controlProps('displayName', err('displayName'), true)}
              name="displayName"
              autoComplete="organization"
              required
              maxLength={80}
            />
          </Field>
          <Field id="contactPhone" label={t('contactPhone')} error={err('contactPhone')}>
            <Input
              {...controlProps('contactPhone', err('contactPhone'))}
              name="contactPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="449 123 4567"
            />
          </Field>
          <Field id="contactEmail" label={t('contactEmail')} error={err('contactEmail')}>
            <Input
              {...controlProps('contactEmail', err('contactEmail'))}
              name="contactEmail"
              type="email"
              defaultValue={defaultContactEmail}
            />
          </Field>
          <Field
            id="timezone"
            label={t('timezone')}
            error={err('timezone')}
            className="sm:col-span-2"
          >
            <NativeSelect
              {...controlProps('timezone', err('timezone'))}
              name="timezone"
              defaultValue="America/Mexico_City"
            >
              {timezones.map((tz) => (
                <option key={tz.id} value={tz.id}>
                  {tz.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="legalName" label={t('legalName')} error={err('legalName')}>
            <Input
              {...controlProps('legalName', err('legalName'))}
              name="legalName"
              maxLength={160}
            />
          </Field>
          <Field id="taxId" label={t('taxId')} hint={t('taxIdHint')} error={err('taxId')}>
            <Input
              {...controlProps('taxId', err('taxId'), true)}
              name="taxId"
              maxLength={13}
              className="uppercase"
              autoCapitalize="characters"
            />
          </Field>
          <div className="grid gap-2 sm:col-span-2">
            <span className="text-sm font-medium">{t('country')}</span>
            <p className="rounded-lg border border-dashed bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {t('countryValue')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              2
            </span>
            {t('stepAddress')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-6">
          <Field
            id="addressLine1"
            label={t('addressLine1')}
            error={err('location.addressLine1')}
            required
            className="sm:col-span-4"
          >
            <Input
              {...controlProps('addressLine1', err('location.addressLine1'))}
              name="location.addressLine1"
              autoComplete="address-line1"
              required
            />
          </Field>
          <Field
            id="addressLine2"
            label={t('addressLine2')}
            error={err('location.addressLine2')}
            className="sm:col-span-2"
          >
            <Input
              {...controlProps('addressLine2', err('location.addressLine2'))}
              name="location.addressLine2"
              autoComplete="address-line2"
            />
          </Field>
          <Field
            id="neighborhood"
            label={t('neighborhood')}
            error={err('location.neighborhood')}
            className="sm:col-span-3"
          >
            <Input
              {...controlProps('neighborhood', err('location.neighborhood'))}
              name="location.neighborhood"
            />
          </Field>
          <Field
            id="postalCode"
            label={t('postalCode')}
            error={err('location.postalCode')}
            required
            className="sm:col-span-3"
          >
            <Input
              {...controlProps('postalCode', err('location.postalCode'))}
              name="location.postalCode"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              pattern="\d{5}"
              required
            />
          </Field>
          <Field
            id="city"
            label={t('city')}
            error={err('location.city')}
            required
            className="sm:col-span-3"
          >
            <Input
              {...controlProps('city', err('location.city'))}
              name="location.city"
              autoComplete="address-level2"
              required
            />
          </Field>
          <Field
            id="region"
            label={t('region')}
            error={err('location.region')}
            required
            className="sm:col-span-3"
          >
            <NativeSelect
              {...controlProps('region', err('location.region'))}
              name="location.region"
              defaultValue="AGU"
              required
            >
              {regions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="deliveryRadiusKm"
            label={t('deliveryRadiusKm')}
            hint={t('deliveryRadiusHint')}
            error={err('location.deliveryRadiusKm')}
            className="sm:col-span-3"
          >
            <Input
              {...controlProps('deliveryRadiusKm', err('location.deliveryRadiusKm'), true)}
              name="location.deliveryRadiusKm"
              type="number"
              inputMode="numeric"
              min={0}
              max={200}
            />
          </Field>
        </CardContent>
      </Card>

      <SubmitButton size="lg" className="w-full sm:w-auto" pendingLabel={t('submitting')}>
        {t('submit')}
      </SubmitButton>
    </form>
  );
}
