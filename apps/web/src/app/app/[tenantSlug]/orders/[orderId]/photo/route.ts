/**
 * Foto del ramo finito di un ordine (prova di consegna, ADR-058; `?size=thumb` per la miniatura):
 * solo per i membri della fioreria proprietaria. Mai URL pubblici. Regole comuni:
 * lib/private-image-route.ts.
 */
import { getOrderPhotoImage } from '@floral/core';
import { photoVariant } from '@/lib/image-response';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<RouteContext<'/app/[tenantSlug]/orders/[orderId]/photo'>>(
  (ctx, { orderId }, request) => getOrderPhotoImage(ctx, orderId, photoVariant(request)),
);
