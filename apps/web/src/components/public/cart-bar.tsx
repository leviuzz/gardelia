import { ArrowRight, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Barra fissa in basso «Tu pedido · 3 piezas · $1,380 → Continuar» (M1): il carrello di chi guarda
 * ai prezzi di oggi, calcolato dal server. Lo spazio sotto il contenuto evita che la copra.
 */
export function CartBar({
  href,
  label,
  continueLabel,
}: {
  readonly href: string;
  readonly label: string;
  readonly continueLabel: string;
}) {
  return (
    <>
      <div className="h-20" aria-hidden="true" />
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_oklch(0.2_0.02_150/0.06)] backdrop-blur"
        data-testid="cart-bar"
      >
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <ShoppingBag className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 truncate tabular-nums">{label}</span>
          </p>
          <Button asChild size="sm" className="shrink-0">
            <Link href={href}>
              {continueLabel}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}
