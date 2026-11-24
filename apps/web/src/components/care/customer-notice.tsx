'use client';

import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * "Sí, avisé al cliente" (decisione del founder del 24/11/2026): ogni cambio che tocca visite già
 * fissate si salva solo con questa casella. Il server la ricontrolla sempre; qui la si mostra
 * quando il cambio tocca qualcuno (`hint` dice chi o quante visite).
 */
export function CustomerNoticeCheckbox({
  id,
  error,
  hint,
  className,
}: {
  readonly id: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly className?: string;
}) {
  const t = useTranslations('care.notice');
  return (
    <div className={cn('grid gap-1.5 rounded-xl border bg-warning-soft/60 p-3', className)}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm font-medium">
        <Checkbox
          id={id}
          name="customerNotified"
          value="on"
          className="mt-0.5"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        />
        <span>{t('label')}</span>
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="pl-7 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="pl-7 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
