import type * as React from 'react';

type PrivateImageProps = Omit<React.ComponentProps<'img'>, 'src' | 'alt'> & {
  /** URL di una route autenticata della fioreria (lib/private-image-route.ts). */
  readonly src: string;
  /** Testo alternativo obbligatorio: "" solo se l'immagine è decorativa. */
  readonly alt: string;
};

/**
 * Immagine privata della fioreria (foto, ritagli, anteprime, boceto): arriva dalle nostre route
 * autenticate, quindi niente `next/image` (il suo ottimizzatore non vede la sessione). Caricamento
 * pigro predefinito (per le pagine da stampare usare `loading="eager"`) e decodifica asincrona.
 */
export function PrivateImage({ src, alt, loading = 'lazy', ...props }: PrivateImageProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- immagine privata servita da una route autenticata
    <img src={src} alt={alt} loading={loading} decoding="async" {...props} />
  );
}
