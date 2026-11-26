/**
 * La foto di un messaggio di un ordine online (M3, ADR-088; `?size=thumb` per la miniatura): solo
 * per chi vede i messaggi della fioreria, e solo finché non è tolta né cancellata. Mai URL
 * pubblici. Regole comuni: lib/private-image-route.ts.
 */
import { getOrderMessagePhotoImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/orders/[orderId]/messages/photos/[messageId]'>
>((ctx, { orderId, messageId }, request) =>
  getOrderMessagePhotoImage(ctx, orderId, messageId, photoVariant(request)),
);
