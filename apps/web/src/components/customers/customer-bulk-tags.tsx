'use client';

import { Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { CUSTOMER_LIMITS } from '@floral/domain';
import { Field, controlProps } from '@/components/form/field';
import { SubmitButton } from '@/components/form/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/input';
import { fieldError, type ActionState } from '@/lib/action-state';
import { preserveOnSubmit } from '@/lib/preserve-on-submit';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

interface Selection {
  readonly selected: ReadonlySet<string>;
  readonly toggle: (customerId: string) => void;
}

const SelectionContext = createContext<Selection | null>(null);

/** Casella di una riga della lista: sceglie il cliente (solo dentro `CustomerBulkTags`). */
export function CustomerSelectBox({
  customerId,
  label,
}: {
  readonly customerId: string;
  /** "Seleccionar a …": il nome del cliente per chi usa un lettore di schermo. */
  readonly label: string;
}) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <label className="flex shrink-0 cursor-pointer items-center self-stretch py-3 pl-4">
      <Checkbox
        name="customerIds"
        value={customerId}
        checked={selection.selected.has(customerId)}
        onChange={() => selection.toggle(customerId)}
        aria-label={label}
        className="size-5"
      />
    </label>
  );
}

/**
 * Etichetta a più clienti (ADR-070): si scelgono i clienti nella lista, si scrive l'etichetta (con
 * i suggerimenti di quelle già usate) e si preme "Agregar" o "Quitar". Il server ricontrolla tutto;
 * dopo un salvataggio riuscito la scelta e l'etichetta si azzerano.
 */
export function CustomerBulkTags({
  action,
  customerIds,
  tags,
  children,
}: {
  readonly action: Action;
  /** I clienti di questa pagina della lista ("Seleccionar todos"). */
  readonly customerIds: readonly string[];
  /** Etichette già usate dalla fioreria: suggerimenti mentre si scrive. */
  readonly tags: readonly string[];
  /** La lista, con una `CustomerSelectBox` per riga. */
  readonly children: ReactNode;
}) {
  const t = useTranslations('customers.bulk');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [tag, setTag] = useState('');
  const [state, formAction] = useToastActionState(action, () => {
    setSelected(new Set());
    setTag('');
  });

  const count = customerIds.filter((id) => selected.has(id)).length;
  const allSelected = customerIds.length > 0 && count === customerIds.length;
  const errors = {
    tag: fieldError(state, 'tag'),
    customerIds: fieldError(state, 'customerIds'),
  };

  function toggle(customerId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }

  return (
    <SelectionContext value={{ selected, toggle }}>
      <form
        action={formAction}
        onSubmit={preserveOnSubmit(formAction)}
        aria-label={t('title')}
        className="space-y-3"
      >
        <div className="space-y-3 rounded-2xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium" aria-live="polite">
              {count === 0 ? t('noneSelected') : t('selected', { count })}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(allSelected ? new Set() : new Set(customerIds))}
            >
              {allSelected ? t('clearSelection') : t('selectPage')}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <Field id="bulk-tag" label={t('tag')} error={errors.tag}>
              <Input
                {...controlProps('bulk-tag', errors.tag)}
                name="tag"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                list="customer-tag-options"
                maxLength={CUSTOMER_LIMITS.tagLength}
                autoComplete="off"
                placeholder={t('tagPlaceholder')}
              />
            </Field>
            <SubmitButton name="mode" value="add" icon={<Tag />}>
              {t('add')}
            </SubmitButton>
            <SubmitButton name="mode" value="remove" variant="outline">
              {t('remove')}
            </SubmitButton>
          </div>
          <datalist id="customer-tag-options">
            {tags.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          {errors.customerIds ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.customerIds}
            </p>
          ) : null}
        </div>
        {children}
      </form>
    </SelectionContext>
  );
}
