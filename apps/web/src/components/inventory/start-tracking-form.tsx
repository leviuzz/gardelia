'use client';

import { PackagePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Una riga di "Elegir productos", con le etichette già tradotte dalla pagina. */
export interface StartRowView {
  readonly catalogItemId: string;
  readonly name: string;
  /** Tipo e varietà ("Flor de corte · Freedom"). */
  readonly detail: string;
  /** Unità al plurale per l'etichetta della quantità ("tallos"). */
  readonly unitLabel: string;
  /** "La última vez tenías…" per i prodotti che si controllavano prima. */
  readonly previous: string | null;
  readonly photoSrc: string | null;
}

/**
 * Un solo form per tutti i prodotti: si cominciano a controllare quelli con la quantità scritta.
 * I campi restano compilati se il server trova un errore (React 19, ADR-017).
 */
export function StartTrackingForm({
  action,
  rows,
}: {
  readonly action: Action;
  readonly rows: readonly StartRowView[];
}) {
  const t = useTranslations('inventory.start');
  const [state, formAction] = useToastActionState(action);
  const noneSelected = fieldError(state, 'rows');
  return (
    <form action={formAction} onSubmit={preserveOnSubmit(formAction)} className="space-y-4">
      {noneSelected ? (
        <Alert variant="destructive">
          <AlertDescription>{noneSelected}</AlertDescription>
        </Alert>
      ) : null}
      <ul className="divide-y rounded-2xl border bg-card">
        {rows.map((row, index) => {
          const quantityId = `start-${index}-quantity`;
          const minimumId = `start-${index}-minimum`;
          const quantityError = fieldError(state, `rows.${index}.quantity`);
          const minimumError = fieldError(state, `rows.${index}.minQuantity`);
          return (
            <li
              key={row.catalogItemId}
              className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-start"
            >
              <input type="hidden" name={`rows.${index}.catalogItemId`} value={row.catalogItemId} />
              <div className="flex min-w-0 items-center gap-3 sm:pt-6">
                {row.photoSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- foto privata del catalogo
                  <img
                    src={row.photoSrc}
                    alt=""
                    loading="lazy"
                    className="size-11 shrink-0 rounded-lg border object-cover"
                  />
                ) : (
                  <span aria-hidden="true" className="size-11 shrink-0 rounded-lg bg-muted" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.detail}</p>
                  {row.previous ? (
                    <p className="text-xs text-muted-foreground">{row.previous}</p>
                  ) : null}
                </div>
              </div>
              <Field
                id={quantityId}
                label={t('quantity', { unit: row.unitLabel })}
                error={quantityError}
              >
                <Input
                  {...controlProps(quantityId, quantityError)}
                  name={`rows.${index}.quantity`}
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
              <Field id={minimumId} label={t('minimum')} error={minimumError}>
                <Input
                  {...controlProps(minimumId, minimumError)}
                  name={`rows.${index}.minQuantity`}
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t('minimumHint')}</p>
      <p className="text-xs text-muted-foreground">{t('costNote')}</p>
      <SubmitButton icon={<PackagePlus />} className="w-full sm:w-auto">
        {t('submit')}
      </SubmitButton>
    </form>
  );
}
