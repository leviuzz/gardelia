import type { Metadata } from 'next';

/**
 * Pagine pubbliche e Google (marketplace, M1-2, ADR-087). Regole pure, provate in
 * `test/indexing.test.ts`; l'interruttore è `PUBLIC_INDEXING` (acceso solo in produzione).
 *
 * - Spento: ogni pagina `noindex, nofollow` (come il layout) e robots.txt chiude tutto.
 * - Acceso: home, `/floristas`, vetrine e prodotti si indicizzano; le viste filtrate o le pagine
 *   dopo la prima no, ma Google segue i loro link e il canonico porta alla vetrina intera.
 * - Il canonico c'è sempre, così le anteprime su WhatsApp e i motori puntano a un indirizzo solo.
 */
export function publicPageIndexing(input: {
  readonly enabled: boolean;
  readonly appUrl: string;
  /** Percorso canonico (la vetrina intera per le sue viste filtrate). */
  readonly canonicalPath: string;
  /** La pagina stessa va su Google (non una vista filtrata o una pagina dopo la prima). */
  readonly indexable: boolean;
}): Pick<Metadata, 'robots' | 'alternates'> {
  return {
    robots: input.enabled
      ? { index: input.indexable, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: absoluteUrl(input.appUrl, input.canonicalPath) },
  };
}

export function absoluteUrl(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

/** Le regole di robots.txt: tutto chiuso da spento; da acceso, fuori l'app, i conti e i token. */
export function robotsRules(input: { readonly enabled: boolean; readonly appUrl: string }) {
  if (!input.enabled) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/app/',
        '/api/',
        '/cuenta',
        '/buscar/ir/',
        '/pedido/',
        '/f/*/pedido',
        '/cotizacion/',
        '/visita/',
        '/invite/',
        '/unsubscribe',
      ],
    },
    sitemap: absoluteUrl(input.appUrl, '/sitemap.xml'),
  };
}
