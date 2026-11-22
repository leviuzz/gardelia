import { readFileSync } from 'node:fs';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, ENABLED_LOCALES } from '@floral/domain';

/**
 * Le lingue dell'interfaccia (ADR-042) devono restare allineate: un testo aggiunto solo in
 * spagnolo, o una traduzione che perde un argomento (`{name}`) o un plurale, fa fallire il test
 * invece di mostrare una chiave grezza o un messaggio rotto a chi usa l'italiano o l'inglese.
 */
type Messages = { readonly [key: string]: string | Messages };

function load(locale: string): Messages {
  return JSON.parse(
    readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'),
  ) as Messages;
}

function flatten(messages: Messages, prefix = '', out = new Map<string, string>()) {
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else flatten(value, path, out);
  }
  return out;
}

/** Argomenti, plurali/select (con i rami obbligatori) e tag di un messaggio ICU. */
function signature(message: string): string {
  const parts = new Set<string>();
  const walk = (elements: readonly MessageFormatElement[]) => {
    for (const element of elements) {
      switch (element.type) {
        case TYPE.argument:
        case TYPE.number:
        case TYPE.date:
        case TYPE.time:
          parts.add(`${element.value}:${element.type}`);
          break;
        case TYPE.plural:
        case TYPE.select: {
          const required = Object.keys(element.options)
            .filter((option) => option === 'other' || option.startsWith('='))
            .sort()
            .join('|');
          parts.add(`${element.value}:${element.type}:${required}`);
          for (const option of Object.values(element.options)) walk(option.value);
          break;
        }
        case TYPE.tag:
          parts.add(`<${element.value}>`);
          walk(element.children);
          break;
        default:
          break;
      }
    }
  };
  walk(parse(message));
  return [...parts].sort().join(', ');
}

const reference = flatten(load(DEFAULT_LOCALE));

describe('testi dell’interfaccia nelle lingue abilitate', () => {
  it('es-MX è la lingua di riferimento ed è abilitata con almeno un’altra lingua', () => {
    expect(ENABLED_LOCALES).toContain(DEFAULT_LOCALE);
    expect(ENABLED_LOCALES.length).toBeGreaterThan(1);
    expect(reference.size).toBeGreaterThan(900);
  });

  for (const locale of ENABLED_LOCALES.filter((code) => code !== DEFAULT_LOCALE)) {
    describe(locale, () => {
      const translated = flatten(load(locale));

      it('stesse chiavi di es-MX, nessun testo vuoto', () => {
        const missing = [...reference.keys()].filter((key) => !translated.has(key));
        const extra = [...translated.keys()].filter((key) => !reference.has(key));
        const empty = [...translated].filter(([, value]) => value.trim() === '').map(([k]) => k);
        expect({ missing, extra, empty }).toEqual({ missing: [], extra: [], empty: [] });
      });

      it('stessi argomenti, plurali e tag di es-MX (messaggi ICU validi)', () => {
        const different: string[] = [];
        for (const [key, source] of reference) {
          const target = translated.get(key);
          if (target === undefined) continue;
          let targetSignature: string;
          try {
            targetSignature = signature(target);
          } catch (error) {
            different.push(`${key}: messaggio non valido (${String(error)})`);
            continue;
          }
          if (targetSignature !== signature(source)) different.push(key);
        }
        expect(different).toEqual([]);
      });
    });
  }
});
