import { Flower2 } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BRAND } from '@floral/domain';

/** Tienda inesistente, non pubblicata o ritirata (ADR-065): nessun dettaglio sul perché. */
export default async function StoreNotFound() {
  const t = await getTranslations('publicStore');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
        <Flower2 className="size-6" aria-hidden="true" />
      </span>
      <h1 className="font-display text-2xl font-semibold">{t('notFoundTitle')}</h1>
      <p className="text-muted-foreground">{t('notFoundBody')}</p>
      <Link href="/" className="text-sm font-medium text-primary hover:underline">
        {BRAND.productName}
      </Link>
    </main>
  );
}
