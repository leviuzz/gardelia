import localFont from 'next/font/local';

/**
 * Font self-hosted (pacchetto @fontsource, nessuna richiesta a servizi esterni a runtime né in
 * build): Roboto per tutta l'interfaccia, testi e titoli (richiesta del founder, 22/11/2026).
 */
export const roboto = localFont({
  src: '../../node_modules/@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2',
  variable: '--font-roboto',
  weight: '100 900',
  display: 'swap',
});
