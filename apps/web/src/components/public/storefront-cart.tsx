'use client';

import { Check, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { addToCart } from '@floral/domain';
import { Button } from '@/components/ui/button';
import { readCartInBrowser, writeCartInBrowser } from '@/lib/storefront-cart';

/**
 * Mette un prodotto nel carrello della fioreria (cookie) e chiede al server la pagina aggiornata,
 * così la barra «Tu pedido» mostra il subtotale ai prezzi di oggi. Con 20 prodotti diversi un
 * prodotto nuovo non entra e chi compra lo sa.
 */
export function useStoreCart(slug: string) {
  const router = useRouter();
  const t = useTranslations('publicStore');
  const [pending, startTransition] = useTransition();
  const add = (itemId: string, quantity = 1): boolean => {
    const result = addToCart(readCartInBrowser(), itemId, quantity);
    if (result.full) {
      toast.error(t('cartFull'));
      return false;
    }
    writeCartInBrowser(slug, result.lines);
    startTransition(() => router.refresh());
    return true;
  };
  return { add, pending };
}

/** «Agregar» nella scheda di un prodotto della vetrina. */
export function AddToCartButton({
  slug,
  itemId,
  name,
}: {
  readonly slug: string;
  readonly itemId: string;
  readonly name: string;
}) {
  const t = useTranslations('publicStore');
  const { add, pending } = useStoreCart(slug);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="w-full"
      disabled={pending}
      aria-label={t('addAria', { name })}
      onClick={() => {
        if (add(itemId)) toast.success(t('added'));
      }}
    >
      {pending ? <Check /> : <Plus />}
      {t('add')}
    </Button>
  );
}
