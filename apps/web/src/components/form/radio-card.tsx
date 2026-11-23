'use client';

import { cn } from '@/lib/utils';

/** Scelta fra poche opzioni come schede cliccabili (modo di consegna, fascia, indirizzo). */
export function RadioCard({
  name,
  value,
  checked,
  onChange,
  children,
  className,
}: {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40',
        checked ? 'border-primary bg-secondary/70 font-medium' : 'hover:bg-muted',
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="size-4 shrink-0 accent-primary"
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}
