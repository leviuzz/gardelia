import { PrivateImage } from '@/components/common/private-image';

/** Righe e totali di un documento aperto dal cliente (link pubblici, ADR-056). Solo testi pronti. */
export interface PublicLineView {
  readonly id: string;
  readonly description: string;
  /** "12 × $35.00 por tallo". */
  readonly quantityLabel: string;
  readonly totalLabel: string;
  readonly recipe: string | null;
  readonly imageUrl: string | null;
  readonly imageAlt: string;
}

export function PublicLines({ lines }: { readonly lines: readonly PublicLineView[] }) {
  return (
    <ul className="divide-y">
      {lines.map((line) => (
        <li key={line.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
          {line.imageUrl ? (
            <PrivateImage
              src={line.imageUrl}
              alt={line.imageAlt}
              className="size-20 shrink-0 rounded-xl border bg-muted object-cover sm:size-28"
            />
          ) : null}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium break-words">{line.description}</p>
            <p className="text-sm text-muted-foreground tabular-nums">{line.quantityLabel}</p>
            {line.recipe ? <p className="text-sm text-muted-foreground">{line.recipe}</p> : null}
          </div>
          <p className="shrink-0 font-medium tabular-nums">{line.totalLabel}</p>
        </li>
      ))}
    </ul>
  );
}

export function PublicTotals({
  rows,
}: {
  readonly rows: readonly {
    readonly label: string;
    readonly value: string;
    readonly strong?: boolean;
  }[];
}) {
  return (
    <dl className="grid gap-2 border-t pt-4 text-sm">
      {rows.map((row) => (
        <div
          key={row.label}
          className={
            row.strong
              ? 'flex justify-between gap-4 text-base font-semibold'
              : 'flex justify-between gap-4'
          }
        >
          <dt className={row.strong ? undefined : 'text-muted-foreground'}>{row.label}</dt>
          <dd className="tabular-nums" data-testid={row.strong ? 'public-total' : undefined}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
