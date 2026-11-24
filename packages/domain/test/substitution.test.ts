import { describe, expect, it } from 'vitest';
import {
  canSubstitute,
  orderSubstitutionSchema,
  rankSubstitutes,
  substitutionMode,
  type SubstituteItem,
} from '../src/index';

/** Sostituto quando manca un fiore (ADR-081). */

const ROSA = '0193a1b2-0000-7000-8000-00000000aaaa';
let next = 0;
function item(overrides: Partial<SubstituteItem> = {}): SubstituteItem {
  next += 1;
  return {
    id: `0193a1b2-0000-7000-8000-${String(next).padStart(12, '0')}`,
    type: 'CUT_FLOWER',
    name: 'Rosa',
    variety: null,
    canonicalFlowerId: null,
    colors: [],
    saleUnit: 'STEM',
    priceMinor: 3500,
    availability: 'AVAILABLE',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('regola della riga', () => {
  it('ramos del catalogo con la loro politica; il Diseñador chiede sempre', () => {
    expect(substitutionMode({ kind: 'CATALOG_ITEM' }, 'SIMILAR_ALLOWED')).toBe('ALLOWED');
    expect(substitutionMode({ kind: 'CATALOG_ITEM' }, 'NOT_ALLOWED')).toBe('NOT_ALLOWED');
    expect(substitutionMode({ kind: 'CATALOG_ITEM' }, 'ASK_CUSTOMER')).toBe('ASK_CUSTOMER');
    // Ramo senza ricetta salvata: il default della ricetta (chiedere).
    expect(substitutionMode({ kind: 'CATALOG_ITEM' }, null)).toBe('ASK_CUSTOMER');
    expect(substitutionMode({ kind: 'BUILDER' }, 'SIMILAR_ALLOWED')).toBe('ASK_CUSTOMER');
  });
});

describe('sostituti proposti', () => {
  const missing = item({
    variety: 'Freedom',
    canonicalFlowerId: ROSA,
    colors: ['red'],
    priceMinor: 3500,
  });

  it('stessa specie, poi stesso colore, poi il prezzo più vicino', () => {
    const explorer = item({ variety: 'Explorer', canonicalFlowerId: ROSA, priceMinor: 4500 });
    const mondial = item({ variety: 'Mondial', canonicalFlowerId: ROSA, priceMinor: 3600 });
    const carnation = item({ name: 'Clavel', colors: ['red'], priceMinor: 1500 });
    const tulip = item({ name: 'Tulipán', colors: ['pink'] });
    const ranked = rankSubstitutes(missing, [carnation, tulip, explorer, mondial], {
      inRecipe: new Set([missing.id]),
    });
    expect(ranked.map((entry) => [entry.item.variety ?? entry.item.name, entry.reason])).toEqual([
      ['Mondial', 'SAME_SPECIES'],
      ['Explorer', 'SAME_SPECIES'],
      ['Clavel', 'SAME_COLOR'],
    ]);
  });

  it('mai agotados, archiviati, altre unità o tipi, né quelli già nel ramo o senza merce', () => {
    const inRecipe = item({ variety: 'Vendela', canonicalFlowerId: ROSA });
    const candidates = [
      item({ variety: 'Agotada', canonicalFlowerId: ROSA, availability: 'OUT_OF_STOCK' }),
      item({ variety: 'Archivada', canonicalFlowerId: ROSA, status: 'ARCHIVED' }),
      item({ variety: 'Manojo', canonicalFlowerId: ROSA, saleUnit: 'BUNCH' }),
      item({ type: 'PLANT', saleUnit: 'STEM', canonicalFlowerId: ROSA, variety: 'Planta' }),
      inRecipe,
      item({ variety: 'Sin merce', canonicalFlowerId: ROSA }),
      item({ variety: 'Pocas', canonicalFlowerId: ROSA, availability: 'LIMITED' }),
    ];
    const ranked = rankSubstitutes(missing, candidates, {
      inRecipe: new Set([missing.id, inRecipe.id]),
      enough: (id) => id !== candidates[5]!.id,
    });
    expect(ranked.map((entry) => entry.item.variety)).toEqual(['Pocas']);
  });

  it('il verde e i materiali si sostituiscono con lo stesso tipo; i fiori no', () => {
    const eucalyptus = item({ type: 'FOLIAGE', saleUnit: 'BUNCH', name: 'Eucalipto' });
    const ruscus = item({ type: 'FOLIAGE', saleUnit: 'BUNCH', name: 'Ruscus' });
    expect(
      rankSubstitutes(eucalyptus, [ruscus], { inRecipe: new Set() }).map((e) => e.reason),
    ).toEqual(['SAME_KIND']);
    const gerbera = item({ name: 'Gerbera', colors: ['yellow'] });
    expect(rankSubstitutes(missing, [gerbera], { inRecipe: new Set() })).toEqual([]);
    expect(canSubstitute(missing, gerbera, new Set())).toBe(true);
  });

  it('al massimo quattro', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      item({ variety: `V${index}`, canonicalFlowerId: ROSA }),
    );
    expect(rankSubstitutes(missing, many, { inRecipe: new Set() })).toHaveLength(4);
  });
});

describe('form "Cambiar flor"', () => {
  it('serve il sostituto; l’ok del cliente è una casella', () => {
    const base = { lineId: ROSA, fromItemId: ROSA };
    expect(
      orderSubstitutionSchema.safeParse({ ...base, toItemId: '' }).error?.issues[0]?.message,
    ).toBe('substitute_required');
    expect(
      orderSubstitutionSchema.parse({ ...base, toItemId: ROSA, customerAgreed: 'on' })
        .customerAgreed,
    ).toBe(true);
    expect(orderSubstitutionSchema.parse({ ...base, toItemId: ROSA }).customerAgreed).toBe(false);
  });
});
