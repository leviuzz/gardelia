import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Convenzioni del web controllate in automatico (CLAUDE.md §4.6, PLATFORM_PLAN §5): una server
 * action nuova che salta il contesto della fioreria, o un percorso scritto a mano, fanno fallire
 * i test invece di arrivare in produzione.
 */
const src = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const read = (file: string) => readFileSync(file, 'utf8');

describe('convenzioni del web', () => {
  it('ogni server action della fioreria passa da runTenantAction (contesto per primo)', () => {
    const actionFiles = sourceFiles(join(src, 'app/app/[tenantSlug]')).filter((file) =>
      read(file).startsWith("'use server';"),
    );
    expect(actionFiles.length).toBeGreaterThanOrEqual(7);

    const problems: string[] = [];
    for (const file of actionFiles) {
      const text = read(file);
      const where = relative(src, file);
      // Solo funzioni dichiarate: un `export const` sfuggirebbe al controllo qui sotto.
      if (/^export (const|let|default|\{)/m.test(text))
        problems.push(`${where}: export non ammesso`);
      const actions = text.split(/^export async function /m).slice(1);
      if (actions.length === 0) problems.push(`${where}: nessuna azione`);
      for (const body of actions) {
        const name = body.slice(0, body.indexOf('('));
        if (!/^\s*return runTenantAction\(slug, /m.test(body)) problems.push(`${where}: ${name}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('nessun percorso /app/… scritto a mano fuori da lib/routes.ts', () => {
    const offenders = sourceFiles(src)
      .filter((file) => !file.endsWith(join('lib', 'routes.ts')))
      .filter((file) => /`\/app\/\$\{/.test(read(file)))
      .map((file) => relative(src, file));
    expect(offenders).toEqual([]);
  });
});
