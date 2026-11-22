/**
 * Immagine del ramo di una riga del preventivo (ADR-035): servita a chi vede il preventivo nella
 * fioreria proprietaria (stessi controlli del servizio). `?download=1` la scarica, per allegarla
 * a mano nel messaggio di WhatsApp. Mai URL pubblici. Regole comuni: lib/private-image-route.ts.
 */
import { getQuoteLineImage } from '@floral/core';
import { privateImageRoute } from '@/lib/private-image-route';

export const GET = privateImageRoute<
  RouteContext<'/app/[tenantSlug]/quotes/[quoteId]/lines/[lineId]/image'>
>((ctx, { quoteId, lineId }) => getQuoteLineImage(ctx, quoteId, lineId), {
  downloadName: (request) =>
    new URL(request.url).searchParams.get('download') === '1' ? 'ramo' : undefined,
});
