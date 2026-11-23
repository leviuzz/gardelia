import { describe, expect, it } from 'vitest';
import { namespacedKey } from '@/lib/actions';

/**
 * Testi dei moduli nel loro namespace (ADR-060): un codice con il prefisso del modulo si cerca in
 * `<modulo>.conflict.*` o `<modulo>.validation.*` quando non è fra i testi generali.
 */
describe('chiavi dei testi per modulo', () => {
  it('il prefisso diventa il namespace del modulo', () => {
    expect(namespacedKey('inventory_insufficient_stock', 'conflict')).toBe(
      'inventory.conflict.insufficient_stock',
    );
    expect(namespacedKey('inventory_none_selected', 'validation')).toBe(
      'inventory.validation.none_selected',
    );
  });

  it('un codice senza prefisso non ha un namespace', () => {
    expect(namespacedKey('required', 'validation')).toBeNull();
    expect(namespacedKey('Inventory_x', 'conflict')).toBeNull();
  });
});
