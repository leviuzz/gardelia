'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface StepItem {
  readonly key: string;
  readonly label: string;
}

/**
 * Indicatore dei passi di una procedura guidata (nuovo prodotto, Diseñador): cerchi numerati,
 * passo corrente evidenziato, passi fatti con la spunta. Su telefono i nomi dei passi restano
 * solo per gli screen reader e sopra compare "Paso 2 de 5 · Colores".
 *
 * Con `onSelect` i passi fino a `reachable` diventano pulsanti (si torna indietro, o si salta
 * dove serve in un disegno già salvato); senza, l'indicatore è solo informativo.
 */
export function StepIndicator({
  steps,
  current,
  onSelect,
  reachable = current,
  className,
}: {
  steps: readonly StepItem[];
  current: number;
  onSelect?: (index: number) => void;
  /** Ultimo passo raggiungibile con un clic (indice). */
  reachable?: number;
  className?: string;
}) {
  const t = useTranslations('steps');
  const active = steps[current];
  return (
    <nav aria-label={t('label')} className={cn('space-y-2', className)}>
      <p className="text-sm text-muted-foreground sm:hidden" aria-hidden="true">
        {t('progress', { current: current + 1, total: steps.length })}
        {active ? <span className="font-medium text-foreground"> · {active.label}</span> : null}
      </p>
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {steps.map((step, index) => {
          const done = index < current;
          const isCurrent = index === current;
          const clickable = onSelect !== undefined && !isCurrent && index <= reachable;
          const content = (
            <>
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
                  isCurrent && 'border-primary bg-primary text-primary-foreground',
                  done && 'border-primary/40 bg-secondary text-foreground',
                  !isCurrent && !done && 'bg-card text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'hidden text-sm sm:inline',
                  isCurrent ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
              <span className="sr-only">
                {done ? t('completed', { label: step.label }) : step.label}
              </span>
            </>
          );
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  className="flex min-w-0 items-center gap-2 rounded-full pr-1 hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
                >
                  {content}
                </button>
              ) : (
                <span
                  className="flex min-w-0 items-center gap-2"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {content}
                </span>
              )}
              {index < steps.length - 1 ? (
                <span className="h-px min-w-3 flex-1 bg-border" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
