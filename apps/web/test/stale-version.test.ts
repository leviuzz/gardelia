import { describe, expect, it } from 'vitest';
import { isStaleVersionError } from '@/lib/stale-version';

/** Pagina aperta prima di un rilascio: si riconosce per offrire di ricaricare, non "Algo salió mal". */
describe('isStaleVersionError', () => {
  const named = (name: string, message = 'x') => Object.assign(new Error(message), { name });

  it('azione che il server non conosce più e pezzi di JavaScript spariti dopo un rilascio', () => {
    expect(isStaleVersionError(named('UnrecognizedActionError'))).toBe(true);
    expect(isStaleVersionError(named('ChunkLoadError'))).toBe(true);
    expect(isStaleVersionError(new Error('Loading chunk 4821 failed.'))).toBe(true);
    expect(isStaleVersionError(new Error('Loading CSS chunk app/layout failed'))).toBe(true);
  });

  it('gli altri errori restano errori', () => {
    expect(isStaleVersionError(new Error('Algo salió mal'))).toBe(false);
    expect(isStaleVersionError(named('TypeError', 'x is undefined'))).toBe(false);
    expect(isStaleVersionError('UnrecognizedActionError')).toBe(false);
    expect(isStaleVersionError(null)).toBe(false);
  });
});
