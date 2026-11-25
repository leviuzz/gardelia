import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getStorePreview, hasPermission } from '@floral/core';
import { Forbidden } from '@/components/forbidden';
import { StorefrontView } from '@/components/public/storefront-view';
import { previewStoreLinks } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { PreviewBanner } from './preview-banner';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('store.preview');
  return { title: t('title') };
}

/**
 * «Anteprima» della vetrina (marketplace, M1-2, ADR-087): come la vedranno i clienti, anche prima
 * di pubblicare. Solo proprietario e gerente; i dati si leggono con i permessi della fioreria, le
 * foto dalle pagine private, e gli ordini non partono.
 */
export default async function StorePreviewPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/settings/store/preview'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'tenant:settings:update')) return <Forbidden />;
  const view = await getStorePreview(ctx, await searchParams);
  return (
    <div className="space-y-4">
      <PreviewBanner slug={ctx.tenantSlug} isPublished={view.isPublished} />
      <div className="overflow-hidden rounded-2xl border" data-testid="store-preview">
        <StorefrontView view={view} links={previewStoreLinks(ctx.tenantSlug)} preview />
      </div>
    </div>
  );
}
