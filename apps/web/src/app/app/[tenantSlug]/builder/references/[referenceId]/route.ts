/**
 * Foto di "Mis ramos" (`?size=thumb` per la miniatura): solo per i membri della fioreria
 * proprietaria con il piano che include il Builder. Mai URL pubblici.
 */
import { NotFoundError, PlanRequiredError, getStyleReferenceImage } from '@floral/core';
import { notFoundResponse, photoVariant, privateImageResponse } from '@/lib/image-response';
import { getTenantContext } from '@/lib/tenant';

export async function GET(
  request: Request,
  { params }: RouteContext<'/app/[tenantSlug]/builder/references/[referenceId]'>,
): Promise<Response> {
  const { tenantSlug, referenceId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  try {
    return privateImageResponse(
      await getStyleReferenceImage(ctx, referenceId, photoVariant(request)),
    );
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof PlanRequiredError) {
      return notFoundResponse();
    }
    throw error;
  }
}
