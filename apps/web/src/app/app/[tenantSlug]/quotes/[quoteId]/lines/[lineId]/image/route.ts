/**
 * Immagine del ramo di una riga del preventivo (ADR-035): servita a chi vede il preventivo nella
 * fioreria proprietaria (stessi controlli del servizio). `?download=1` la scarica, per allegarla
 * a mano nel messaggio di WhatsApp. Mai URL pubblici.
 */
import { NotFoundError, getQuoteLineImage } from '@floral/core';
import { notFoundResponse, privateImageResponse } from '@/lib/image-response';
import { getTenantContext } from '@/lib/tenant';

export async function GET(
  request: Request,
  { params }: RouteContext<'/app/[tenantSlug]/quotes/[quoteId]/lines/[lineId]/image'>,
): Promise<Response> {
  const { tenantSlug, quoteId, lineId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  try {
    const image = await getQuoteLineImage(ctx, quoteId, lineId);
    const download = new URL(request.url).searchParams.get('download') === '1';
    return privateImageResponse(image, download ? { downloadName: 'ramo' } : {});
  } catch (error) {
    if (error instanceof NotFoundError) return notFoundResponse();
    throw error;
  }
}
