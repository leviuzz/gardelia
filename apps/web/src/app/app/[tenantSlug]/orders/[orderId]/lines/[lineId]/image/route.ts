/**
 * Immagine del ramo di una riga dell'ordine (la stessa del preventivo, ADR-035): servita a chi vede
 * l'ordine nella fioreria proprietaria. Mai URL pubblici. Regole comuni: lib/private-image-route.ts.
 */
import { getOrderLineImage } from '@floral/core';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/orders/[orderId]/lines/[lineId]/image'>
>((ctx, { orderId, lineId }) => getOrderLineImage(ctx, orderId, lineId));
