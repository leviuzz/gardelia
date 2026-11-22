import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SearchInput } from './search-input';

/**
 * Ricerca e filtri di una pagina elenco (fase 0, componenti comuni). È un form GET: i filtri
 * finiscono nell'URL, quindi il link si può condividere e il tasto "indietro" funziona. I filtri
 * (select) sono i figli; "Limpiar filtros" compare solo se qualcosa è filtrato.
 */
export async function FilterBar({
  action,
  search,
  hasFilters,
  className,
  searchClassName,
  submitClassName,
  children,
}: {
  /** Percorso dell'elenco, senza query (`routes.x.list()`). */
  readonly action: string;
  readonly search: { readonly defaultValue?: string; readonly placeholder: string };
  readonly hasFilters: boolean;
  /** Colonne della griglia: cambiano con il numero di filtri. */
  readonly className: string;
  readonly searchClassName?: string;
  readonly submitClassName?: string;
  readonly children?: React.ReactNode;
}) {
  const t = await getTranslations('common');
  return (
    <form
      method="get"
      action={action}
      className={cn('grid gap-3 rounded-2xl border bg-card p-4', className)}
    >
      <SearchInput
        defaultValue={search.defaultValue}
        placeholder={search.placeholder}
        label={t('search')}
        className={searchClassName}
      />
      {children}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" className={cn('flex-1', submitClassName)}>
          {t('filter')}
        </Button>
        {hasFilters ? (
          <Button asChild variant="ghost">
            <Link href={action}>{t('clearFilters')}</Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
