/**
 * Boceto esatto del disegno salvato (ADR-034): PNG disegnato dai ritagli delle foto della
 * fioreria, servito solo ai suoi membri con il piano che include il Builder. L'URL della pagina
 * porta `?v=<versione>`: cambia quando cambia il boceto, quindi la cache del browser è sicura.
 */
import { NotFoundError, PlanRequiredError, getBouquetSketch } from '@floral/core';
import { notFoundResponse, privateImageResponse } from '@/lib/image-response';
import { getTenantContext } from '@/lib/tenant';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/app/[tenantSlug]/builder/[configurationId]/sketch'>,
): Promise<Response> {
  const { tenantSlug, configurationId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  try {
    return privateImageResponse(await getBouquetSketch(ctx, configurationId));
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof PlanRequiredError) {
      return notFoundResponse();
    }
    throw error;
  }
}
