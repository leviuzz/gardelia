import { describe, expect, it } from 'vitest';
import { aggregateProduction } from '../src/index';

const rose = { name: 'Rosa roja', variety: 'Freedom', saleUnit: 'STEM' as const };

describe('producción del día', () => {
  it('somma le distinte per il numero di ramos, articoli sciolti e righe libere a parte', () => {
    const summary = aggregateProduction([
      {
        kind: 'CATALOG_ITEM',
        description: 'Ramo Clásico',
        quantity: 2,
        item: null,
        recipe: [
          { ...rose, quantity: 12 },
          { name: 'Eucalipto', variety: 'baby blue', quantity: 1, saleUnit: 'BUNCH' },
        ],
      },
      {
        kind: 'BUILDER',
        description: 'Ramo para Ana',
        quantity: 1,
        item: null,
        recipe: [
          { ...rose, quantity: 6 },
          { name: 'Papel coreano', variety: null, quantity: 1, saleUnit: 'PIECE', color: 'pink' },
        ],
      },
      {
        kind: 'CATALOG_ITEM',
        description: 'Rosa roja · Freedom',
        quantity: 5,
        item: rose,
        recipe: null,
      },
      { kind: 'CUSTOM', description: 'Globo metálico', quantity: 1, item: null, recipe: null },
      { kind: 'CUSTOM', description: 'Globo metálico', quantity: 2, item: null, recipe: null },
    ]);
    expect(summary.bouquets).toBe(3);
    expect(summary.items).toEqual([
      { name: 'Eucalipto', variety: 'baby blue', color: null, saleUnit: 'BUNCH', quantity: 2 },
      { name: 'Papel coreano', variety: null, color: 'pink', saleUnit: 'PIECE', quantity: 1 },
      { name: 'Rosa roja', variety: 'Freedom', color: null, saleUnit: 'STEM', quantity: 35 },
    ]);
    expect(summary.custom).toEqual([{ description: 'Globo metálico', quantity: 3 }]);
  });

  it('colori diversi restano righe diverse; un giorno senza ordini è vuoto', () => {
    const paper = { name: 'Papel', variety: null, quantity: 1, saleUnit: 'PIECE' as const };
    const summary = aggregateProduction([
      {
        kind: 'BUILDER',
        description: 'A',
        quantity: 1,
        item: null,
        recipe: [{ ...paper, color: 'red' }],
      },
      {
        kind: 'BUILDER',
        description: 'B',
        quantity: 1,
        item: null,
        recipe: [{ ...paper, color: 'white' }],
      },
    ]);
    expect(summary.items.map((item) => item.color)).toEqual(['red', 'white']);
    expect(aggregateProduction([])).toEqual({ items: [], bouquets: 0, custom: [] });
  });
});
