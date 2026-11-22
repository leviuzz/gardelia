import { COLOR_SWATCH_CLASS } from '@/lib/catalog-ui';
import { cn } from '@/lib/utils';
import type { CatalogColor } from '@floral/domain';

const SIZES = { xs: 'size-2.5', sm: 'size-3.5', md: 'size-6' } as const;

/**
 * Pallino del colore di un articolo (decorativo: il nome del colore è sempre scritto accanto o
 * nell'etichetta). Senza colore: grigio neutro.
 */
export function ColorSwatch({
  color,
  size = 'sm',
  className,
}: {
  readonly color: string | null;
  readonly size?: keyof typeof SIZES;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'shrink-0 rounded-full border border-black/10',
        SIZES[size],
        (color && COLOR_SWATCH_CLASS[color as CatalogColor]) || 'bg-muted',
        className,
      )}
    />
  );
}
