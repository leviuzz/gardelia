/** Rigenera il foglio di revisione dei fiori (O-09, ADR-081) da `src/reference-data.ts`. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { flowerReviewMarkdown } from '../src/flower-review';

const target = fileURLToPath(new URL('../../../docs/LISTA_FLORES_REVISION.md', import.meta.url));
writeFileSync(target, flowerReviewMarkdown());
console.info(`Foglio di revisione scritto in ${target}`);
