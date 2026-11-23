import { describe, expect, it } from 'vitest';
// @ts-expect-error -- script Node in JavaScript, senza tipi.
import { readLegalSources } from '../scripts/sync-legal.mjs';
import { LEGAL_TEXTS } from '../src/content/legal.generated';

/** Le pagine legali mostrano esattamente i testi di `docs/legal/` (ADR-068). */
describe("testi legali nell'app", () => {
  it('sono quelli di docs/legal (altrimenti: pnpm --filter @floral/web legal:sync)', () => {
    expect(LEGAL_TEXTS).toEqual(readLegalSources());
  });
});
