import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getBuilderCatalog, getEntitlements } from '@floral/core';
import { PageHeader } from '@/components/page-header';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { saveDesignAction } from '../actions';
import { BouquetEditor } from '../bouquet-editor';
import { BuilderUpsell, builderOptions } from '../builder-ui';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('builder.editor');
  return { title: t('newTitle') };
}

export default async function NewDesignPage({
  params,
}: PageProps<'/app/[tenantSlug]/builder/new'>) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations();
  const routes = tenantRoutes(ctx.tenantSlug);
  const back = (
    <Link
      href={routes.builder.list()}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t('common.back')}
    </Link>
  );

  if (!(await getEntitlements(ctx)).bouquetBuilder) {
    return (
      <div className="space-y-6">
        {back}
        <BuilderUpsell ctx={ctx} />
      </div>
    );
  }

  const catalog = await getBuilderCatalog(ctx);
  return (
    <div className="space-y-6">
      {back}
      <PageHeader title={t('builder.editor.newTitle')} description={t('builder.subtitle')} />
      <BouquetEditor
        currency={catalog.currency}
        laborFeeMinor={catalog.laborFeeMinor}
        options={await builderOptions(catalog, ctx.tenantSlug)}
        unusableLines={[]}
        initial={{
          name: t('builder.editor.defaultName'),
          style: '',
          size: '',
          budget: '',
          notes: '',
          quantities: {},
          colors: {},
        }}
        savedTotalMinor={null}
        canViewCosts={catalog.canViewCosts}
        canQuote={catalog.canQuote}
        readOnly={false}
        saveAction={saveDesignAction.bind(null, ctx.tenantSlug, null)}
        quoteHref={null}
        catalogHref={routes.catalog.list()}
      />
    </div>
  );
}
