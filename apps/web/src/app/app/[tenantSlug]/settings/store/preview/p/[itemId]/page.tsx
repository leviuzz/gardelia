import { PackageX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getStorePreviewItem, hasPermission } from '@floral/core';
import { Forbidden } from '@/components/forbidden';
import { EmptyState } from '@/components/page-header';
import { ProductView } from '@/components/public/storefront-view';
import { Button } from '@/components/ui/button';
import { previewStoreLinks, tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { PreviewBanner } from '../../preview-banner';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('store.preview');
  return { title: t('title') };
}

/**
 * Un prodotto nell'«Anteprima» della vetrina (M1-2): come lo vedranno i clienti, con i pulsanti
 * d'ordine spenti. Se il prodotto non è nel negozio, la pagina lo dice e porta al Catalogo; un ID
 * di un'altra fioreria è un 404.
 */
export default async function StorePreviewItemPage({
  params,
}: PageProps<'/app/[tenantSlug]/settings/store/preview/p/[itemId]'>) {
  const { tenantSlug, itemId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'tenant:settings:update')) return <Forbidden />;
  const { detail, isPublished } = await getStorePreviewItem(ctx, itemId);
  const routes = tenantRoutes(ctx.tenantSlug);
  const t = await getTranslations('store.preview');
  return (
    <div className="space-y-4">
      <PreviewBanner slug={ctx.tenantSlug} isPublished={isPublished} />
      {detail ? (
        <div className="overflow-hidden rounded-2xl border" data-testid="store-preview">
          <ProductView detail={detail} links={previewStoreLinks(ctx.tenantSlug)} preview />
        </div>
      ) : (
        <EmptyState
          icon={<PackageX />}
          title={t('itemOffTitle')}
          body={t('itemOffBody')}
          action={
            <Button asChild>
              <Link href={routes.catalog.item(itemId)}>{t('openItem')}</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
