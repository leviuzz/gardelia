import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { hasPermission, listCanonicalFlowers } from '@floral/core';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { createItemAction } from '../actions';
import { ItemForm } from '../item-form';
import { loadSupplierChoices } from '../supplier-choices';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('catalog.form');
  return { title: t('createTitle') };
}

export default async function NewItemPage({ params }: PageProps<'/app/[tenantSlug]/catalog/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'catalog:write')) return <Forbidden />;

  const t = await getTranslations('catalog');
  const tc = await getTranslations('common');
  const [canonical, suppliers] = await Promise.all([
    listCanonicalFlowers(ctx.locale),
    loadSupplierChoices(ctx),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={tenantRoutes(ctx.tenantSlug).catalog.list()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {tc('back')}
      </Link>
      <PageHeader title={t('form.createTitle')} description={t('form.createSubtitle')} />
      <ItemForm
        mode="create"
        action={createItemAction.bind(null, ctx.tenantSlug)}
        canonicalOptions={canonical}
        suppliers={suppliers}
      />
    </div>
  );
}
