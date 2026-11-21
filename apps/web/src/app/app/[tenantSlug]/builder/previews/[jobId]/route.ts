/**
 * Immagine di un'anteprima AI: servita solo a chi è membro della fioreria proprietaria
 * (stesso controllo di tenant e permessi dei servizi). Mai URL pubblici dell'archivio.
 */
import { NotFoundError, PlanRequiredError, getAiPreviewImage } from '@floral/core';
import { notFoundResponse, privateImageResponse } from '@/lib/image-response';
import { getTenantContext } from '@/lib/tenant';

export async function GET(
  _request: Request,
  { params }: RouteContext<'/app/[tenantSlug]/builder/previews/[jobId]'>,
): Promise<Response> {
  const { tenantSlug, jobId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  try {
    return privateImageResponse(await getAiPreviewImage(ctx, jobId));
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof PlanRequiredError) {
      return notFoundResponse();
    }
    throw error;
  }
}
