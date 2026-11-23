/**
 * Copia i testi legali (`docs/legal/*.md`, la fonte che rivede l'avvocato) nel modulo che l'app
 * mostra alle pagine `/privacidad`, `/terminos` e `/terminos/compradores` (ADR-068). Così le pagine
 * non leggono file a runtime (su Vercel non ci sarebbero) e `test/legal-content.test.ts` fallisce se
 * qualcuno cambia un testo senza rilanciare questo script:
 *
 *   pnpm --filter @floral/web legal:sync
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LEGAL_SOURCES = {
  privacy: 'aviso-de-privacidad.md',
  terms: 'terminos-y-condiciones.md',
  buyerTerms: 'terminos-compradores.md',
};

const docs = new URL('../../../docs/legal/', import.meta.url);

export function readLegalSources() {
  return Object.fromEntries(
    Object.entries(LEGAL_SOURCES).map(([key, file]) => [
      key,
      readFileSync(new URL(file, docs), 'utf8'),
    ]),
  );
}

function generate() {
  const texts = readLegalSources();
  const body = Object.entries(texts)
    .map(([key, text]) => `  ${key}: ${JSON.stringify(text)},`)
    .join('\n');
  const out = `// Generato da scripts/sync-legal.mjs da docs/legal/*.md: NON modificare a mano.
export const LEGAL_TEXTS = {
${body}
} as const;

export type LegalDocumentKey = keyof typeof LEGAL_TEXTS;
`;
  writeFileSync(new URL('../src/content/legal.generated.ts', import.meta.url), out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) generate();
