import { useTranslations } from 'next-intl';
import { Field, controlProps } from '@/components/form/field';
import { Input } from '@/components/ui/input';

/**
 * Razón social e RFC (fioreria e clienti). L'RFC si scrive in maiuscolo; il server lo
 * normalizza e lo valida. Niente autocompletamento: per un cliente il browser proporrebbe i dati
 * di chi scrive.
 */
export function LegalFields({
  defaults,
  error,
  taxIdHint,
}: {
  readonly defaults?: { readonly legalName?: string | null; readonly taxId?: string | null };
  readonly error: (name: string) => string | undefined;
  readonly taxIdHint?: string;
}) {
  const t = useTranslations('onboarding');
  return (
    <>
      <Field id="legalName" label={t('legalName')} error={error('legalName')}>
        <Input
          {...controlProps('legalName', error('legalName'))}
          name="legalName"
          defaultValue={defaults?.legalName ?? undefined}
          maxLength={160}
        />
      </Field>
      <Field id="taxId" label={t('taxId')} hint={taxIdHint} error={error('taxId')}>
        <Input
          {...controlProps('taxId', error('taxId'), Boolean(taxIdHint))}
          name="taxId"
          defaultValue={defaults?.taxId ?? undefined}
          maxLength={13}
          className="uppercase"
          autoCapitalize="characters"
        />
      </Field>
    </>
  );
}
