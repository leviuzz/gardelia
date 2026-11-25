'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/action-state';
import { useToastActionState } from '@/lib/use-action-toast';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

interface Selection {
  readonly selected: ReadonlySet<string>;
  readonly toggle: (id: string, on: boolean) => void;
  readonly setMany: (ids: readonly string[], on: boolean) => void;
}

const SelectionContext = createContext<Selection | null>(null);

/**
 * Più prodotti insieme nel Catalogo (M1-2, ADR-087): le caselle delle righe (schede su telefono e
 * tabella su schermo largo condividono la stessa scelta) e la barra «Mostra nel negozio» / «Togli
 * dal negozio». La scelta vale per la pagina: cambiando pagina o filtro si ricomincia. Il server
 * ricontrolla permessi, tipi, stato e il limite dei 500.
 */
export function CatalogBulkSelection({
  action,
  children,
}: {
  readonly action: Action;
  readonly children: React.ReactNode;
}) {
  const t = useTranslations('catalog.bulk');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [, formAction, pending] = useToastActionState(action, () => setSelected(new Set()));
  const selection = useMemo<Selection>(
    () => ({
      selected,
      toggle: (id, on) =>
        setSelected((current) => {
          const next = new Set(current);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        }),
      setMany: (ids, on) =>
        setSelected((current) => {
          const next = new Set(current);
          for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
    }),
    [selected],
  );

  return (
    <SelectionContext.Provider value={selection}>
      {children}
      {selected.size > 0 ? (
        <form
          action={formAction}
          data-testid="catalog-bulk-bar"
          className="sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-lg md:bottom-4"
        >
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="itemId" value={id} />
          ))}
          <p className="text-sm font-medium" aria-live="polite">
            {t('selected', { count: selected.size })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="online" value="on" size="sm" disabled={pending}>
              <Eye />
              {t('show')}
            </Button>
            <Button
              type="submit"
              name="online"
              value="off"
              size="sm"
              variant="outline"
              disabled={pending}
            >
              <EyeOff />
              {t('hide')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setSelected(new Set())}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </SelectionContext.Provider>
  );
}

/** Casella di una riga, con l'area di tocco di 44 px. */
export function SelectItemCheckbox({ id, name }: { readonly id: string; readonly name: string }) {
  const t = useTranslations('catalog.bulk');
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <label className="-m-3 inline-flex cursor-pointer items-center justify-center p-3">
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-primary"
        checked={selection.selected.has(id)}
        onChange={(event) => selection.toggle(id, event.target.checked)}
        aria-label={t('selectItem', { name })}
      />
    </label>
  );
}

/** «Seleziona i prodotti di questa pagina»: piena, vuota o a metà. */
export function SelectPageCheckbox({ ids }: { readonly ids: readonly string[] }) {
  const t = useTranslations('catalog.bulk');
  const selection = useContext(SelectionContext);
  const ref = useRef<HTMLInputElement>(null);
  const chosen = selection ? ids.filter((id) => selection.selected.has(id)).length : 0;
  const all = ids.length > 0 && chosen === ids.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = chosen > 0 && !all;
  }, [chosen, all]);
  if (!selection || ids.length === 0) return null;
  return (
    <label className="-m-3 inline-flex cursor-pointer items-center justify-center p-3">
      <input
        ref={ref}
        type="checkbox"
        className="size-4 cursor-pointer accent-primary"
        checked={all}
        onChange={(event) => selection.setMany(ids, event.target.checked)}
        aria-label={t('selectPage')}
      />
    </label>
  );
}
