import type { MetadataRoute } from 'next';
import { listSitemapEntries } from '@floral/core';
import { serverEnv } from '@/lib/env';
import { absoluteUrl } from '@/lib/indexing';
import { buyerRoutes, publicStoreRoutes } from '@/lib/routes';

// Letta a ogni richiesta: vetrine e prodotti cambiano, e l'interruttore è nel deploy.
export const dynamic = 'force-dynamic';

/**
 * sitemap.xml (M1-2, ADR-087): home, pagina per i fioristi, vetrine pubblicate e loro prodotti
 * online. Vuota con `PUBLIC_INDEXING` spento.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const env = serverEnv();
  if (env.PUBLIC_INDEXING !== 'on') return [];
  const url = (path: string) => absoluteUrl(env.APP_URL, path);
  const entries = await listSitemapEntries();
  return [
    { url: url(buyerRoutes.home) },
    { url: url(buyerRoutes.florists) },
    ...entries.map((entry) => ({
      url: url(
        entry.itemId
          ? publicStoreRoutes(entry.slug).item(entry.itemId)
          : publicStoreRoutes(entry.slug).home,
      ),
      lastModified: entry.updatedAt,
    })),
  ];
}
