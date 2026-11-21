import { describe, expect, it } from 'vitest';
import { diffFields } from '../src/audit';
import { catalogItemFormSchema, catalogItemInputSchema, catalogListFiltersSchema } from '../src/catalog';
import { computeRecipeCosting, recipeDetailsFormSchema, recipeLineFormSchema } from '../src/recipe';
import { toFieldErrors } from '../src/validation';

describe('form articolo di catalogo', () => {
  const schema = catalogItemFormSchema('MXN');
  const valid = {
    type: 'CUT_FLOWER',
    name: ' Rosa roja Freedom ',
    description: '',
    sku: 'ROS-ROJ-01',
    canonicalFlowerId: '',
    variety: 'Freedom',
    colors: ['red'],
    saleUnit: 'STEM',
    price: '35.00',
    cost: '14',
    availability: 'AVAILABLE',
    prepMinutes: '',
    heightCm: '60',
    widthCm: '',
    tags: 'San Valentín, clásico, CLÁSICO',
  };

  it('converte i valori del form in input normalizzato', () => {
    const result = schema.parse(valid);
    expect(result).toMatchObject({
      name: 'Rosa roja Freedom',
      description: null,
      priceMinor: 3500,
      costMinor: 1400,
      heightCm: 60,
      widthCm: null,
      prepMinutes: null,
      canonicalFlowerId: null,
      colors: ['red'],
      tags: ['san valentín', 'clásico'],
    });
  });

  it('accetta un colore singolo non in array (checkbox unico)', () => {
    expect(schema.parse({ ...valid, colors: 'white' }).colors).toEqual(['white']);
    expect(schema.parse({ ...valid, colors: undefined }).colors).toEqual([]);
  });

  it('il costo è facoltativo, il prezzo no', () => {
    expect(schema.parse({ ...valid, cost: '' }).costMinor).toBeNull();
    const result = schema.safeParse({ ...valid, price: '' });
    expect(result.success).toBe(false);
    if (!result.success) expect(toFieldErrors(result.error).price).toBe('required');
  });

  it('rifiuta unità di vendita incompatibili con la tipologia', () => {
    const result = schema.safeParse({ ...valid, type: 'SERVICE', saleUnit: 'STEM' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error).saleUnit).toBe('unit_not_allowed_for_type');
    }
  });

  it('collega la tassonomia solo a fiori, fogliame e piante', () => {
    const result = schema.safeParse({
      ...valid,
      type: 'PACKAGING',
      saleUnit: 'PIECE',
      canonicalFlowerId: '018bcfe5-6800-7000-8000-000000000000',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error).canonicalFlowerId).toBe('canonical_not_allowed_for_type');
    }
  });

  it('valida SKU, tipologie e prezzi', () => {
    const result = schema.safeParse({ ...valid, sku: 'ROSA ROJA', type: 'FLOWER', price: '3,5,0' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = toFieldErrors(result.error);
      expect(errors.type).toBe('invalid_option');
      expect(errors.price).toBe('invalid_money');
    }
  });

  it('lo schema normalizzato rifiuta prezzi negativi o non interi (input non fidato)', () => {
    const parsed = schema.parse(valid);
    expect(catalogItemInputSchema.safeParse({ ...parsed, priceMinor: -1 }).success).toBe(false);
    expect(catalogItemInputSchema.safeParse({ ...parsed, priceMinor: 10.5 }).success).toBe(false);
  });
});

describe('filtri elenco catalogo', () => {
  it('ignora valori non validi senza fallire', () => {
    expect(catalogListFiltersSchema.parse({ q: ' rosa ', type: 'NOPE', page: 'x' })).toEqual({
      q: 'rosa',
      type: null,
      status: 'ACTIVE',
      availability: null,
      page: 1,
    });
  });
});

describe('costi della distinta (BOM)', () => {
  const lines = [
    { quantity: 12, unitPriceMinor: 3500, unitCostMinor: 1400 }, // rose
    { quantity: 1, unitPriceMinor: 4500, unitCostMinor: 1800 }, // eucalipto
    { quantity: 1, unitPriceMinor: 3000, unitCostMinor: 800 }, // carta
  ];

  it('calcola costo materiali, valore componenti e margini (BQ-01)', () => {
    const costing = computeRecipeCosting({ salePriceMinor: 69000, laborCostMinor: 6000, lines });
    expect(costing.componentsRetailMinor).toBe(12 * 3500 + 4500 + 3000);
    expect(costing.materialCostMinor).toBe(12 * 1400 + 1800 + 800);
    expect(costing.totalCostMinor).toBe(19400 + 6000);
    expect(costing.materialMarginMinor).toBe(69000 - 19400);
    expect(costing.materialMarginBps).toBe(7188);
    expect(costing.fullMarginMinor).toBe(69000 - 25400);
    expect(costing.linesMissingCost).toBe(0);
  });

  it('non mostra margini se manca anche un solo costo', () => {
    const costing = computeRecipeCosting({
      salePriceMinor: 59000,
      laborCostMinor: 5000,
      lines: [...lines, { quantity: 2, unitPriceMinor: 1500, unitCostMinor: null }],
    });
    expect(costing.linesMissingCost).toBe(1);
    expect(costing.materialCostMinor).toBeNull();
    expect(costing.materialMarginBps).toBeNull();
    expect(costing.fullMarginBps).toBeNull();
    expect(costing.knownMaterialCostMinor).toBe(19400);
  });

  it('senza manodopera stimata il margine completo resta sconosciuto', () => {
    const costing = computeRecipeCosting({ salePriceMinor: 69000, laborCostMinor: null, lines });
    expect(costing.materialMarginBps).not.toBeNull();
    expect(costing.totalCostMinor).toBeNull();
    expect(costing.fullMarginBps).toBeNull();
  });

  it('una distinta vuota non ha costo materiali', () => {
    const costing = computeRecipeCosting({ salePriceMinor: 1000, laborCostMinor: 0, lines: [] });
    expect(costing.isEmpty).toBe(true);
    expect(costing.materialCostMinor).toBeNull();
  });

  it('valida righe e dettagli della ricetta', () => {
    expect(recipeLineFormSchema.safeParse({ ingredientItemId: '', quantity: '3' }).success).toBe(
      false,
    );
    const zero = recipeLineFormSchema.safeParse({
      ingredientItemId: '018bcfe5-6800-7000-8000-000000000000',
      quantity: '0',
    });
    expect(zero.success).toBe(false);
    const details = recipeDetailsFormSchema('MXN').parse({
      laborCost: '60',
      styleTags: 'romántico, clásico',
      notes: '',
      substitutionPolicy: 'ASK_CUSTOMER',
    });
    expect(details).toEqual({
      laborCostMinor: 6000,
      styleTags: ['romántico', 'clásico'],
      notes: null,
      substitutionPolicy: 'ASK_CUSTOMER',
    });
  });
});

describe('diff per l’audit', () => {
  it('riporta solo i campi cambiati', () => {
    const before = { name: 'Rosa', priceMinor: 3500, tags: ['a'], updatedAt: new Date(0) };
    const changes = diffFields(before, { name: 'Rosa', priceMinor: 3800, tags: ['a'] }, [
      'name',
      'priceMinor',
      'tags',
    ]);
    expect(changes).toEqual({ priceMinor: { from: 3500, to: 3800 } });
  });
});
