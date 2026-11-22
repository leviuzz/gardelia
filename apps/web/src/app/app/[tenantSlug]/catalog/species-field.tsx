'use client';

import { Sparkles, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { resolveLocale, searchSpecies, type SpeciesOption } from '@floral/domain';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Campo "Specie" con ricerca (ADR-043): si scrive il nome del fiore nella lingua dell'interfaccia
 * (o il nome scientifico) e si sceglie dall'elenco. Combobox ARIA con elenco a comparsa; il valore
 * parte nel campo nascosto `canonicalFlowerId`.
 *
 * Se la persona non ha scelto, vale la specie suggerita dal nome del prodotto (`suggestion`),
 * dichiarata sotto il campo. Una scelta esplicita, anche "nessuna specie", non viene più toccata.
 */
export function SpeciesField({
  id,
  options,
  defaultValue,
  suggestion,
  describedBy,
  invalid,
}: {
  id: string;
  /** Specie della categoria del prodotto. */
  options: readonly SpeciesOption[];
  defaultValue: string;
  suggestion: SpeciesOption | null;
  describedBy: string | undefined;
  invalid: boolean;
}) {
  const t = useTranslations('catalog.form');
  const locale = resolveLocale(useLocale());
  const listId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  // null = nessuna scelta esplicita: vale il suggerimento. Un valore già salvato conta come scelta.
  const [chosen, setChosen] = useState<string | null>(defaultValue || null);
  // null = nel campo si vede il nome della specie scelta; stringa = la persona sta cercando.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selectedId = chosen ?? suggestion?.id ?? '';
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const suggested = chosen === null && selected !== null;
  const matches = useMemo(
    () => searchSpecies(query ?? '', options, locale),
    [query, options, locale],
  );
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));
  const optionId = (index: number) => `${listId}-option-${index}`;

  function openList() {
    if (!open && window.matchMedia('(max-width: 639px)').matches) {
      // Sul telefono il campo sale sotto l'intestazione: elenco e tastiera hanno spazio, e la
      // barra di navigazione in basso non lo copre.
      wrapper.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    setOpen(true);
  }

  function choose(option: SpeciesOption | null) {
    setChosen(option?.id ?? '');
    setQuery(null);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + matches.length) % Math.max(matches.length, 1));
    } else if (event.key === 'Enter' && open) {
      // Invio sceglie la specie evidenziata, non invia il modulo.
      event.preventDefault();
      const match = matches[activeIndex];
      if (match) choose(match.option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setQuery(null);
      setOpen(false);
    }
  }

  return (
    <div ref={wrapper} className="grid scroll-mt-32 gap-1.5">
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches.length > 0 ? optionId(activeIndex) : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('canonicalPlaceholder')}
          value={query ?? selected?.name ?? ''}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            openList();
          }}
          onFocus={openList}
          onClick={openList}
          onBlur={() => {
            // Campo svuotato e lasciato: nessuna specie (scelta esplicita).
            if (query !== null && query.trim() === '') setChosen('');
            setQuery(null);
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
          className={selected ? 'pr-10' : undefined}
        />
        {selected ? (
          <button
            type="button"
            aria-label={t('canonicalClear')}
            title={t('canonicalClear')}
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(null)}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <ul
          id={listId}
          role="listbox"
          aria-label={t('canonical')}
          hidden={!open}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {!open ? null : matches.length === 0 ? (
            <li role="presentation" className="px-2.5 py-2 text-sm text-muted-foreground">
              {t('canonicalNoResults', { query: query ?? '' })}
            </li>
          ) : (
            matches.map((match, index) => (
              <li
                key={match.option.id}
                id={optionId(index)}
                role="option"
                aria-selected={match.option.id === selectedId}
                className={cn(
                  'flex cursor-pointer flex-col rounded-lg px-2.5 py-2 text-sm',
                  index === activeIndex && 'bg-muted',
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(match.option)}
              >
                <span className="font-medium">
                  {match.option.name}
                  {match.matchedTerm ? (
                    <span className="font-normal text-muted-foreground">
                      {' · '}
                      {t('canonicalAlso', { term: match.matchedTerm })}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground italic">
                  {match.option.scientificName}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
      {suggested ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
          {t('canonicalSuggested')}
        </p>
      ) : null}
      <input type="hidden" name="canonicalFlowerId" value={selectedId} />
    </div>
  );
}
