/** Chiavi dei file senza fondo delle foto del catalogo (ADR-033), accanto all'originale. */

export function cutoutKeyFor(tenantId: string, photoId: string): string {
  return `tenants/${tenantId}/catalog-photos/${photoId}-cutout.png`;
}

/** Chiave della miniatura del ritaglio, derivata da quella del ritaglio. */
export function cutoutThumbKey(cutoutKey: string): string {
  return cutoutKey.replace(/-cutout\.png$/, '-cutout-thumb.png');
}
