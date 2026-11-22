import { useTranslations } from 'next-intl';
import { Field, controlProps } from '@/components/form/field';
import { Input, NativeSelect } from '@/components/ui/input';

/**
 * Nome, contatti e fuso orario della fioreria: uguali nell'onboarding e nelle impostazioni, in
 * una griglia da 2 colonne.
 */
export function ShopProfileFields({
  defaults,
  error,
  timezones,
  displayNameHint,
}: {
  readonly defaults?: {
    readonly displayName?: string;
    readonly contactPhone?: string;
    readonly contactEmail?: string;
    readonly timezone?: string;
  };
  readonly error: (name: string) => string | undefined;
  readonly timezones: readonly { readonly id: string; readonly label: string }[];
  readonly displayNameHint?: string;
}) {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  return (
    <>
      <Field
        id="displayName"
        label={t('displayName')}
        hint={displayNameHint}
        error={error('displayName')}
        required
        className="sm:col-span-2"
      >
        <Input
          {...controlProps('displayName', error('displayName'), Boolean(displayNameHint))}
          name="displayName"
          defaultValue={defaults?.displayName}
          autoComplete="organization"
          maxLength={80}
          required
        />
      </Field>
      <Field id="contactPhone" label={t('contactPhone')} error={error('contactPhone')}>
        <Input
          {...controlProps('contactPhone', error('contactPhone'))}
          name="contactPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={tCommon('phonePlaceholder')}
          defaultValue={defaults?.contactPhone}
        />
      </Field>
      <Field id="contactEmail" label={t('contactEmail')} error={error('contactEmail')}>
        <Input
          {...controlProps('contactEmail', error('contactEmail'))}
          name="contactEmail"
          type="email"
          autoComplete="email"
          defaultValue={defaults?.contactEmail}
        />
      </Field>
      <Field
        id="timezone"
        label={t('timezone')}
        error={error('timezone')}
        className="sm:col-span-2"
      >
        <NativeSelect
          {...controlProps('timezone', error('timezone'))}
          name="timezone"
          defaultValue={defaults?.timezone ?? 'America/Mexico_City'}
        >
          {timezones.map((tz) => (
            <option key={tz.id} value={tz.id}>
              {tz.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </>
  );
}
