import { cn } from '@/lib/utils';

/**
 * Vendite per giorno (mese) o per mese (anno): una sola serie, barre sottili nel colore principale
 * con l'estremità arrotondata, 2 px fra una barra e l'altra, nessuna legenda (il titolo la nomina).
 * Al passaggio del mouse ogni barra dice giorno e importo; chi usa un lettore di schermo ha la
 * tabella con gli stessi numeri.
 */
export function SalesChart({
  bars,
  caption,
  columnLabel,
  valueLabel,
}: {
  bars: readonly {
    readonly key: string;
    /** Etichetta breve sotto la barra (vuota = nessuna). */
    readonly tick: string;
    /** Etichetta completa per il tooltip e la tabella ("10 de mayo"). */
    readonly label: string;
    readonly totalMinor: number;
    /** Importo già scritto ("$1,250.00"). */
    readonly amount: string;
  }[];
  caption: string;
  columnLabel: string;
  valueLabel: string;
}) {
  const max = Math.max(...bars.map((bar) => bar.totalMinor), 0);
  return (
    <figure className="grid gap-2">
      <div className="flex h-44 items-end gap-[2px] border-b border-border" aria-hidden="true">
        {bars.map((bar) => {
          const height =
            max > 0 ? Math.max((bar.totalMinor / max) * 100, bar.totalMinor > 0 ? 2 : 0) : 0;
          return (
            <div
              key={bar.key}
              className="group relative flex h-full flex-1 items-end justify-center"
            >
              <div
                className={cn(
                  // Barre sottili anche quando sono poche (i 12 mesi dell'anno).
                  'w-full max-w-10 rounded-t-[4px] transition-opacity',
                  bar.totalMinor > 0 ? 'bg-primary group-hover:opacity-80' : 'bg-transparent',
                )}
                style={{ height: `${height}%` }}
              />
              {/* Tooltip: giorno e importo, sopra la barra. */}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-lg border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md group-hover:block">
                <span className="block text-muted-foreground">{bar.label}</span>
                <span className="font-medium tabular-nums">{bar.amount}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-[2px] text-[11px] text-muted-foreground" aria-hidden="true">
        {bars.map((bar) => (
          <span key={bar.key} className="flex-1 overflow-visible text-center whitespace-nowrap">
            {bar.tick}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{columnLabel}</th>
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {bars
            .filter((bar) => bar.totalMinor > 0)
            .map((bar) => (
              <tr key={bar.key}>
                <th scope="row">{bar.label}</th>
                <td>{bar.amount}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </figure>
  );
}
