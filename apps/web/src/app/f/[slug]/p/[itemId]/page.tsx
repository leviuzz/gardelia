import { ArrowLeft, Flower2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BRAND } from '@floral/domain';
import { ProductView } from '@/components/public/storefront-view';
import { StoreShell } from '@/components/public/store-shell';
import { Button } from '@/components/ui/button';
import { serverEnv } from '@/lib/env';
import { publicPageIndexing } from '@/lib/indexing';
import { loadPublicStore, loadStoreItem, storeShellProps } from '@/lib/public-store';
import { publicStoreLinks, publicStoreRoutes } from '@/lib/routes';

export async function generateMetadata({
  params,
}: PageProps<'/f/[slug]/p/[itemId]'>): Promise<Metadata> {
  const { slug, itemId } = await params;
  const detail = await loadStoreItem(slug, itemId);
  if (!detail) return { title: BRAND.productName };
  const { store, item } = detail;
  const routes = publicStoreRoutes(store.slug);
  // Anteprima su WhatsApp con la foto del prodotto: la miniatura, leggera.
  const image = item.photoId
    ? `${serverEnv().APP_URL.replace(/\/+$/, '')}${routes.photo(item.id, item.photoId, { thumb: true })}`
    : null;
  const env = serverEnv();
  return {
    title: `${item.name} · ${store.name}`,
    description: item.description ?? undefined,
    ...publicPageIndexing({
      enabled: env.PUBLIC_INDEXING === 'on',
      appUrl: env.APP_URL,
      canonicalPath: routes.item(item.id),
      indexable: true,
    }),
    openGraph: {
      title: `${item.name} · ${store.name}`,
      description: item.description ?? undefined,
      ...(image ? { images: [image] } : {}),
    },
  };
}

/**
 * Un prodotto della pagina pubblica (ADR-065; M1, ADR-087). La vista è condivisa con l'anteprima
 * della fioreria (`ProductView`).
 */
export default async function PublicStoreItemPage({ params }: PageProps<'/f/[slug]/p/[itemId]'>) {
  const { slug, itemId } = await params;
  const detail = await loadStoreItem(slug, itemId);
  if (!detail) return <ItemGone slug={slug} />;
  return <ProductView detail={detail} links={publicStoreLinks(detail.store.slug)} />;
}

/**
 * Prodotto tolto dalla vetrina (o mai esistito) in una tienda che c'è ancora: lo si dice e si torna
 * ai prodotti (M0). Se la tienda non c'è, la pagina «Esta tienda no está disponible».
 */
async function ItemGone({ slug }: { readonly slug: string }) {
  const store = await loadPublicStore(slug);
  if (!store) notFound();
  const t = await getTranslations({ locale: store.locale, namespace: 'publicStore' });
  const shell = await storeShellProps(store, t('whatsappHello'));
  return (
    <StoreShell {...shell}>
      <div
        className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center"
        data-testid="item-gone"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
          <Flower2 className="size-6" aria-hidden="true" />
        </span>
        <h1 className="font-display text-2xl font-semibold">{t('itemGoneTitle')}</h1>
        <p className="text-muted-foreground">{t('itemGoneBody')}</p>
        <Button asChild>
          <Link href={publicStoreRoutes(store.slug).home}>
            <ArrowLeft aria-hidden="true" />
            {t('itemGoneBack', { shop: store.name })}
          </Link>
        </Button>
      </div>
    </StoreShell>
  );
}
