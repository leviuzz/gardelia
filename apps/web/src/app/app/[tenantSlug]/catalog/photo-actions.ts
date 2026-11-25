'use server';

/**
 * Server action delle foto del catalogo. Il browser carica una foto per richiesta; il servizio
 * ricontrolla permessi, fioreria, tipo e dimensioni dell'immagine. Contesto ed errori:
 * `runTenantAction`. Gli argomenti legati con .bind() non sono fidati.
 */
import {
  addCatalogItemPhoto,
  archiveCatalogItemPhoto,
  moveCatalogItemPhoto,
  requestPhotoCutout,
} from '@floral/core';
import type { ActionState } from '@/lib/action-state';
import { runTenantAction, section } from '@/lib/tenant-action';
import { uploadedBytes } from '@/lib/uploads';

export async function uploadCatalogPhotoAction(
  slug: string,
  itemId: string,
  formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await addCatalogItemPhoto(ctx, itemId, await uploadedBytes(formData), {
      view: formData.get('view'),
      color: formData.get('color'),
    });
    return { revalidate: section(routes.catalog.list()) };
  });
}

export async function archiveCatalogPhotoAction(
  slug: string,
  photoId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await archiveCatalogItemPhoto(ctx, photoId);
    return { revalidate: section(routes.catalog.list()), success: 'photos.removed' };
  });
}

/** "Quitar el fondo" / "Reintentar": il servizio decide se si può (stato, limite, spesa). */
export async function requestPhotoCutoutAction(
  slug: string,
  photoId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    const { queued } = await requestPhotoCutout(ctx, photoId);
    return {
      revalidate: section(routes.catalog.list()),
      success: queued ? 'photos.cutoutRequested' : 'photos.cutoutNotNeeded',
    };
  });
}

/**
 * «Usa come copertina» e le frecce ←/→ (M1): l'ordine delle foto vale in vetrina, nel catalogo e
 * nel Diseñador. Lo spostamento arriva legato con `.bind()`: il servizio lo ricontrolla.
 */
export async function moveCatalogPhotoAction(
  slug: string,
  photoId: string,
  move: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return runTenantAction(slug, async ({ ctx, routes }) => {
    await moveCatalogItemPhoto(ctx, photoId, move);
    return {
      revalidate: section(routes.catalog.list()),
      success: move === 'first' ? 'photos.coverSet' : 'photos.moved',
    };
  });
}
