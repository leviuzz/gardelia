/**
 * Foto di un servizio in vetrina (M5, `?size=thumb` per la miniatura): solo ai membri della
 * fioreria, con i controlli del servizio. La vetrina pubblica ha la sua rotta, solo per i servizi
 * pubblicati.
 */
import { getStorefrontServicePhotoImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/settings/store/services/photos/[photoId]'>
>((ctx, { photoId }, request) =>
  getStorefrontServicePhotoImage(ctx, photoId, photoVariant(request)),
);
