import { describe, expect, it } from 'vitest';
import {
  BUILDER_LIMITS,
  builderConfigurationSchema,
  builderRoleOf,
  checkComposition,
  priceBouquet,
  resolveLineColor,
  worstAvailability,
  type BuilderPricedLine,
} from '../src/builder';
import { catalogItemInputSchema } from '../src/catalog';

const rose: BuilderPricedLine = {
  role: 'FLOWER',
  quantity: 7,
  unitPriceMinor: 3500,
  unitCostMinor: 1400,
};
const tulip: BuilderPricedLine = {
  role: 'FLOWER',
  quantity: 5,
  unitPriceMinor: 5500,
  unitCostMinor: 2500,
};
const kraft: BuilderPricedLine = {
  role: 'PACKAGING',
  quantity: 1,
  unitPriceMinor: 3000,
  unitCostMinor: 800,
};

describe('prezzo deterministico del Builder', () => {
  it('BQ-01: 7 rose + 5 tulipani + packaging + armado danno un totale coerente', () => {
    const result = priceBouquet({ lines: [rose, tulip, kraft], laborMinor: 5000 });
    expect(result).toEqual({
      ok: true,
      lineTotals: [24500, 27500, 3000],
      flowersMinor: 52000,
      packagingMinor: 3000,
      accessoriesMinor: 0,
      componentsMinor: 55000,
      laborMinor: 5000,
      totalMinor: 60000,
      estimatedCostMinor: 7 * 1400 + 5 * 2500 + 800,
    });
  });

  it('il prezzo cambia con quantità e packaging; l’ordine delle righe non conta', () => {
    const base = priceBouquet({ lines: [rose, kraft], laborMinor: 0 });
    const moreRoses = priceBouquet({ lines: [{ ...rose, quantity: 12 }, kraft], laborMinor: 0 });
    const vase = priceBouquet({
      lines: [rose, { ...kraft, unitPriceMinor: 18000 }],
      laborMinor: 0,
    });
    const reversed = priceBouquet({ lines: [kraft, rose], laborMinor: 0 });
    expect(base.ok && base.totalMinor).toBe(27500);
    expect(moreRoses.ok && moreRoses.totalMinor).toBe(45000);
    expect(vase.ok && vase.totalMinor).toBe(42500);
    expect(reversed.ok && reversed.totalMinor).toBe(27500);
  });

  it('il costo stimato è sconosciuto se manca anche un solo costo', () => {
    const result = priceBouquet({
      lines: [rose, { ...tulip, unitCostMinor: null }],
      laborMinor: 0,
    });
    expect(result.ok && result.estimatedCostMinor).toBeNull();
  });

  it('rifiuta totali oltre il limite di sicurezza', () => {
    const huge = { ...rose, quantity: 300, unitPriceMinor: 1_000_000_000 };
    expect(priceBouquet({ lines: [huge], laborMinor: 0 })).toEqual({
      ok: false,
      error: 'amount_too_large',
    });
  });
});

describe('regole di composizione', () => {
  it('serve almeno un fiore', () => {
    expect(checkComposition([{ role: 'FOLIAGE', quantity: 3 }])).toBe('builder_needs_flower');
    expect(checkComposition([])).toBe('builder_needs_flower');
  });

  it('al massimo un packaging, in quantità 1', () => {
    expect(
      checkComposition([
        { role: 'FLOWER', quantity: 3 },
        { role: 'PACKAGING', quantity: 1 },
        { role: 'PACKAGING', quantity: 1 },
      ]),
    ).toBe('builder_one_packaging');
    expect(
      checkComposition([
        { role: 'FLOWER', quantity: 3 },
        { role: 'PACKAGING', quantity: 2 },
      ]),
    ).toBe('builder_one_packaging');
    expect(
      checkComposition([
        { role: 'FLOWER', quantity: 3 },
        { role: 'PACKAGING', quantity: 1 },
        { role: 'ACCESSORY', quantity: 2 },
      ]),
    ).toBeNull();
  });

  it('solo fiori recisi, fogliame, packaging e accessori sono componenti', () => {
    expect(builderRoleOf('CUT_FLOWER')).toBe('FLOWER');
    expect(builderRoleOf('CONTAINER')).toBe('PACKAGING');
    expect(builderRoleOf('BOUQUET')).toBeNull();
    expect(builderRoleOf('PLANT')).toBeNull();
    expect(builderRoleOf('SERVICE')).toBeNull();
  });

  it('la disponibilità più critica guida gli avvisi', () => {
    expect(worstAvailability(['AVAILABLE', 'LIMITED', 'ON_REQUEST'])).toBe('ON_REQUEST');
    expect(worstAvailability(['AVAILABLE', null])).toBe('AVAILABLE');
    expect(worstAvailability([])).toBeNull();
  });
});

describe('input dell’editor', () => {
  const schema = builderConfigurationSchema('MXN');
  const id = '0190a0c0-0000-7000-8000-000000000001';

  it('normalizza stile, taglia, budget e righe', () => {
    const parsed = schema.parse({
      name: '  Ramo para Sofía ',
      style: 'ROMANTIC',
      size: '',
      budget: '800',
      notes: '',
      lines: [{ catalogItemId: id, quantity: 7 }],
    });
    expect(parsed).toEqual({
      name: 'Ramo para Sofía',
      style: 'ROMANTIC',
      size: null,
      budget: 80000,
      notes: null,
      lines: [{ catalogItemId: id, quantity: 7, color: null }],
    });
  });

  it('accetta il colore della riga (o nessuno) e rifiuta colori sconosciuti', () => {
    const base = { name: 'Ramo', style: null, size: null, budget: '', notes: '' };
    expect(
      schema.parse({ ...base, lines: [{ catalogItemId: id, quantity: 1, color: 'lilac' }] }).lines,
    ).toEqual([{ catalogItemId: id, quantity: 1, color: 'lilac' }]);
    expect(
      schema.parse({ ...base, lines: [{ catalogItemId: id, quantity: 1, color: '' }] }).lines,
    ).toEqual([{ catalogItemId: id, quantity: 1, color: null }]);
    expect(
      schema.safeParse({ ...base, lines: [{ catalogItemId: id, quantity: 1, color: 'neon' }] })
        .success,
    ).toBe(false);
  });

  it('rifiuta quantità non intere o fuori limite, righe duplicate e stili sconosciuti', () => {
    const base = { name: 'Ramo', style: null, size: null, budget: '', notes: '' };
    expect(
      schema.safeParse({ ...base, lines: [{ catalogItemId: id, quantity: 1.5 }] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        lines: [{ catalogItemId: id, quantity: BUILDER_LIMITS.quantityMax + 1 }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        lines: [
          { catalogItemId: id, quantity: 1 },
          { catalogItemId: id, quantity: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...base, style: 'GOTHIC', lines: [] }).success).toBe(false);
  });
});

describe('flag Builder del catalogo', () => {
  const item = {
    type: 'CUT_FLOWER',
    name: 'Rosa',
    description: null,
    sku: null,
    canonicalFlowerId: null,
    variety: null,
    colors: [],
    saleUnit: 'STEM',
    priceMinor: 3500,
    costMinor: null,
    availability: 'AVAILABLE',
    prepMinutes: null,
    heightCm: null,
    widthCm: null,
    tags: [],
  };

  it('i componenti sono abilitati per impostazione predefinita, gli altri tipi mai', () => {
    expect(catalogItemInputSchema.parse(item).isBuilderEnabled).toBe(true);
    expect(
      catalogItemInputSchema.parse({ ...item, isBuilderEnabled: false }).isBuilderEnabled,
    ).toBe(false);
    expect(
      catalogItemInputSchema.parse({
        ...item,
        type: 'BOUQUET',
        saleUnit: 'PIECE',
        isBuilderEnabled: true,
      }).isBuilderEnabled,
    ).toBe(false);
  });
});

describe('colore di carta, vaso e nastro', () => {
  it('con più colori il colore è obbligatorio e dev’essere dell’articolo', () => {
    const colors = ['pink', 'white', 'lilac'];
    expect(resolveLineColor('PACKAGING', colors, 'lilac')).toEqual({ ok: true, color: 'lilac' });
    expect(resolveLineColor('PACKAGING', colors, null)).toEqual({
      ok: false,
      error: 'builder_color_required',
    });
    expect(resolveLineColor('ACCESSORY', colors, 'gold')).toEqual({
      ok: false,
      error: 'invalid_option',
    });
  });

  it('con un solo colore si sceglie da solo; senza colori non se ne indica nessuno', () => {
    expect(resolveLineColor('ACCESSORY', ['cream'], undefined)).toEqual({
      ok: true,
      color: 'cream',
    });
    expect(resolveLineColor('ACCESSORY', ['cream'], 'cream')).toEqual({ ok: true, color: 'cream' });
    expect(resolveLineColor('PACKAGING', [], null)).toEqual({ ok: true, color: null });
    expect(resolveLineColor('PACKAGING', [], 'pink')).toEqual({
      ok: false,
      error: 'invalid_option',
    });
  });

  it('i fiori non hanno colore di riga: ogni colore è un articolo a sé', () => {
    expect(resolveLineColor('FLOWER', ['red', 'pink'], null)).toEqual({ ok: true, color: null });
    expect(resolveLineColor('FLOWER', ['red', 'pink'], 'red')).toEqual({
      ok: false,
      error: 'invalid_option',
    });
    expect(resolveLineColor('FOLIAGE', ['green'], null)).toEqual({ ok: true, color: null });
  });
});
