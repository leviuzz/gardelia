import { ArrowLeft, CircleCheck, TriangleExclamationPoint } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { cache } from 'react';
import {
  NotFoundError,
  getBouquetConfiguration,
  getBouquetPreview,
  getBuilderCatalog,
  getEntitlements,
  isAiPreviewAvailable,
  type BouquetConfigurationDto,
  type TenantContext,
} from '@floral/core';
import { BRAND, minorToDecimalString, isCurrencyCode } from '@floral/domain';
import { ArchiveControl } from '@/components/archive-control';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getTenantContext } from '@/lib/tenant';
import { requestPreviewAction, saveDesignAction, setDesignArchivedAction } from '../actions';
import { BouquetEditor } from '../bouquet-editor';
import { BuilderUpsell, builderOptions } from '../builder-ui';
import type { PreviewPanelData } from '../preview-panel';

/** Una sola lettura per richiesta (metadata + pagina). */
const loadDesign = cache(
  async (ctx: TenantContext, configurationId: string): Promise<BouquetConfigurationDto | null> => {
    if (!(await getEntitlements(ctx)).bouquetBuilder) return null;
    try {
      return await getBouquetConfiguration(ctx, configurationId);
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }
  },
);

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/builder/[configurationId]'>): Promise<Metadata> {
  const { tenantSlug, configurationId } = await params;
  const design = await loadDesign(await getTenantContext(tenantSlug), configurationId);
  const t = await getTranslations('builder');
  return { title: design?.name ?? t('title') };
}

export default async function DesignPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/builder/[configurationId]'>) {
  const { tenantSlug, configurationId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const t = await getTranslations();
  const base = `/app/${ctx.tenantSlug}`;
  const back = (
    <Link
      href={`${base}/builder`}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t('common.back')}
    </Link>
  );

  const design = await loadDesign(ctx, configurationId);
  if (!design) {
    return (
      <div className="space-y-6">
        {back}
        <BuilderUpsell ctx={ctx} />
      </div>
    );
  }

  const catalog = await getBuilderCatalog(ctx);
  const options = await builderOptions(catalog);
  const available = new Set(options.map((option) => option.id));
  const archived = design.status === 'ARCHIVED';
  const saved = (await searchParams).saved === '1';
  const format = await getFormatter();
  const previewState =
    !archived && isAiPreviewAvailable() ? await getBouquetPreview(ctx, design.id) : null;
  const preview: PreviewPanelData | null =
    previewState?.available && previewState.quota
      ? {
          simulated: previewState.simulated,
          outdated: previewState.outdated,
          quota: {
            includedLimit: previewState.quota.includedLimit,
            includedRemaining: previewState.quota.includedRemaining,
            extraRemaining: previewState.quota.extraRemaining,
            remaining: previewState.quota.remaining,
            renewsOn: format.dateTime(previewState.quota.periodEnd, {
              day: 'numeric',
              month: 'long',
              timeZone: ctx.timezone,
            }),
          },
          preview: previewState.preview
            ? {
                jobId: previewState.preview.jobId,
                status: previewState.preview.status,
                reused: previewState.preview.reused,
                imageUrl:
                  previewState.preview.status === 'SUCCEEDED'
                    ? `${base}/builder/previews/${previewState.preview.jobId}`
                    : null,
              }
            : null,
          designName: design.name,
          productName: BRAND.productName,
          requestAction: requestPreviewAction.bind(null, ctx.tenantSlug, design.id),
        }
      : null;

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={design.name}
        description={t('builder.subtitle')}
        actions={
          <ArchiveControl
            archived={archived}
            archiveAction={setDesignArchivedAction.bind(null, ctx.tenantSlug, design.id, true)}
            restoreAction={setDesignArchivedAction.bind(null, ctx.tenantSlug, design.id, false)}
            labels={{
              archive: t('builder.editor.archive'),
              restore: t('builder.editor.restore'),
              confirmTitle: t('builder.editor.archiveTitle'),
              confirmBody: t('builder.editor.archiveBody'),
            }}
          />
        }
      />
      {saved && !archived ? (
        <Alert variant="success">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{t('builder.editor.savedNotice')}</AlertDescription>
        </Alert>
      ) : null}
      {archived ? (
        <Alert variant="warning">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{t('builder.editor.archivedNotice')}</AlertDescription>
        </Alert>
      ) : null}
      <BouquetEditor
        currency={catalog.currency}
        laborFeeMinor={catalog.laborFeeMinor}
        options={options}
        unusableLines={design.lines
          .filter((line) => !available.has(line.catalogItemId))
          .map((line) => ({
            id: line.catalogItemId,
            name: line.variety ? `${line.name} · ${line.variety}` : line.name,
            quantity: line.quantity,
          }))}
        initial={{
          name: design.name,
          style: design.style ?? '',
          size: design.size ?? '',
          budget:
            design.budgetMinor !== null && isCurrencyCode(design.currency)
              ? minorToDecimalString(design.budgetMinor, design.currency)
              : '',
          notes: design.notes ?? '',
          quantities: Object.fromEntries(
            design.lines
              .filter((line) => available.has(line.catalogItemId))
              .map((line) => [line.catalogItemId, line.quantity]),
          ),
        }}
        savedTotalMinor={design.totalMinor}
        canViewCosts={catalog.canViewCosts}
        canQuote={catalog.canQuote && !archived}
        readOnly={archived}
        saveAction={saveDesignAction.bind(null, ctx.tenantSlug, design.id)}
        quoteHref={`${base}/quotes/new?configurationId=${design.id}`}
        catalogHref={`${base}/catalog`}
        preview={preview}
      />
    </div>
  );
}
