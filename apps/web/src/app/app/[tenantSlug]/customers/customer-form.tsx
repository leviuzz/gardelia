'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { ACQUISITION_CHANNELS, CUSTOMER_TYPES, type CustomerType } from '@floral/domain';
import { LegalFields } from '@/components/form/legal-fields';
import { Field, controlProps } from '@/components/form/field';
import { FormAlert } from '@/components/form/form-alert';
import { SubmitButton } from '@/components/form/submit-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useActionToast } from '@/lib/use-action-toast';
import { OccasionRowsField } from './occasion-rows-field';

export interface CustomerFormDefaults {
  readonly type: CustomerType;
  readonly displayName: string;
  readonly email: string;
  readonly phone: string;
  readonly legalName: string;
  readonly taxId: string;
  readonly notes: string;
  readonly preferences: string;
  readonly restrictions: string;
  readonly tags: string;
  readonly acquisitionChannel: string;
  readonly marketingConsent: boolean;
}

const EMPTY: CustomerFormDefaults = {
  type: 'PERSON',
  displayName: '',
  email: '',
  phone: '',
  legalName: '',
  taxId: '',
  notes: '',
  preferences: '',
  restrictions: '',
  tags: '',
  acquisitionChannel: '',
  marketingConsent: false,
};

export function CustomerForm({
  mode,
  action,
  defaults = EMPTY,
  consentNote,
}: {
  mode: 'create' | 'edit';
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: CustomerFormDefaults;
  consentNote?: string;
}) {
  const t = useTranslations('customers');
  const tCommon = useTranslations('common');
  const [state, formAction] = useActionState(action, idleState);
  useActionToast(mode === 'edit' ? state : idleState);
  const [type, setType] = useState<CustomerType>(defaults.type);
  const err = (field: string) => fieldError(state, field);

  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="space-y-6">
      {mode === 'create' || state.status === 'error' ? <FormAlert state={state} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('form.sectionContact')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field id="type" label={t('form.type')} error={err('type')}>
            <NativeSelect
              {...controlProps('type', err('type'))}
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value as CustomerType)}
            >
              {CUSTOMER_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`types.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="displayName"
            label={type === 'COMPANY' ? t('form.displayNameCompany') : t('form.displayName')}
            error={err('displayName')}
            required
          >
            <Input
              {...controlProps('displayName', err('displayName'))}
              name="displayName"
              defaultValue={defaults.displayName}
              maxLength={120}
              autoComplete="off"
              required
            />
          </Field>
          <Field id="phone" label={t('form.phone')} hint={t('form.phoneHint')} error={err('phone')}>
            <Input
              {...controlProps('phone', err('phone'), true)}
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={defaults.phone}
              placeholder={tCommon('phonePlaceholder')}
            />
          </Field>
          <Field id="email" label={t('form.email')} error={err('email')}>
            <Input
              {...controlProps('email', err('email'))}
              name="email"
              type="email"
              defaultValue={defaults.email}
            />
          </Field>
          <Field
            id="acquisitionChannel"
            label={t('form.channel')}
            error={err('acquisitionChannel')}
          >
            <NativeSelect
              {...controlProps('acquisitionChannel', err('acquisitionChannel'))}
              name="acquisitionChannel"
              defaultValue={defaults.acquisitionChannel}
            >
              <option value="">{t('form.channelNone')}</option>
              {ACQUISITION_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {t(`channels.${channel}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="tags" label={t('form.tags')} hint={t('form.tagsHint')} error={err('tags')}>
            <Input
              {...controlProps('tags', err('tags'), true)}
              name="tags"
              defaultValue={defaults.tags}
            />
          </Field>
          <div className="grid gap-1.5 sm:col-span-2">
            <label className="flex items-start gap-3 text-sm font-medium">
              <Checkbox
                name="marketingConsent"
                defaultChecked={defaults.marketingConsent}
                className="mt-0.5"
              />
              <span>
                {t('form.marketingConsent')}
                <span className="block text-xs font-normal text-muted-foreground">
                  {consentNote ?? t('form.marketingConsentHint')}
                </span>
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {mode === 'create' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('occasions.title')}</CardTitle>
            <CardDescription>{t('occasions.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <OccasionRowsField error={err} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('form.sectionPreferences')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Field id="preferences" label={t('form.preferences')} error={err('preferences')}>
            <Textarea
              {...controlProps('preferences', err('preferences'))}
              name="preferences"
              defaultValue={defaults.preferences}
              placeholder={t('form.preferencesPlaceholder')}
              rows={2}
              maxLength={1000}
            />
          </Field>
          <Field id="restrictions" label={t('form.restrictions')} error={err('restrictions')}>
            <Textarea
              {...controlProps('restrictions', err('restrictions'))}
              name="restrictions"
              defaultValue={defaults.restrictions}
              rows={2}
              maxLength={1000}
            />
          </Field>
          <Field id="notes" label={t('form.notes')} error={err('notes')}>
            <Textarea
              {...controlProps('notes', err('notes'))}
              name="notes"
              defaultValue={defaults.notes}
              rows={3}
              maxLength={2000}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('form.sectionFiscal')}</CardTitle>
          <CardDescription>{t('form.fiscalHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <LegalFields defaults={defaults} error={err} />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <SubmitButton
          size="lg"
          className="w-full sm:w-auto"
          pendingLabel={mode === 'create' ? t('form.creating') : undefined}
        >
          {mode === 'create' ? t('form.create') : t('form.save')}
        </SubmitButton>
      </div>
    </form>
  );
}
