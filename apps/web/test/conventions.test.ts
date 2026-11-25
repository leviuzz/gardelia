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

/** Tag di apertura `<form …>` di un file JSX, anche su più righe e con `=>` negli attributi. */
function formTags(text: string): string[] {
  const tags: string[] = [];
  for (const match of text.matchAll(/<form\b/g)) {
    let depth = 0;
    for (let i = match.index; i < text.length; i += 1) {
      const char = text[i];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) {
        tags.push(text.slice(match.index, i + 1).replace(/\s+/g, ' '));
        break;
      }
    }
  }
  return tags;
}

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

  it('ogni server action di "Mi cuenta" passa da runBuyerAction (persona dalla sessione per prima)', () => {
    const actionFiles = sourceFiles(join(src, 'app/cuenta')).filter((file) =>
      read(file).startsWith("'use server';"),
    );
    expect(actionFiles.length).toBeGreaterThanOrEqual(2);
    const problems: string[] = [];
    for (const file of actionFiles) {
      const text = read(file);
      const where = relative(src, file);
      if (/^export (const|let|default|\{)/m.test(text)) {
        problems.push(`${where}: export non ammesso`);
      }
      const actions = text.split(/^export async function /m).slice(1);
      if (actions.length === 0) problems.push(`${where}: nessuna azione`);
      for (const body of actions) {
        const name = body.slice(0, body.indexOf('('));
        // L'invito si accetta con il suo percorso: la riga prima del return lo calcola.
        if (!/^\s*return runBuyerAction\(/m.test(body)) problems.push(`${where}: ${name}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('i moduli gestiti solo in JavaScript usano POST: prima dell’idratazione niente dati nell’URL', () => {
    // Un `<form onSubmit>` senza `action` inviato prima che React colleghi i gestori parte come
    // modulo HTML: con il GET predefinito email e password finirebbero nell'indirizzo (cronologia,
    // log dell'hosting). I moduli con `action` (server action) funzionano anche senza JavaScript.
    const offenders: string[] = [];
    let clientForms = 0;
    for (const file of sourceFiles(src).filter((path) => path.endsWith('.tsx'))) {
      for (const tag of formTags(read(file))) {
        if (!tag.includes('onSubmit=') || /\saction=/.test(tag)) continue;
        clientForms += 1;
        if (!/\smethod="post"/.test(tag)) offenders.push(`${relative(src, file)}: ${tag}`);
      }
    }
    expect(clientForms).toBeGreaterThanOrEqual(7);
    expect(offenders).toEqual([]);
  });

  it('nessun percorso /app/… scritto a mano fuori da lib/routes.ts', () => {
    const offenders = sourceFiles(src)
      .filter((file) => !file.endsWith(join('lib', 'routes.ts')))
      .filter((file) => /`\/app\/\$\{/.test(read(file)))
      .map((file) => relative(src, file));
    expect(offenders).toEqual([]);
  });
});
