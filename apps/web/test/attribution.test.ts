import { describe, expect, it } from 'vitest';
import { foundSlugs, isStoreSlug, withFoundSlug } from '@/lib/attribution';

/** Cookie dell'attribuzione degli ordini online (ADR-067). */
describe('attribuzione dalla ricerca', () => {
  it('ricorda le tiendas aperte dalla ricerca, la più recente per prima, senza doppioni', () => {
    let cookie = withFoundSlug(undefined, 'las-camelias');
    cookie = withFoundSlug(cookie, 'flores-lupita');
    cookie = withFoundSlug(cookie, 'las-camelias');
    expect(foundSlugs(cookie)).toEqual(['las-camelias', 'flores-lupita']);
  });

  it('ignora valori manomessi e non supera 20 tiendas', () => {
    expect(foundSlugs('../x.LAS.ok-slug.<script>')).toEqual(['ok-slug']);
    let cookie: string | undefined;
    for (let index = 0; index < 25; index += 1) cookie = withFoundSlug(cookie, `tienda-${index}`);
    expect(foundSlugs(cookie)).toHaveLength(20);
    expect(foundSlugs(cookie)[0]).toBe('tienda-24');
    expect(isStoreSlug('a')).toBe(true);
    expect(isStoreSlug('-a')).toBe(false);
  });
});
