import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Convenzioni dei servizi controllate in automatico (ADR-075 §8): un `TenantContext` nasce SOLO da
 * `resolveTenantContext` (context.ts). Un lavoro senza utente usa un `JobScope` (scope.ts), mai un
 * contesto finto costruito con un cast.
 */
const roots = [
  fileURLToPath(new URL('../src', import.meta.url)),
  fileURLToPath(new URL('../../../apps/web/src', import.meta.url)),
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('convenzioni dei servizi', () => {
  it('nessun cast a TenantContext fuori da context.ts', () => {
    const problems: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        if (file.endsWith(join('core', 'src', 'context.ts'))) continue;
        const text = readFileSync(file, 'utf8');
        // Il cast nel codice, non nei commenti: righe che non iniziano con un commento.
        const code = text
          .split('\n')
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
          .join('\n');
        if (/\bas\s+(unknown\s+as\s+)?TenantContext\b/.test(code)) {
          problems.push(relative(join(roots[0]!, '..', '..', '..'), file));
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
