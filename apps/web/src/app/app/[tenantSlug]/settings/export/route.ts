/**
 * "Descargar los datos de la florería" (ADR-079): lo ZIP con un CSV per area. Solo il titolare
 * (`tenant:export`, controllato nel servizio); per gli altri la risposta è 404, come per le immagini
 * private: non si rivela perché non si vede.
 */
import { ForbiddenError, exportTenantData } from '@floral/core';
import { getTenantContext } from '@/lib/tenant';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/app/[tenantSlug]/settings/export'>,
): Promise<Response> {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  try {
    const file = await exportTenantData(ctx);
    return new Response(Buffer.from(file.bytes), {
      headers: {
        'Content-Type': 'application/zip',
        // Il nome viene dal server (slug e data): solo lettere, numeri, trattini e punti.
        'Content-Disposition': `attachment; filename="${file.fileName.replace(/[^a-z0-9.-]/gi, '')}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response(null, { status: 404 });
    throw error;
  }
}
