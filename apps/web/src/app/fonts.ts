import localFont from 'next/font/local';

/**
 * Font self-hosted (pacchetti @fontsource, nessuna richiesta a servizi esterni a runtime
 * né in build). Inter per l'interfaccia, Fraunces per i titoli.
 */
export const inter = localFont({
  src: '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
});

export const fraunces = localFont({
  src: '../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2',
  variable: '--font-fraunces',
  weight: '100 900',
  display: 'swap',
});
