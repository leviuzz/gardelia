import { describe, expect, it } from 'vitest';
import {
  INVENTORY_LIMITS,
  availableQuantity,
  averageCostAfterReceipt,
  inventoryListFiltersSchema,
  inventoryMovementFiltersSchema,
  isInventoryItemType,
  isReversibleEntryKind,
  isStockOutKind,
  missingQuantity,
  startInventorySchema,
  stockCountSchema,
  stockOutSchema,
  stockStatus,
  stockValue,
  suggestedAvailability,
  sumKnown,
  toFieldErrors,
} from '../src';

const ROSE = '01a20000-0000-7000-8000-000000000001';
const PAPER = '01a20000-0000-7000-8000-000000000002';

function startErrors(input: unknown) {
  const parsed = startInventorySchema.safeParse(input);
  return parsed.success ? null : toFieldErrors(parsed.error);
}

describe('cosa si controlla', () => {
  it('solo i prodotti fisici: fiori, verde, piante, vasi, carte e accessori', () => {
    for (const type of [
      'CUT_FLOWER',
      'FOLIAGE',
      'PLANT',
      'CONTAINER',
      'PACKAGING',
      'ACCESSORY',
    ] as const) {
      expect(isInventoryItemType(type)).toBe(true);
    }
    // Un ramo consuma i suoi ingredienti; i servizi non hanno merce.
    for (const type of ['BOUQUET', 'SERVICE', 'SERVICE_ADDON'] as const) {
      expect(isInventoryItemType(type)).toBe(false);
    }
  });

  it('uso e merma sono le uscite a mano; l’existencia inicial e le anulaciones non si annullano', () => {
    expect(isStockOutKind('USE')).toBe(true);
    expect(isStockOutKind('WASTE')).toBe(true);
    expect(isStockOutKind('ADJUSTMENT')).toBe(false);
    expect(isStockOutKind('use')).toBe(false);
    expect(isReversibleEntryKind('USE')).toBe(true);
    expect(isReversibleEntryKind('ADJUSTMENT')).toBe(true);
    expect(isReversibleEntryKind('OPENING')).toBe(false);
    expect(isReversibleEntryKind('REVERSAL')).toBe(false);
  });
});

describe('stato della scorta', () => {
  it('finito a zero o sotto, "por agotarse" al minimo o meno, altrimenti a posto', () => {
    expect(stockStatus({ onHand: 0, reserved: 0, minQuantity: null })).toBe('OUT');
    expect(stockStatus({ onHand: -3, reserved: 0, minQuantity: 10 })).toBe('OUT');
    expect(stockStatus({ onHand: 10, reserved: 0, minQuantity: 10 })).toBe('LOW');
    expect(stockStatus({ onHand: 11, reserved: 0, minQuantity: 10 })).toBe('OK');
    // Senza minimo non c'è l'avviso "por agotarse".
    expect(stockStatus({ onHand: 1, reserved: 0, minQuantity: null })).toBe('OK');
  });

  it('la merce apartada non è disponibile', () => {
    expect(availableQuantity({ onHand: 30, reserved: 20 })).toBe(10);
    expect(stockStatus({ onHand: 30, reserved: 30, minQuantity: null })).toBe('OUT');
    expect(stockStatus({ onHand: 30, reserved: 25, minQuantity: 5 })).toBe('LOW');
  });

  it('propone la disponibilità del catalogo solo quando la giacenza la contraddice', () => {
    expect(suggestedAvailability('OUT', 'AVAILABLE')).toBe('OUT_OF_STOCK');
    expect(suggestedAvailability('OUT', 'LIMITED')).toBe('OUT_OF_STOCK');
    expect(suggestedAvailability('OUT', 'OUT_OF_STOCK')).toBeNull();
    expect(suggestedAvailability('LOW', 'AVAILABLE')).toBe('LIMITED');
    expect(suggestedAvailability('LOW', 'OUT_OF_STOCK')).toBe('LIMITED');
    expect(suggestedAvailability('LOW', 'LIMITED')).toBeNull();
    expect(suggestedAvailability('OK', 'OUT_OF_STOCK')).toBe('AVAILABLE');
    expect(suggestedAvailability('OK', 'AVAILABLE')).toBeNull();
    // "Bajo pedido" è una scelta della fioreria.
    expect(suggestedAvailability('OUT', 'ON_REQUEST')).toBeNull();
  });

  it('quanto manca: una giacenza negativa non copre nulla', () => {
    expect(missingQuantity(12, 50)).toBe(0);
    expect(missingQuantity(12, 10)).toBe(2);
    expect(missingQuantity(5, -3)).toBe(5);
    expect(missingQuantity(5, 0)).toBe(5);
  });
});

describe('costo reale', () => {
  it('media ponderata con la merce che c’era, arrotondata all’unità minima', () => {
    // 50 steli a 10,00 + 100 comprati a 13,00 (1.300,00) → 12,00.
    expect(
      averageCostAfterReceipt(
        { onHand: 50, avgUnitCostMinor: 1000 },
        { quantity: 100, totalCostMinor: 130_000 },
      ),
    ).toBe(1200);
    // 1 a 10,00 + 2 a 0,01 ciascuno → (1000 + 2) / 3 = 334.
    expect(
      averageCostAfterReceipt(
        { onHand: 1, avgUnitCostMinor: 1000 },
        { quantity: 2, totalCostMinor: 2 },
      ),
    ).toBe(334);
  });

  it('senza merce (o in negativo) o senza costo noto vale il costo dell’ingresso', () => {
    const receipt = { quantity: 4, totalCostMinor: 1000 };
    expect(averageCostAfterReceipt({ onHand: 0, avgUnitCostMinor: 5000 }, receipt)).toBe(250);
    expect(averageCostAfterReceipt({ onHand: -6, avgUnitCostMinor: 5000 }, receipt)).toBe(250);
    expect(averageCostAfterReceipt({ onHand: 20, avgUnitCostMinor: null }, receipt)).toBe(250);
    expect(() =>
      averageCostAfterReceipt(
        { onHand: 0, avgUnitCostMinor: null },
        { quantity: 0, totalCostMinor: 1 },
      ),
    ).toThrow(RangeError);
  });

  it('valore al costo e totali che non fingono di essere completi', () => {
    expect(stockValue(-12, 1400)).toBe(16_800);
    expect(stockValue(12, null)).toBeNull();
    expect(sumKnown([100, 250])).toBe(350);
    expect(sumKnown([100, null])).toBeNull();
    expect(sumKnown([])).toBe(0);
  });
});

describe('"Elegir productos"', () => {
  it('si avviano solo le righe con la quantità, in ordine', () => {
    expect(
      startInventorySchema.parse({
        rows: {
          '1': { catalogItemId: PAPER, quantity: '', minQuantity: '' },
          '0': { catalogItemId: ROSE, quantity: '50', minQuantity: '20' },
          '2': { catalogItemId: PAPER, quantity: '0', minQuantity: '' },
        },
      }),
    ).toEqual([
      { catalogItemId: ROSE, quantity: 50, minQuantity: 20 },
      { catalogItemId: PAPER, quantity: 0, minQuantity: null },
    ]);
  });

  it('un minimo senza quantità è un errore sulla quantità; nessuna quantità, errore su rows', () => {
    expect(
      startErrors({ rows: { '0': { catalogItemId: ROSE, quantity: '', minQuantity: '5' } } }),
    ).toEqual({ 'rows.0.quantity': 'required', rows: 'inventory_none_selected' });
    expect(startErrors({ rows: {} })).toEqual({ rows: 'inventory_none_selected' });
    expect(startErrors({})).toEqual({ rows: 'inventory_none_selected' });
  });

  it('quantità intere nei limiti e prodotti con un id valido', () => {
    expect(
      startErrors({ rows: { '0': { catalogItemId: ROSE, quantity: '2,5', minQuantity: '' } } }),
    ).toMatchObject({ 'rows.0.quantity': 'invalid_number' });
    expect(
      startErrors({
        rows: { '0': { catalogItemId: ROSE, quantity: String(INVENTORY_LIMITS.quantity + 1) } },
      }),
    ).toMatchObject({ 'rows.0.quantity': 'out_of_range' });
    expect(startErrors({ rows: { '0': { catalogItemId: 'rosa', quantity: '3' } } })).toMatchObject({
      'rows.0.catalogItemId': 'invalid_option',
    });
  });
});

describe('form dei movimenti', () => {
  it('uso e merma: almeno 1, nota facoltativa, conferma solo se spuntata', () => {
    expect(stockOutSchema.parse({ quantity: '12', note: '  Ramo de novia ' })).toEqual({
      quantity: 12,
      note: 'Ramo de novia',
      confirmShortage: false,
    });
    expect(stockOutSchema.parse({ quantity: '3', confirmShortage: 'on' }).confirmShortage).toBe(
      true,
    );
    expect(stockOutSchema.safeParse({ quantity: '0' }).success).toBe(false);
    expect(stockOutSchema.safeParse({ quantity: '' }).success).toBe(false);
  });

  it('conteggio: zero è un conteggio valido, i negativi no', () => {
    expect(stockCountSchema.parse({ countedQuantity: '0' })).toEqual({
      countedQuantity: 0,
      note: null,
    });
    expect(stockCountSchema.safeParse({ countedQuantity: '-1' }).success).toBe(false);
  });

  it('filtri: valori sconosciuti tornano ai predefiniti', () => {
    expect(inventoryListFiltersSchema.parse({ status: 'LOW', archived: '1', page: '2' })).toEqual({
      q: '',
      status: 'LOW',
      archived: true,
      page: 2,
    });
    expect(inventoryListFiltersSchema.parse({ status: 'FULL', page: 'x' })).toEqual({
      q: '',
      status: null,
      archived: false,
      page: 1,
    });
    expect(inventoryMovementFiltersSchema.parse({ kind: 'WASTE' }).kind).toBe('WASTE');
    expect(inventoryMovementFiltersSchema.parse({ kind: 'GIFT' }).kind).toBeNull();
  });
});
