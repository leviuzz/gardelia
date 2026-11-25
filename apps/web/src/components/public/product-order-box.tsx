'use client';

import { Minus, Plus, ShoppingBag, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { MARKETPLACE_ORDER_LIMITS } from '@floral/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStoreCart } from './storefront-cart';

/**
 * Quantità, «Agregar al pedido» e «Pedir ahora» nella pagina del prodotto (M1): il carrello è il
 * cookie della fioreria; «Pedir ahora» lo aggiorna e apre il modulo d'ordine. Nell'anteprima della
 * fioreria (M1-2, `disabled`) si vede tutto ma niente si preme.
 */
export function ProductOrderBox({
  slug,
  itemId,
  name,
  checkoutHref,
  disabled = false,
}: {
  readonly slug: string;
  readonly itemId: string;
  readonly name: string;
  readonly checkoutHref: string;
  readonly disabled?: boolean;
}) {
  const t = useTranslations('publicStore');
  const router = useRouter();
  const { add, pending } = useStoreCart(slug);
  const [quantity, setQuantity] = useState(1);
  const max = MARKETPLACE_ORDER_LIMITS.quantityMax;
  const clamp = (value: number) => Math.min(Math.max(Math.trunc(value) || 1, 1), max);
  return (
    <div className="space-y-3" data-testid="product-order">
      <div className="flex items-center gap-2">
        <label htmlFor="product-quantity" className="text-sm font-medium">
          {t('quantity')}
        </label>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('quantityLess', { name })}
          disabled={disabled || quantity <= 1}
          onClick={() => setQuantity((value) => clamp(value - 1))}
        >
          <Minus />
        </Button>
        <Input
          id="product-quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          step={1}
          value={quantity}
          disabled={disabled}
          onChange={(event) => setQuantity(clamp(Number(event.target.value)))}
          className="w-16 text-center tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('quantityMore', { name })}
          disabled={disabled || quantity >= max}
          onClick={() => setQuantity((value) => clamp(value + 1))}
        >
          <Plus />
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          size="lg"
          disabled={disabled || pending}
          onClick={() => {
            if (add(itemId, quantity)) toast.success(t('added'));
          }}
        >
          <ShoppingBag />
          {t('addToOrder')}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={disabled || pending}
          onClick={() => {
            if (add(itemId, quantity)) router.push(checkoutHref);
          }}
        >
          <Zap />
          {t('orderNow')}
        </Button>
      </div>
    </div>
  );
}
