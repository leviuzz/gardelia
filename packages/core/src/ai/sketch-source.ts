/**
 * Boceto esatto di una distinta per una fioreria (ADR-034): le miniature dei ritagli si leggono
 * solo per foto ATTIVE, con ritaglio pronto e della stessa fioreria (RLS + filtro esplicito).
 */
import { getDb, withTenantContext, type TenantScope } from '@floral/db';
import type { BouquetPreviewSpec, SketchLayout } from '@floral/domain';
import { cutoutThumbKey } from '../media/cutout-keys';
import { renderBouquetSketch, sketchPhotoIds } from './sketch-renderer';
import { getObjectStorage } from './storage';

/** Un ritaglio della distinta non c'è più (foto tolta o file mancante). */
export class SketchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SketchUnavailableError';
  }
}

export async function renderSketchForTenant(
  scope: TenantScope,
  spec: BouquetPreviewSpec,
): Promise<{
  png: Uint8Array;
  layout: SketchLayout;
  photoColors: Record<string, string | null>;
}> {
  const ids = sketchPhotoIds(spec);
  const photos = await withTenantContext(getDb(), scope, (tx) =>
    tx.catalogItemPhoto.findMany({
      where: { tenantId: scope.tenantId, id: { in: ids }, status: 'ACTIVE', cutoutStatus: 'READY' },
      select: { id: true, cutoutKey: true },
    }),
  );
  const keys = new Map(
    photos.flatMap((photo) =>
      photo.cutoutKey ? [[photo.id, cutoutThumbKey(photo.cutoutKey)]] : [],
    ),
  );
  try {
    return await renderBouquetSketch(spec, async (photoId) => {
      const key = keys.get(photoId);
      return key ? getObjectStorage().get(key) : null;
    });
  } catch (error) {
    if (error instanceof Error && /ritaglio (mancante|non caricato)/.test(error.message)) {
      throw new SketchUnavailableError(error.message);
    }
    throw error;
  }
}
