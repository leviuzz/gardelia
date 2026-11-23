/**
 * Foto dei fiori da cui nasce la foto realistica (ADR-034 v9). Per ogni componente di
 * `referenceComponents(spec)` il ritaglio della sua foto principale: solo foto ATTIVE, con
 * ritaglio pronto e della stessa fioreria (RLS + filtro esplicito). Al modello va su fondo bianco
 * e al massimo 1024 px; dei fiori si misura anche il colore dei petali, per il controllo dei
 * conteggi.
 */
import sharp from 'sharp';
import { getDb, withTenantContext, type TenantScope } from '@floral/db';
import { referenceComponents, type BouquetPreviewSpec } from '@floral/domain';
import type { ImageInput } from './provider-types';
import { petalColorOf } from './sketch-renderer';
import { SketchUnavailableError } from './sketch-source';
import { getObjectStorage } from './storage';

const REFERENCE_MAX_SIDE = 1024;

export interface FlowerReferences {
  /** Nell'ordine di `referenceComponents`, quello citato dal prompt. */
  readonly images: readonly ImageInput[];
  /** Colore dei petali di ogni foto di fiore (id della foto → nome del colore). */
  readonly photoColors: Readonly<Record<string, string | null>>;
}

export async function loadFlowerReferences(
  scope: TenantScope,
  spec: BouquetPreviewSpec,
): Promise<FlowerReferences> {
  const components = referenceComponents(spec);
  const ids = components.flatMap((component) =>
    component.cutoutPhotoId ? [component.cutoutPhotoId] : [],
  );
  const photos = await withTenantContext(getDb(), scope, (tx) =>
    tx.catalogItemPhoto.findMany({
      where: { tenantId: scope.tenantId, id: { in: ids }, status: 'ACTIVE', cutoutStatus: 'READY' },
      select: { id: true, cutoutKey: true },
    }),
  );
  const keys = new Map(
    photos.flatMap((photo) => (photo.cutoutKey ? [[photo.id, photo.cutoutKey]] : [])),
  );
  const storage = getObjectStorage();
  const images: ImageInput[] = [];
  const photoColors: Record<string, string | null> = {};
  for (const component of components) {
    const photoId = component.cutoutPhotoId!;
    const key = keys.get(photoId);
    const cutout = key ? await storage.get(key) : null;
    // Foto tolta o file sparito dopo la richiesta: il job fallisce senza consumare il credito.
    if (!cutout) throw new SketchUnavailableError(`ritaglio mancante: ${photoId}`);
    const resized = await sharp(cutout)
      .resize(REFERENCE_MAX_SIDE, REFERENCE_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    if (component.role === 'FLOWER') photoColors[photoId] = await petalColorOf(resized);
    const jpeg = await sharp(resized)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer();
    images.push({ bytes: new Uint8Array(jpeg), contentType: 'image/jpeg' });
  }
  return { images, photoColors };
}
