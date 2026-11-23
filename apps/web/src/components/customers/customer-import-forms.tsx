'use client';

import { Columns3, FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CUSTOMER_IMPORT_FIELDS, type CustomerImportField } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Input, NativeSelect } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * "Subir archivo" (ADR-070): si sceglie il CSV e il server ne fa una bozza con anteprima. Il
 * controllo di dimensione e righe lo rifà il server.
 */
export function CustomerImportUploadForm({ action }: { readonly action: Action }) {
  const t = useTranslations('customers.import');
  const [state, formAction] = useToastActionState(action);
  const error = fieldError(state, 'file');
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="space-y-4">
      <Field id="import-file" label={t('fileLabel')} hint={t('fileHint')} error={error} required>
        <Input
          {...controlProps('import-file', error, true)}
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="h-auto py-2"
        />
      </Field>
      <SubmitButton icon={<FileUp />} pendingLabel={t('uploading')}>
        {t('upload')}
      </SubmitButton>
    </form>
  );
}

export interface ImportColumnView {
  readonly index: number;
  readonly header: string;
  readonly sample: string | null;
  readonly field: CustomerImportField | null;
}

/**
 * Colonne del file → dati del cliente: una select per colonna, già proposta dai nomi. Il nome è
 * obbligatorio e ogni dato si prende da una sola colonna (lo ricontrolla il server).
 */
export function CustomerImportMappingForm({
  action,
  columns,
  initialErrors,
}: {
  readonly action: Action;
  readonly columns: readonly ImportColumnView[];
  /** Errori delle colonne salvate (es. manca il nome), già tradotti. */
  readonly initialErrors: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('customers.import');
  const [state, formAction] = useToastActionState(action);
  const errors =
    state.status === 'error' && state.fieldErrors
      ? state.fieldErrors
      : state.status === 'success'
        ? {}
        : initialErrors;
  const formError = errors._form;

  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="space-y-4">
      <ul className="divide-y rounded-2xl border bg-card">
        {columns.map((column) => {
          const id = `import-column-${column.index}`;
          const error = errors[`column.${column.index}`];
          return (
            <li
              key={column.index}
              className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-center"
            >
              <div className="min-w-0">
                <label htmlFor={id} className="block font-medium break-words">
                  {column.header || t('unnamedColumn', { number: column.index + 1 })}
                </label>
                <p className="truncate text-sm text-muted-foreground">
                  {column.sample ? t('sample', { value: column.sample }) : t('emptyColumn')}
                </p>
              </div>
              <div className="space-y-1">
                <NativeSelect
                  {...controlProps(id, error)}
                  name={`column.${column.index}`}
                  defaultValue={column.field ?? ''}
                >
                  <option value="">{t('ignoreColumn')}</option>
                  {CUSTOMER_IMPORT_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {t(`fields.${field}`)}
                    </option>
                  ))}
                </NativeSelect>
                {error ? (
                  <p id={`${id}-error`} className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <SubmitButton variant="outline" icon={<Columns3 />}>
        {t('saveColumns')}
      </SubmitButton>
    </form>
  );
}
