import { ArrowLeft, ArrowRight, CircleCheck, Plus, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  getCatalogItem,
  hasPermission,
  listCatalogItemPhotos,
  type CatalogItemDto,
  type TenantContext,
} from '@floral/core';
import { allowsPhotos, isBuilderComponentType } from '@floral/domain';
import { StepIndicator } from '@/components/common/step-indicator';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { PhotosSection } from '../../[itemId]/photos-section';

async function loadItem(ctx: TenantContext, itemId: string): Promise<CatalogItemDto> {
  try {
    return await getCatalogItem(ctx, itemId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('catalog.form');
  return { title: t('createTitle') };
}

/**
 * Ultimi passi della creazione guidata di un prodotto (il prodotto esiste già): la foto, che si
 * può saltare, e "listo" con cosa fare dopo. Si possono ricaricare senza perdere nulla.
 */
export default async function AddedItemPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/catalog/new/[itemId]'>) {
  const { tenantSlug, itemId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  if (!hasPermission(ctx, 'catalog:write')) return <Forbidden />;
  const item = await loadItem(ctx, itemId);
  const routes = tenantRoutes(ctx.tenantSlug);
  const t = await getTranslations('catalog');
  const tc = await getTranslations('common');
  const ts = await getTranslations('steps');

  const withPhoto = allowsPhotos(item.type);
  const done = (await searchParams).step === 'done' || !withPhoto;
  const steps = [
    { key: 'what', label: t('wizard.stepWhat') },
    { key: 'colors', label: t('wizard.stepColors') },
    { key: 'price', label: t('wizard.stepPrice') },
    ...(withPhoto ? [{ key: 'photo', label: t('wizard.stepPhoto') }] : []),
    { key: 'done', label: t('wizard.stepDone') },
  ];
  const photos = done ? [] : await listCatalogItemPhotos(ctx, item.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={routes.catalog.list()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {tc('back')}
      </Link>
      <PageHeader title={t('form.createTitle')} description={t('form.createSubtitle')} />
      <StepIndicator steps={steps} current={done ? steps.length - 1 : steps.length - 2} />

      {done ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <CircleCheck className="size-10 text-primary" aria-hidden="true" />
            <h2 className="font-display text-2xl">{t('wizard.doneTitle', { name: item.name })}</h2>
            {item.type === 'BOUQUET' ? (
              <p className="max-w-md text-sm text-muted-foreground">{t('wizard.doneRecipe')}</p>
            ) : isBuilderComponentType(item.type) && item.isBuilderEnabled ? (
              <p className="max-w-md text-sm text-muted-foreground">{t('wizard.doneDesigner')}</p>
            ) : null}
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center">
              {item.type === 'BOUQUET' ? (
                <Button asChild size="lg">
                  <Link href={routes.catalog.item(item.id)}>{t('wizard.buildRecipe')}</Link>
                </Button>
              ) : (
                <Button asChild size="lg">
                  <Link href={routes.catalog.new}>
                    <Plus aria-hidden="true" />
                    {t('wizard.addAnother')}
                  </Link>
                </Button>
              )}
              {item.type !== 'BOUQUET' &&
              isBuilderComponentType(item.type) &&
              item.isBuilderEnabled ? (
                <Button asChild size="lg" variant="outline">
                  <Link href={routes.builder.new}>
                    <Sparkles aria-hidden="true" />
                    {t('wizard.useInDesigner')}
                  </Link>
                </Button>
              ) : null}
              {item.type !== 'BOUQUET' ? (
                <Button asChild size="lg" variant="outline">
                  <Link href={routes.catalog.item(item.id)}>{t('wizard.viewProduct')}</Link>
                </Button>
              ) : null}
              <Button asChild size="lg" variant="ghost">
                <Link href={routes.catalog.list()}>{t('wizard.goToCatalog')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Alert variant="success">
            <CircleCheck aria-hidden="true" />
            <AlertDescription>{t('form.created')}</AlertDescription>
          </Alert>
          <div className="space-y-1">
            <h2 className="font-display text-xl">{t('wizard.photoTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('wizard.photoBody')}</p>
          </div>
          <PhotosSection ctx={ctx} item={item} />
          <div className="flex justify-end">
            <Button asChild size="lg" variant={photos.length > 0 ? 'default' : 'outline'}>
              <Link href={routes.catalog.added(item.id, { step: 'done' })}>
                {photos.length > 0 ? ts('continue') : t('wizard.skipPhoto')}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
