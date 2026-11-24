import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flowerReviewMarkdown } from '../src/flower-review';
import { CANONICAL_FLOWERS } from '../src/reference-data';

/** Il foglio di revisione dei fiori (O-09, ADR-081) segue l'elenco: niente fogli vecchi in giro. */
describe('lista de flores para revisión', () => {
  it('è aggiornata con l’elenco (rigenerare con `pnpm --filter @floral/db flowers:review`)', () => {
    const onDisk = readFileSync(
      new URL('../../../docs/LISTA_FLORES_REVISION.md', import.meta.url),
      'utf8',
    );
    expect(onDisk).toBe(flowerReviewMarkdown());
  });

  it('una riga per specie, in spagnolo', () => {
    const markdown = flowerReviewMarkdown();
    for (const flower of CANONICAL_FLOWERS) {
      expect(markdown).toContain(`| ${flower.names['es-MX']} |`);
    }
    expect(markdown).toContain(`Total: ${CANONICAL_FLOWERS.length} especies.`);
  });
});
