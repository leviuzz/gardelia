import { Flower2, Star } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

/**
 * Un prodotto nella vetrina (M1): foto, nome, prezzo, disponibilità ed eventuale «Destacado»;
 * sotto, fuori dal link, il pulsante «Agregar» (se si può ordinare).
 */
export function ProductCard({
  href,
  name,
  photoSrc,
  price,
  availability,
  soldOut,
  featuredLabel,
  action,
}: {
  readonly href: string;
  readonly name: string;
  readonly photoSrc: string | null;
  readonly price: string;
  /** Testo della disponibilità quando non è «Disponible». */
  readonly availability: string | null;
  readonly soldOut: boolean;
  /** «Destacado» per un prodotto in evidenza mostrato nella griglia. */
  readonly featuredLabel: string | null;
  readonly action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow hover:shadow-md">
      <Link
        href={href}
        className="group block flex-1 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-muted">
          {photoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- foto servite dall'app, già ridotte.
            <img
              src={photoSrc}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform group-hover:scale-[1.02]"
            />
          ) : (
            <Flower2 className="size-10 text-muted-foreground" aria-hidden="true" />
          )}
          {featuredLabel ? (
            <Badge className="absolute top-2 left-2 gap-1 shadow-xs">
              <Star className="size-3" aria-hidden="true" />
              {featuredLabel}
            </Badge>
          ) : null}
        </div>
        <div className="space-y-1 p-3">
          <p className="line-clamp-2 text-sm font-medium">{name}</p>
          <p className="text-sm tabular-nums">{price}</p>
          {availability ? (
            <Badge variant={soldOut ? 'muted' : 'warning'}>{availability}</Badge>
          ) : null}
        </div>
      </Link>
      {action ? <div className="px-3 pb-3">{action}</div> : null}
    </div>
  );
}
