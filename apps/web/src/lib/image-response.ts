import 'server-only';

/**
 * Risposta per un'immagine privata servita dall'app (foto del catalogo, Mis ramos, anteprime
 * AI). Il file di un ID non cambia mai: cache privata del browser, mai condivisa.
 */
export function privateImageResponse(image: { bytes: Uint8Array; contentType: string }): Response {
  return new Response(Buffer.from(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

/** `?size=thumb` → miniatura; qualsiasi altro valore → versione grande. */
export function photoVariant(request: Request): 'thumb' | 'full' {
  return new URL(request.url).searchParams.get('size') === 'thumb' ? 'thumb' : 'full';
}

export const notFoundResponse = () => new Response('Not found', { status: 404 });
