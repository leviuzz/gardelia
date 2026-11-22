import { Search } from 'lucide-react';
import { EmptyState } from '@/components/page-header';

/**
 * Corpo di una pagina elenco. Se non c'è nulla da mostrare distingue due casi:
 *  - filtri attivi → "nessun risultato" (si cambiano i filtri);
 *  - elenco ancora vuoto → lo stato vuoto della pagina, con l'azione per iniziare.
 * Altrimenti il conteggio (annunciato agli screen reader quando cambia) e le righe.
 */
export function ListResults({
  isEmpty,
  hasFilters,
  noResults,
  empty,
  count,
  children,
}: {
  readonly isEmpty: boolean;
  readonly hasFilters: boolean;
  readonly noResults: {
    readonly title: string;
    readonly body?: string;
    /** Icona diversa dalla lente (es. elenco degli archiviati). */
    readonly icon?: React.ReactNode;
  };
  readonly empty: React.ReactNode;
  /** Testo del conteggio ("12 clientes"); senza, niente riga di conteggio. */
  readonly count?: string;
  readonly children: React.ReactNode;
}) {
  if (isEmpty) {
    return hasFilters ? (
      <EmptyState
        icon={noResults.icon ?? <Search />}
        title={noResults.title}
        body={noResults.body}
      />
    ) : (
      empty
    );
  }
  return (
    <>
      {count ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {count}
        </p>
      ) : null}
      {children}
    </>
  );
}
