/**
 * La foto di un messaggio di Floral Care (ADR-084; `?size=thumb` per la miniatura): solo per chi
 * vede i messaggi della fioreria, e solo finché non è tolta né cancellata. Mai URL pubblici.
 * Regole comuni: lib/private-image-route.ts.
 */
import { getCareMessagePhotoImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/subscriptions/[subscriptionId]/messages/photos/[photoId]'>
>((ctx, { subscriptionId, photoId }, request) =>
  getCareMessagePhotoImage(ctx, subscriptionId, photoId, photoVariant(request)),
);
