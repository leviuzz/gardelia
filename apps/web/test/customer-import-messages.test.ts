import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_IMPORT_FIELDS,
  ENABLED_LOCALES,
  suggestCustomerImportMapping,
} from '@floral/domain';

/**
 * Import di clienti (ADR-070): il modello da scaricare ha come intestazione i nomi dei dati nella
 * lingua di chi lo usa; ricaricato così com'è, ogni colonna deve essere riconosciuta da sola.
 */
describe('intestazioni del modello di import', () => {
  for (const locale of ENABLED_LOCALES) {
    it(`si riconoscono da sole (${locale})`, () => {
      const messages = JSON.parse(
        readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'),
      ) as { customers: { import: { fields: Record<string, string> } } };
      const labels = CUSTOMER_IMPORT_FIELDS.map(
        (field) => messages.customers.import.fields[field] ?? '',
      );
      expect(suggestCustomerImportMapping(labels)).toEqual([...CUSTOMER_IMPORT_FIELDS]);
    });
  }
});
