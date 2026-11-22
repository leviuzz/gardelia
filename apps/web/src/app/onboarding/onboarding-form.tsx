'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { AddressFields } from '@/components/form/address-fields';
import { LegalFields } from '@/components/form/legal-fields';
import { ShopProfileFields } from '@/components/form/shop-profile-fields';
import { Field, controlProps } from '@/components/form/field';
import { FormAlert } from '@/components/form/form-alert';
import { SubmitButton } from '@/components/form/submit-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
          <ShopProfileFields
            defaults={{ contactEmail: defaultContactEmail }}
            error={err}
            timezones={timezones}
            displayNameHint={t('displayNameHint')}
          />
          <LegalFields error={err} taxIdHint={t('taxIdHint')} />
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
          <AddressFields regions={regions} error={err} namePrefix="location." layout="wide" />
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
