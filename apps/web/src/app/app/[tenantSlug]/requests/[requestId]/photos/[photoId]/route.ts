/**
 * Una foto di ispirazione di una richiesta (M5; `?size=thumb` per la miniatura): solo ai membri
 * della fioreria, con i controlli del servizio (un'altra fioreria risponde 404).
 */
import { getServiceRequestPhotoImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/requests/[requestId]/photos/[photoId]'>
>((ctx, { requestId, photoId }, request) =>
  getServiceRequestPhotoImage(ctx, requestId, photoId, photoVariant(request)),
);
