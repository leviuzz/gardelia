import 'server-only';

/**
 * Risposta per un'immagine privata servita dall'app (foto del catalogo, Mis ramos, anteprime
 * AI). Il file di un ID non cambia mai: cache privata del browser, mai condivisa.
 */
export function privateImageResponse(
  image: { bytes: Uint8Array; contentType: string },
  options: { readonly downloadName?: string } = {},
): Response {
  const extension =
    image.contentType === 'image/png' ? 'png' : image.contentType === 'image/webp' ? 'webp' : 'jpg';
  return new Response(Buffer.from(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // Nome del file per "Descargar": solo lettere, numeri e trattini.
      ...(options.downloadName
        ? {
            'Content-Disposition': `attachment; filename="${options.downloadName.replace(/[^a-z0-9-]/gi, '')}.${extension}"`,
          }
        : {}),
    },
  });
}

/** `?size=thumb` → miniatura; qualsiasi altro valore → versione grande. */
export function photoVariant(request: Request): 'thumb' | 'full' {
  return new URL(request.url).searchParams.get('size') === 'thumb' ? 'thumb' : 'full';
}

const CATALOG_PHOTO_VARIANTS = ['thumb', 'full', 'cutout', 'cutout-thumb'] as const;

/**
 * Foto del catalogo: anche `?size=cutout` / `cutout-thumb` (versione senza fondo, ADR-033).
 * Valori sconosciuti → versione grande.
 */
export function catalogPhotoVariant(request: Request): (typeof CATALOG_PHOTO_VARIANTS)[number] {
  const size = new URL(request.url).searchParams.get('size');
  return CATALOG_PHOTO_VARIANTS.find((variant) => variant === size) ?? 'full';
}

export const notFoundResponse = () => new Response('Not found', { status: 404 });
