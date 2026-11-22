import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Campo di ricerca con la lente: parametro `q` di un form GET (elenchi, scelta del cliente). */
export function SearchInput({
  defaultValue,
  placeholder,
  label,
  className,
}: {
  readonly defaultValue?: string;
  readonly placeholder: string;
  /** Nome accessibile del campo (il segnaposto sparisce quando si scrive). */
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9"
      />
    </div>
  );
}
