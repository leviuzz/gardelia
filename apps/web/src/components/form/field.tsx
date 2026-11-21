import type * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps {
  readonly id: string;
  readonly label: React.ReactNode;
  readonly error?: string | undefined;
  readonly hint?: React.ReactNode;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/** Etichetta + controllo + errore/suggerimento, con collegamenti ARIA coerenti. */
export function Field({ id, label, error, hint, required, className, children }: FieldProps) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Attributi ARIA per il controllo associato a un Field. */
export function controlProps(id: string, error?: string, hasHint = false) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
  } as const;
}
