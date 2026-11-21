import { ImageIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import {
  hasPermission,
  listCatalogItemPhotos,
  type CatalogItemDto,
  type TenantContext,
} from '@floral/core';
import { PHOTO_LIMITS, allowsPhotos, photoByColor, type CatalogColor } from '@floral/domain';
import { RemovePhotoButton } from '@/components/photos/photo-upload-parts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COLOR_SWATCH_CLASS } from '@/lib/catalog-ui';
import { cn } from '@/lib/utils';
import { archiveCatalogPhotoAction, uploadCatalogPhotoAction } from '../photo-actions';
import { CatalogPhotoUploader } from './catalog-photo-uploader';

/** Foto dell'articolo: griglia, vista e colore, caricamento e rimozione (solo chi gestisce). */
export async function PhotosSection({ ctx, item }: { ctx: TenantContext; item: CatalogItemDto }) {
  if (!allowsPhotos(item.type)) return null;
  const t = await getTranslations();
  const photos = await listCatalogItemPhotos(ctx, item.id);
  const canWrite = hasPermission(ctx, 'catalog:write') && item.status === 'ACTIVE';
  const byColor = photoByColor(item.type);
  const remaining = Math.max(0, PHOTO_LIMITS.perItem - photos.length);
  const slug = ctx.tenantSlug;
  const colorLabel = (color: string) => t(`catalog.colors.${color}`);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">{t('photos.title')}</CardTitle>
        <CardDescription className="space-y-1">
          <span className="block">
            {byColor
              ? t('photos.subtitleByColor')
              : item.type === 'CUT_FLOWER' || item.type === 'FOLIAGE'
                ? t('photos.subtitleFlower')
                : t('photos.subtitleOther')}
          </span>
          <span className="block">{t('photos.usage')}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {photos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            <ImageIcon className="size-6" aria-hidden="true" />
            {t('photos.empty')}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('photos.count', { count: photos.length, max: PHOTO_LIMITS.perItem })}
            </p>
            <ul
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
              data-testid="item-photos"
            >
              {photos.map((photo) => {
                const view = t(`photos.views.${photo.view}`);
                const alt = photo.color
                  ? t('photos.altColor', { name: item.name, color: colorLabel(photo.color), view })
                  : t('photos.alt', { name: item.name, view });
                return (
                  <li key={photo.id} className="relative">
                    <figure className="space-y-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element -- immagine privata servita da una route autenticata */}
                      <img
                        src={`/app/${slug}/catalog/photos/${photo.id}?size=thumb`}
                        alt={alt}
                        loading="lazy"
                        className="aspect-square w-full rounded-xl border bg-muted object-cover"
                      />
                      <figcaption className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">{view}</Badge>
                        {photo.color ? (
                          <Badge variant="outline" className="gap-1.5">
                            <span
                              aria-hidden="true"
                              className={cn(
                                'size-2.5 rounded-full border border-black/10',
                                COLOR_SWATCH_CLASS[photo.color as CatalogColor],
                              )}
                            />
                            {colorLabel(photo.color)}
                          </Badge>
                        ) : null}
                      </figcaption>
                    </figure>
                    {canWrite ? (
                      <div className="absolute top-2 right-2">
                        <RemovePhotoButton
                          action={archiveCatalogPhotoAction.bind(null, slug, photo.id)}
                          label={t('photos.remove')}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {canWrite ? (
          remaining > 0 ? (
            <CatalogPhotoUploader
              upload={uploadCatalogPhotoAction.bind(null, slug, item.id)}
              colors={item.colors.map((color) => ({ value: color, label: colorLabel(color) }))}
              byColor={byColor}
              remaining={remaining}
              maxSide={PHOTO_LIMITS.clientMaxSide}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('photos.limitReached', { max: PHOTO_LIMITS.perItem })}
            </p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
