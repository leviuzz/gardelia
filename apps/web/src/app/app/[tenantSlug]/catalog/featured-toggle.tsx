'use client';

import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOptimistic } from 'react';
import type { ActionState } from '@/lib/action-state';
import { useToastActionState } from '@/lib/use-action-toast';
import { cn } from '@/lib/utils';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Stella «In evidenza» di un prodotto online nell'elenco del catalogo (M1): mette il prodotto nella
 * riga «Destacados» della vetrina (al massimo 8). Cambia subito e torna com'era se il server
 * rifiuta (es. il nono prodotto).
 */
export function FeaturedToggle({
  action,
  featured,
  name,
}: {
  readonly action: Action;
  readonly featured: boolean;
  readonly name: string;
}) {
  const t = useTranslations('catalog');
  const [on, setOn] = useOptimistic(featured);
  const [, formAction, pending] = useToastActionState(action);
  return (
    <form
      action={(formData) => {
        setOn(formData.get('featured') === 'on');
        formAction(formData);
      }}
    >
      <button
        type="submit"
        name="featured"
        value={on ? 'off' : 'on'}
        aria-pressed={on}
        aria-label={t('featuredToggle', { name })}
        disabled={pending}
        className={cn(
          // Area di tocco di 44 px attorno alla stella.
          'relative inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors outline-none before:absolute before:-inset-2 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60',
          on ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        <Star className={cn('size-5', on && 'fill-current')} aria-hidden="true" />
      </button>
    </form>
  );
}
