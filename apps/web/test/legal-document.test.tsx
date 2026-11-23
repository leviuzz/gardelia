import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalDocument, legalTitle } from '@/components/legal/legal-document';
import { LEGAL_TEXTS } from '@/content/legal.generated';

/** I testi legali come pagina (ADR-068): struttura, collegamenti, nessun HTML interpretato. */
describe('documento legale', () => {
  const markdown = [
    '# Aviso',
    '',
    '> **BORRADOR.** Por revisar.',
    '',
    '## 1. Datos',
    '',
    'Ver los [Términos](./terminos-compradores.md) y [PROFECO](https://www.gob.mx/profeco).',
    '',
    '1. uno',
    '2. dos',
    '',
    '| Proveedor | Dónde |',
    '| --------- | ----- |',
    '| Vercel    | EUA   |',
    '',
    '<script>alert(1)</script>',
  ].join('\n');

  it("titoli, avviso, liste, tabelle e collegamenti alle pagine dell'app", () => {
    const html = renderToStaticMarkup(<LegalDocument markdown={markdown} />);
    expect(html).toContain('<h1');
    expect(html).toContain('<h2');
    expect(html).toContain('role="note"');
    expect(html).toContain('<ol');
    expect(html).toContain('<table');
    expect(html).toContain('href="/terminos/compradores"');
    expect(html).toMatch(/href="https:\/\/www\.gob\.mx\/profeco"[^>]*rel="noopener noreferrer"/);
    // L'HTML nel testo si mostra come testo, mai come codice.
    expect(html).not.toContain('<script>');
    expect(legalTitle(markdown)).toBe('Aviso');
  });

  it('i documenti veri si leggono tutti, con il loro titolo', () => {
    for (const text of Object.values(LEGAL_TEXTS)) {
      const html = renderToStaticMarkup(<LegalDocument markdown={text} />);
      expect(html).toContain('<h1');
      expect(legalTitle(text).length).toBeGreaterThan(5);
      expect(html).not.toContain('.md"');
    }
  });
});
