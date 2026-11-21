/**
 * Immagine di un'anteprima AI: servita solo a chi è membro della fioreria proprietaria
 * (stesso controllo di tenant e permessi dei servizi). Mai URL pubblici dell'archivio.
 */
import { NotFoundError, PlanRequiredError, getAiPreviewImage } from '@floral/core';
import { getTenantContext } from '@/lib/tenant';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/app/[tenantSlug]/builder/previews/[jobId]'>,
): Promise<Response> {
  const { tenantSlug, jobId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  try {
    const image = await getAiPreviewImage(ctx, jobId);
    return new Response(Buffer.from(image.bytes), {
      headers: {
        'Content-Type': image.contentType,
        // L'immagine di un job non cambia mai: cache privata del browser.
        'Cache-Control': 'private, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof PlanRequiredError) {
      return new Response('Not found', { status: 404 });
    }
    throw error;
  }
}
