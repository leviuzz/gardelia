/**
 * Immagine del ramo di una riga dell'ordine (foto vera o anteprima, ADR-035/ADR-052): servita a
 * chi vede l'ordine nella fioreria proprietaria. `?download=1` la scarica, per allegarla a mano su
 * WhatsApp. Mai URL pubblici. Regole comuni: lib/private-image-route.ts.
 */
import { getOrderLineImage } from '@floral/core';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/orders/[orderId]/lines/[lineId]/image'>
>((ctx, { orderId, lineId }) => getOrderLineImage(ctx, orderId, lineId), {
  downloadName: (request) =>
    new URL(request.url).searchParams.get('download') === '1' ? 'ramo' : undefined,
});
