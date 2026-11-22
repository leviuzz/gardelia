import { ArrowLeft, ImageIcon, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  getEntitlements,
  hasPermission,
  listStyleReferences,
  photoCutoutsAvailable,
} from '@floral/core';
import { BUILDER_STYLES, PHOTO_LIMITS } from '@floral/domain';
import { PageHeader } from '@/components/page-header';
import { RemovePhotoButton } from '@/components/photos/photo-upload-parts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { getTenantContext } from '@/lib/tenant';
import { BuilderUpsell } from '../builder-ui';
import { archiveStyleReferenceAction, uploadStyleReferenceAction } from './actions';
import { ReferenceUploader } from './reference-uploader';
import { PrivateImage } from '@/components/common/private-image';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('styleReferences');
  return { title: t('title') };
}

/**
 * "Mis ramos" (ADR-029, ADR-032): foto dei ramos della fioreria, caricate con consenso. Le
 * anteprime usano il loro stile descritto a parole (mai la foto); sotto ogni foto si vede lo
 * stile riconosciuto, così il fiorista sa cosa ne ha capito l'AI.
 */
export default async function StyleReferencesPage({
  params,
}: PageProps<'/app/[tenantSlug]/builder/references'>) {
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
      {t('styleReferences.back')}
    </Link>
  );

  if (!(await getEntitlements(ctx)).bouquetBuilder) {
    return (
      <div className="space-y-6">
        {back}
        <PageHeader
          title={t('styleReferences.title')}
          description={t('styleReferences.subtitle')}
        />
        <BuilderUpsell ctx={ctx} />
      </div>
    );
  }

  const references = await listStyleReferences(ctx);
  const canWrite = hasPermission(ctx, 'builder:references:write');
  const remaining = Math.max(0, PHOTO_LIMITS.references - references.length);
  const styleLabel = (style: string) => t(`builder.editor.styles.${style}`);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {back}
      <PageHeader title={t('styleReferences.title')} description={t('styleReferences.subtitle')} />

      <p className="flex items-start gap-2 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        {t('styleReferences.usage')}
      </p>

      {references.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/30 p-8 text-center">
          <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{t('styleReferences.empty')}</p>
          <p className="text-sm text-muted-foreground">{t('styleReferences.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t('styleReferences.count', {
              count: references.length,
              max: PHOTO_LIMITS.references,
            })}
          </p>
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
            data-testid="style-references"
          >
            {references.map((reference) => (
              <li key={reference.id} className="relative">
                <figure className="space-y-1.5">
                  <PrivateImage
                    src={routes.builder.referencePhoto(reference.id, 'thumb')}
                    alt={
                      reference.style
                        ? t('styleReferences.altStyle', { style: styleLabel(reference.style) })
                        : t('styleReferences.alt')
                    }
                    className="aspect-square w-full rounded-xl border bg-muted object-cover"
                  />
                  <figcaption className="space-y-1">
                    {reference.style ? (
                      <Badge variant="secondary">{styleLabel(reference.style)}</Badge>
                    ) : null}
                    {reference.caption ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {reference.caption}
                      </span>
                    ) : null}
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {reference.styleDescriptionEs
                        ? t('styleReferences.styleDetected', {
                            description: reference.styleDescriptionEs,
                          })
                        : t('styleReferences.stylePending')}
                    </span>
                  </figcaption>
                </figure>
                {canWrite ? (
                  <div className="absolute top-2 right-2">
                    <RemovePhotoButton
                      action={archiveStyleReferenceAction.bind(null, ctx.tenantSlug, reference.id)}
                      label={t('styleReferences.remove')}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">{t('styleReferences.upload')}</CardTitle>
            <CardDescription>
              {t('styleReferences.emptyHint')}
              {/* Le foto del catalogo si scontornano (ADR-033), queste no: lo diciamo. */}
              {photoCutoutsAvailable() ? ` ${t('styleReferences.keepsBackground')}` : null}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {remaining > 0 ? (
              <ReferenceUploader
                upload={uploadStyleReferenceAction.bind(null, ctx.tenantSlug)}
                styles={BUILDER_STYLES.map((style) => ({ value: style, label: styleLabel(style) }))}
                remaining={remaining}
                maxSide={PHOTO_LIMITS.clientMaxSide}
                captionMax={PHOTO_LIMITS.caption}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('styleReferences.limitReached', { max: PHOTO_LIMITS.references })}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">{t('styleReferences.readOnly')}</p>
      )}
    </div>
  );
}
