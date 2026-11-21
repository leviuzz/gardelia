import { describe, expect, it } from 'vitest';
import { isUuid, newId } from '../src/ids';
import { baseSlugFor, isValidSlug, slugWithSuffix, slugify } from '../src/slug';

describe('slug dei tenant', () => {
  it('normalizza accenti, simboli e spazi', () => {
    expect(slugify('Florería Las Camelias')).toBe('floreria-las-camelias');
    expect(slugify('  Rosas & Lirios  ')).toBe('rosas-y-lirios');
    expect(slugify('Ñandú Flores!!')).toBe('nandu-flores');
  });

  it('rifiuta slug riservati o troppo corti', () => {
    expect(isValidSlug('admin')).toBe(false);
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('las-camelias')).toBe(true);
    expect(isValidSlug('las--camelias')).toBe(false);
  });

  it('usa un fallback leggibile quando il nome non basta', () => {
    expect(baseSlugFor('Admin')).toBe('admin-floreria');
    expect(baseSlugFor('!!!')).toBe('floreria');
    expect(isValidSlug(baseSlugFor('Admin'))).toBe(true);
  });

  it('aggiunge suffissi senza superare la lunghezza massima', () => {
    expect(slugWithSuffix('las-camelias', 1)).toBe('las-camelias');
    expect(slugWithSuffix('las-camelias', 2)).toBe('las-camelias-2');
    const long = 'a'.repeat(48);
    expect(slugWithSuffix(long, 12)).toHaveLength(48);
    expect(slugWithSuffix(long, 12).endsWith('-12')).toBe(true);
  });
});

describe('UUID v7', () => {
  it('genera UUID validi di versione 7', () => {
    const id = newId();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('codifica il timestamp: ID successivi sono ordinabili', () => {
    const earlier = newId(1_700_000_000_000);
    const later = newId(1_700_000_000_001);
    expect(earlier < later).toBe(true);
    expect(earlier.slice(0, 13)).toBe('018bcfe5-6800');
  });
});
