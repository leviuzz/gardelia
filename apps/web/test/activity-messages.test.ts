import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, ENABLED_LOCALES } from '@floral/domain';
import { activityMessageKey } from '../src/lib/activity-key';

/**
 * "Actividad reciente" della dashboard: ogni azione registrata per una fioreria deve avere il suo
 * testo in ogni lingua. next-intl legge le chiavi col punto come annidamento: una chiave scritta
 * "customer.created" in un solo livello non si trova mai e la voce mostrava il testo generico.
 */
type Messages = { readonly [key: string]: string | Messages };

function load(locale: string): Messages {
  return JSON.parse(
    readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'),
  ) as Messages;
}

function dottedKeys(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}/${key}` : key;
    const own = key.includes('.') ? [path] : [];
    return typeof value === 'string' ? own : [...own, ...dottedKeys(value, path)];
  });
}

/** Eventi di piattaforma e di sicurezza: non appartengono a una fioreria, non compaiono. */
const PLATFORM_PREFIXES = ['security.', 'platform.'];

const VALUES = {
  actor: 'Ana',
  name: 'Ramo',
  ingredient: 'Rosa',
  role: 'Staff',
  number: 'P-0001',
  status: 'Listo',
  plan: 'Plus',
  units: 2,
  lines: 1,
  count: 3,
};

describe('testi di "Actividad reciente"', () => {
  for (const locale of ENABLED_LOCALES) {
    const messages = load(locale);

    it(`nessuna chiave col punto (${locale})`, () => {
      expect(dottedKeys(messages)).toEqual([]);
    });

    it(`ogni azione di una fioreria ha il suo testo (${locale})`, () => {
      // Chiavi costruite a runtime, come nella dashboard: niente tipi dedotti dai messaggi.
      const t = createTranslator({ locale, messages }) as unknown as {
        (key: string, values: Readonly<Record<string, string | number>>): string;
        has: (key: string) => boolean;
      };
      const missing = Object.values(AUDIT_ACTIONS)
        .filter((action) => !PLATFORM_PREFIXES.some((prefix) => action.startsWith(prefix)))
        .filter((action) => {
          const key = activityMessageKey(action, (candidate) => t.has(candidate));
          return key === null || t(key, VALUES).includes('{');
        });
      expect(missing).toEqual([]);
    });
  }
});
