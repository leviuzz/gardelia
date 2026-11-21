import type * as React from 'react';
import { cn } from '@/lib/utils';

const controlBase =
  'w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(controlBase, 'h-10 py-2', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlBase, 'min-h-24 py-2 leading-relaxed', className)}
      {...props}
    />
  );
}

/**
 * Select nativo stilizzato: su mobile apre il selettore del sistema operativo
 * (più usabile dal telefono) e funziona con FormData senza JavaScript.
 */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(controlBase, 'h-10 appearance-none py-2 pr-9', className)}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      >
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

export function Checkbox({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        'size-4 shrink-0 cursor-pointer rounded border-input accent-primary focus-visible:ring-[3px] focus-visible:ring-ring/30',
        className,
      )}
      {...props}
    />
  );
}
