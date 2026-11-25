'use client';

import { NativeSelect } from '@/components/ui/input';

/** L'ordine della vetrina: cambiandolo, il modulo di ricerca (GET) si invia da solo. */
export function StorefrontSort({
  id,
  label,
  value,
  options,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}) {
  return (
    <NativeSelect
      id={id}
      name="orden"
      aria-label={label}
      defaultValue={value}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}
