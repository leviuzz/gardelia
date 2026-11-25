import { describe, expect, it } from 'vitest';
import { publicPageIndexing, robotsRules } from '@/lib/indexing';

/** Pagine pubbliche e Google (M1-2, ADR-087): indicizzate solo con PUBLIC_INDEXING acceso. */
describe('quando una pagina va su Google', () => {
  const appUrl = 'https://gardelia.example/';

  it('spento (staging): niente indice né link seguiti, robots.txt chiude tutto', () => {
    expect(
      publicPageIndexing({ enabled: false, appUrl, canonicalPath: '/f/flores', indexable: true }),
    ).toEqual({
      robots: { index: false, follow: false },
      alternates: { canonical: 'https://gardelia.example/f/flores' },
    });
    expect(robotsRules({ enabled: false, appUrl })).toEqual({
      rules: { userAgent: '*', disallow: '/' },
    });
  });

  it('acceso: la vetrina intera sì, le viste filtrate no ma con i link seguiti', () => {
    expect(
      publicPageIndexing({ enabled: true, appUrl, canonicalPath: '/f/flores', indexable: true })
        .robots,
    ).toEqual({ index: true, follow: true });
    expect(
      publicPageIndexing({ enabled: true, appUrl, canonicalPath: '/f/flores', indexable: false })
        .robots,
    ).toEqual({ index: false, follow: true });
  });

  it('acceso: robots.txt apre le pagine pubbliche, tiene fuori app, conti e token, dà la sitemap', () => {
    const rules = robotsRules({ enabled: true, appUrl });
    expect(rules.sitemap).toBe('https://gardelia.example/sitemap.xml');
    const disallow = 'disallow' in rules.rules ? rules.rules.disallow : [];
    expect(disallow).toEqual(expect.arrayContaining(['/app/', '/api/', '/cuenta', '/f/*/pedido']));
  });
});
