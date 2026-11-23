'use client';

import { LoaderCircle, MapPin, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { PLACES_LIMITS } from '@floral/domain';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Ricerca dell'indirizzo con Google Places (ADR-059). Il browser parla solo con la nostra app
 * (`/api/places/*`); la chiave di Google resta sul server. Senza chiave il campo non c'è e gli
 * indirizzi si scrivono a mano.
 */
interface PlacesConfig {
  readonly enabled: boolean;
  /** Coordinate della fioreria, per preferire gli indirizzi vicini. */
  readonly near: { readonly latitude: number; readonly longitude: number } | null;
}

const PlacesContext = createContext<PlacesConfig>({ enabled: false, near: null });

export function PlacesConfigProvider({
  enabled,
  near,
  children,
}: PlacesConfig & { readonly children: React.ReactNode }) {
  return <PlacesContext.Provider value={{ enabled, near }}>{children}</PlacesContext.Provider>;
}

export function usePlacesConfig(): PlacesConfig {
  return useContext(PlacesContext);
}

interface Suggestion {
  readonly placeId: string;
  readonly mainText: string;
  readonly secondaryText: string | null;
}

export interface FoundAddress {
  readonly placeId: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly neighborhood: string | null;
  readonly postalCode: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly coordinates: { readonly latitude: number; readonly longitude: number } | null;
}

function newSessionToken(): string {
  return crypto.randomUUID();
}

async function post<T>(path: string, body: unknown): Promise<T | 'unavailable'> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return 'unavailable';
    return (await response.json()) as T;
  } catch {
    return 'unavailable';
  }
}

/** Campo "Buscar dirección" con l'elenco dei suggerimenti (combobox accessibile da tastiera). */
export function AddressSearch({
  id,
  onFound,
}: {
  readonly id: string;
  readonly onFound: (address: FoundAddress) => void;
}) {
  const t = useTranslations('places');
  const { near } = usePlacesConfig();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const session = useRef(newSessionToken());
  const latest = useRef(0);
  // Testo del suggerimento appena scelto: non va ricercato di nuovo (riaprirebbe l'elenco).
  const chosen = useRef<string | null>(null);

  // Suggerimenti dopo una breve pausa nella scrittura (meno richieste, meno costi).
  useEffect(() => {
    const input = query.trim();
    if (input.length < PLACES_LIMITS.inputMin || query === chosen.current) return;
    const request = ++latest.current;
    async function load() {
      setBusy(true);
      const result = await post<{ suggestions: Suggestion[] }>('/api/places/autocomplete', {
        input,
        sessionToken: session.current,
        nearLatitude: near?.latitude,
        nearLongitude: near?.longitude,
      });
      if (request !== latest.current) return;
      setBusy(false);
      if (result === 'unavailable') {
        setSuggestions([]);
        setMessage(t('unavailable'));
        return;
      }
      setMessage(result.suggestions.length === 0 ? t('noResults') : null);
      setSuggestions(result.suggestions);
      setActive(-1);
      setOpen(true);
    }
    const timer = setTimeout(() => void load(), 350);
    return () => clearTimeout(timer);
  }, [query, near, t]);

  function onInput(value: string) {
    setQuery(value);
    setMessage(null);
    chosen.current = null;
    if (value.trim().length < PLACES_LIMITS.inputMin) {
      // Testo troppo corto: niente elenco, e le risposte ancora in viaggio non contano più.
      latest.current += 1;
      setSuggestions([]);
      setBusy(false);
    }
  }

  async function choose(suggestion: Suggestion) {
    // I suggerimenti ancora in viaggio non devono riaprire l'elenco.
    latest.current += 1;
    setOpen(false);
    setBusy(true);
    const result = await post<{ details: FoundAddress }>('/api/places/details', {
      placeId: suggestion.placeId,
      sessionToken: session.current,
    });
    setBusy(false);
    // La sessione finisce con i dettagli: la prossima ricerca ne usa una nuova.
    session.current = newSessionToken();
    if (result === 'unavailable') {
      setMessage(t('unavailable'));
      return;
    }
    chosen.current = suggestion.mainText;
    setQuery(suggestion.mainText);
    setSuggestions([]);
    setMessage(t('found'));
    onFound(result.details);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      // Invio sceglie il suggerimento, non invia il form.
      event.preventDefault();
      const chosen = suggestions[active];
      if (chosen) void choose(chosen);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const expanded = open && suggestions.length > 0;
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t('label')}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={query}
          placeholder={t('placeholder')}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          className="pl-9"
        />
        {busy ? (
          <LoaderCircle
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
        {expanded ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={t('suggestions')}
            className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-xl border bg-popover shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.placeId}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // mousedown: arriva prima del blur del campo, che chiuderebbe l'elenco.
                onMouseDown={(event) => {
                  event.preventDefault();
                  void choose(suggestion);
                }}
                className={cn(
                  'flex cursor-pointer items-start gap-2 px-3 py-2 text-sm',
                  index === active ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <MapPin
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{suggestion.mainText}</span>
                  {suggestion.secondaryText ? (
                    <span className="block truncate text-muted-foreground">
                      {suggestion.secondaryText}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
            {/* Attribuzione richiesta da Google per i suggerimenti mostrati senza una sua mappa. */}
            <li
              role="presentation"
              className="border-t px-3 py-1.5 text-right text-xs text-muted-foreground"
            >
              Google Maps
            </li>
          </ul>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {message ?? t('hint')}
      </p>
    </div>
  );
}
