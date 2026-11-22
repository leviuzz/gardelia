import { ImageIcon, LoaderCircle, Scissors } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import {
  hasPermission,
  listCatalogItemPhotos,
  photoCutoutsAvailable,
  type CatalogItemDto,
  type TenantContext,
} from '@floral/core';
import { PHOTO_LIMITS, allowsPhotos, canRequestCutout, photoByColor } from '@floral/domain';
import { ColorSwatch } from '@/components/common/color-swatch';
import { CutoutAutoRefresh, RequestCutoutButton } from '@/components/photos/cutout-parts';
import { RemovePhotoButton } from '@/components/photos/photo-upload-parts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tenantRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import {
  archiveCatalogPhotoAction,
  requestPhotoCutoutAction,
  uploadCatalogPhotoAction,
} from '../photo-actions';
import { CatalogPhotoUploader } from './catalog-photo-uploader';
import { PrivateImage } from '@/components/common/private-image';
import { kickAiDrainWhileWaiting } from '@/lib/ai-kick';

/**
 * Foto dell'articolo: griglia, vista e colore, caricamento e rimozione (solo chi gestisce).
 * Con lo scontorno attivo (ADR-033) ogni foto mostra la sua versione senza fondo, o lo stato
 * del ritaglio con il consiglio per rifarla.
 */
export async function PhotosSection({ ctx, item }: { ctx: TenantContext; item: CatalogItemDto }) {
  if (!allowsPhotos(item.type)) return null;
  const t = await getTranslations();
  const photos = await listCatalogItemPhotos(ctx, item.id);
  const canWrite = hasPermission(ctx, 'catalog:write') && item.status === 'ACTIVE';
  const cutouts = photoCutoutsAvailable();
  const byColor = photoByColor(item.type);
  const remaining = Math.max(0, PHOTO_LIMITS.perItem - photos.length);
  const slug = ctx.tenantSlug;
  const colorLabel = (color: string) => t(`catalog.colors.${color}`);
  const anyPending = photos.some((photo) => photo.cutoutStatus === 'PENDING');
  // Su Vercel uno scontorno rimasto indietro riparte mentre la pagina lo aspetta (ADR-037).
  kickAiDrainWhileWaiting(anyPending);

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
          <span className="block">{t('photos.background')}</span>
          <span className="block">
            {t('photos.usage')}
            {cutouts ? ` ${t('photos.cutoutAuto')}` : null}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <CutoutAutoRefresh active={anyPending} />
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
                const cutoutReady = photo.cutoutStatus === 'READY';
                const src = tenantRoutes(slug).catalog.photo(
                  photo.id,
                  cutoutReady ? 'cutout-thumb' : 'thumb',
                );
                return (
                  <li
                    key={photo.id}
                    className="relative"
                    data-cutout={photo.cutoutStatus ?? 'NONE'}
                  >
                    <figure className="space-y-1.5">
                      <PrivateImage
                        src={src}
                        alt={cutoutReady ? t('photos.cutoutAlt', { description: alt }) : alt}
                        className={cn(
                          'aspect-square w-full rounded-xl border',
                          cutoutReady
                            ? 'bg-checkerboard object-contain p-2'
                            : 'bg-muted object-cover',
                        )}
                      />
                      <figcaption className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary">{view}</Badge>
                          {photo.color ? (
                            <Badge variant="outline" className="gap-1.5">
                              <ColorSwatch color={photo.color} size="xs" />
                              {colorLabel(photo.color)}
                            </Badge>
                          ) : null}
                          {cutoutReady ? (
                            <Badge variant="outline" className="gap-1">
                              <Scissors className="size-3" aria-hidden="true" />
                              {t('photos.cutoutReady')}
                            </Badge>
                          ) : null}
                          {photo.cutoutStatus === 'PENDING' ? (
                            <Badge variant="outline" className="gap-1" role="status">
                              <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                              {t('photos.cutoutPending')}
                            </Badge>
                          ) : null}
                        </div>
                        {photo.cutoutStatus === 'FAILED' && photo.cutoutError ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {t(`photos.cutoutErrors.${photo.cutoutError}`)}
                          </p>
                        ) : null}
                        {canWrite &&
                        cutouts &&
                        canRequestCutout(photo.cutoutStatus, photo.cutoutError) ? (
                          <RequestCutoutButton
                            action={requestPhotoCutoutAction.bind(null, slug, photo.id)}
                            label={
                              photo.cutoutStatus === null
                                ? t('photos.cutoutRequest')
                                : t('photos.cutoutRetry')
                            }
                          />
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
