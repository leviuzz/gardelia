import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BRAND, storefrontFiltered } from '@floral/domain';
import { StorefrontView } from '@/components/public/storefront-view';
import { serverEnv } from '@/lib/env';
import { publicPageIndexing } from '@/lib/indexing';
import { loadStorefront, storefrontQueryKey } from '@/lib/public-store';
import { publicStoreLinks, publicStoreRoutes } from '@/lib/routes';

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<'/f/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const view = await loadStorefront(slug, storefrontQueryKey(await searchParams));
  if (!view) return { title: BRAND.productName };
  const { store } = view;
  // Anteprima nei social e su WhatsApp: la copertina, altrimenti il logo.
  const routes = publicStoreRoutes(store.slug);
  const image = store.coverId
    ? routes.image('COVER', store.coverId)
    : store.logoId
      ? routes.image('LOGO', store.logoId)
      : null;
  const env = serverEnv();
  return {
    // Il layout aggiunge «· Gardelia» (prima usciva due volte).
    title: store.name,
    description: store.description ?? undefined,
    // Google (M1-2): solo la vetrina intera; le viste filtrate rimandano a lei.
    ...publicPageIndexing({
      enabled: env.PUBLIC_INDEXING === 'on',
      appUrl: env.APP_URL,
      canonicalPath: routes.home,
      indexable:
        !storefrontFiltered(view.query) && view.page === 1 && view.query.orden === 'recomendados',
    }),
    openGraph: {
      title: store.name,
      description: store.description ?? undefined,
      ...(image ? { images: [`${env.APP_URL.replace(/\/+$/, '')}${image}`] } : {}),
    },
  };
}

/**
 * Pagina pubblica della fioreria (marketplace, blocco C2, ADR-065; vetrina M1, ADR-087). La vista è
 * condivisa con l'anteprima della fioreria (`StorefrontView`).
 */
export default async function PublicStorePage({ params, searchParams }: PageProps<'/f/[slug]'>) {
  const { slug } = await params;
  const view = await loadStorefront(slug, storefrontQueryKey(await searchParams));
  if (!view) notFound();
  return <StorefrontView view={view} links={publicStoreLinks(view.store.slug)} />;
}
