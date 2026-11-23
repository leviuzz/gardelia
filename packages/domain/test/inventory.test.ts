import { describe, expect, it } from 'vitest';
import {
  INVENTORY_LIMITS,
  availableQuantity,
  averageCostAfterReceipt,
  averageCostAfterRemoval,
  bouquetMaterialCost,
  bouquetShortages,
  bouquetsMadeSchema,
  bouquetsPossible,
  costDifferenceBps,
  parsePackQuantity,
  purchaseInputSchema,
  supplierInputSchema,
  unitCostOf,
  inventoryListFiltersSchema,
  inventoryMovementFiltersSchema,
  isInventoryItemType,
  isReversibleEntryKind,
  isStockOutKind,
  missingQuantity,
  reservationDaysLeft,
  reservationExpiryRange,
  reservationExtendSchema,
  reservationInputSchema,
  reservationListFiltersSchema,
  reservationState,
  reservationUseSchema,
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

describe('compras al mayorista (ADR-061)', () => {
  it('quantità come al mercato: "100" o paquetes per unità', () => {
    expect(parsePackQuantity('100')).toBe(100);
    expect(parsePackQuantity('4x25')).toBe(100);
    expect(parsePackQuantity(' 4 × 25 ')).toBe(100);
    expect(parsePackQuantity('3*10')).toBe(30);
    expect(parsePackQuantity('4X25')).toBe(100);
    expect(parsePackQuantity('2,5')).toBeNull();
    expect(parsePackQuantity('x25')).toBeNull();
    expect(parsePackQuantity('')).toBeNull();
  });

  it('il costo medio torna com’era quando si annulla la compra', () => {
    const before = { onHand: 50, avgUnitCostMinor: 1000 };
    const purchase = { quantity: 100, totalCostMinor: 130_000 };
    const after = averageCostAfterReceipt(before, purchase);
    expect(after).toBe(1200);
    expect(averageCostAfterRemoval({ onHand: 150, avgUnitCostMinor: after }, purchase)).toBe(1000);
    // Se non resta merce, o il costo non è noto, il costo medio resta quello che era.
    expect(averageCostAfterRemoval({ onHand: 100, avgUnitCostMinor: 1300 }, purchase)).toBe(1300);
    expect(averageCostAfterRemoval({ onHand: 120, avgUnitCostMinor: null }, purchase)).toBeNull();
    // Mai sotto zero (merce già usata a un costo diverso).
    expect(
      averageCostAfterRemoval(
        { onHand: 110, avgUnitCostMinor: 1 },
        { quantity: 100, totalCostMinor: 500_000 },
      ),
    ).toBe(0);
  });

  it('costo per unità e differenza dal catalogo', () => {
    expect(unitCostOf(1000, 30)).toBe(33);
    expect(costDifferenceBps(1300, 1000)).toBe(3000);
    expect(costDifferenceBps(900, 1000)).toBe(-1000);
    expect(costDifferenceBps(900, null)).toBeNull();
    expect(costDifferenceBps(null, 1000)).toBeNull();
    expect(costDifferenceBps(900, 0)).toBeNull();
  });

  it('modulo della compra: righe per indice, proveedor facoltativo, data valida', () => {
    const schema = purchaseInputSchema('MXN');
    const parsed = schema.parse({
      supplierId: '',
      newSupplierName: ' Mercado de Jamaica ',
      purchasedOn: '2026-11-20',
      reference: '',
      lines: {
        '1': { inventoryItemId: PAPER, quantity: '10', total: '50' },
        '0': { inventoryItemId: ROSE, quantity: '4x25', total: '1300' },
      },
    });
    expect(parsed).toEqual({
      supplierId: null,
      newSupplierName: 'Mercado de Jamaica',
      purchasedOn: { year: 2026, month: 11, day: 20 },
      reference: null,
      lines: [
        { inventoryItemId: ROSE, quantity: 100, total: 130_000 },
        { inventoryItemId: PAPER, quantity: 10, total: 5000 },
      ],
    });
    const errors = (input: unknown) => {
      const result = schema.safeParse(input);
      return result.success ? null : toFieldErrors(result.error);
    };
    expect(errors({ lines: {} })).toMatchObject({ lines: 'inventory_no_lines' });
    expect(
      errors({
        purchasedOn: '2026-02-30',
        lines: { '0': { inventoryItemId: ROSE, quantity: '1', total: '1' } },
      }),
    ).toMatchObject({ purchasedOn: 'invalid_date' });
    expect(
      errors({ lines: { '0': { inventoryItemId: ROSE, quantity: '0x5', total: 'mucho' } } }),
    ).toMatchObject({ 'lines.0.quantity': 'out_of_range', 'lines.0.total': 'invalid_money' });
  });

  it('proveedor: nome obbligatorio, telefono del mercato', () => {
    const schema = supplierInputSchema('MX');
    expect(schema.parse({ name: 'Flores Toño', phone: '449 555 0123', notes: '' })).toEqual({
      name: 'Flores Toño',
      phone: '+524495550123',
      notes: null,
    });
    expect(schema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('apartados con vencimiento (ADR-062)', () => {
  const today = { year: 2026, month: 11, day: 23 };
  const errors = (schema: { safeParse: (input: unknown) => unknown }, input: unknown) => {
    const result = schema.safeParse(input) as { success: boolean; error?: unknown };
    return result.success ? null : toFieldErrors(result.error as never);
  };

  it('vale fino alla fine del giorno di scadenza, poi è vencido senza job', () => {
    expect(reservationState('ACTIVE', today, today)).toBe('ACTIVE');
    expect(reservationState('ACTIVE', { year: 2026, month: 11, day: 22 }, today)).toBe('EXPIRED');
    expect(reservationState('USED', { year: 2026, month: 11, day: 1 }, today)).toBe('USED');
    expect(reservationState('RELEASED', { year: 2027, month: 1, day: 1 }, today)).toBe('RELEASED');
    expect(reservationDaysLeft(today, today)).toBe(0);
    expect(reservationDaysLeft({ year: 2026, month: 12, day: 1 }, today)).toBe(8);
    expect(reservationDaysLeft({ year: 2026, month: 11, day: 20 }, today)).toBe(-3);
  });

  it('la merce apartada non è disponibile e conta per gli avvisi', () => {
    expect(availableQuantity({ onHand: 50, reserved: 30 })).toBe(20);
    expect(stockStatus({ onHand: 50, reserved: 50, minQuantity: null })).toBe('OUT');
    expect(stockStatus({ onHand: 50, reserved: 40, minQuantity: 10 })).toBe('LOW');
    expect(missingQuantity(30, availableQuantity({ onHand: 50, reserved: 40 }))).toBe(20);
  });

  it('scadenza: da oggi a 90 giorni, proposta fra 3 giorni', () => {
    const range = reservationExpiryRange(today);
    expect(range.min).toEqual(today);
    expect(range.suggested).toEqual({ year: 2026, month: 11, day: 26 });
    expect(range.max).toEqual({ year: 2027, month: 2, day: 21 });
    const extend = reservationExtendSchema(today);
    expect(extend.parse({ expiresOn: '2026-11-23' })).toEqual({ expiresOn: today });
    expect(extend.parse({ expiresOn: '2027-02-21' })).toEqual({ expiresOn: range.max });
    expect(errors(extend, { expiresOn: '' })).toEqual({ expiresOn: 'required' });
    expect(errors(extend, { expiresOn: '2026-02-30' })).toEqual({ expiresOn: 'invalid_date' });
    expect(errors(extend, { expiresOn: '2026-11-22' })).toEqual({
      expiresOn: 'inventory_expiry_past',
    });
    expect(errors(extend, { expiresOn: '2027-02-22' })).toEqual({
      expiresOn: 'inventory_expiry_too_far',
    });
  });

  it('nuevo apartado: per chi, righe per indice con quantità come al mercato', () => {
    const schema = reservationInputSchema(today);
    expect(
      schema.parse({
        label: '  Boda de Ana ',
        expiresOn: '2026-11-28',
        note: '',
        lines: {
          '1': { inventoryItemId: PAPER, quantity: '10' },
          '0': { inventoryItemId: ROSE, quantity: '2x25' },
        },
        confirmShortage: 'on',
      }),
    ).toEqual({
      label: 'Boda de Ana',
      expiresOn: { year: 2026, month: 11, day: 28 },
      note: null,
      lines: [
        { inventoryItemId: ROSE, quantity: 50 },
        { inventoryItemId: PAPER, quantity: 10 },
      ],
      confirmShortage: true,
    });
    expect(errors(schema, { label: '', expiresOn: '2026-11-28', lines: {} })).toMatchObject({
      label: 'required',
      lines: 'inventory_no_lines',
    });
    expect(
      errors(schema, {
        label: 'Evento',
        expiresOn: '2026-11-28',
        lines: { '0': { inventoryItemId: '', quantity: '0' } },
      }),
    ).toMatchObject({ 'lines.0.inventoryItemId': 'required', 'lines.0.quantity': 'out_of_range' });
  });

  it('usar apartado: quanto si è usato davvero, almeno una quantità', () => {
    const line = '01a20000-0000-7000-8000-0000000000aa';
    expect(
      reservationUseSchema.parse({ lines: { '0': { lineId: line, quantity: '48' } } }),
    ).toEqual({ lines: [{ lineId: line, quantity: 48 }], confirmShortage: false });
    expect(
      errors(reservationUseSchema, { lines: { '0': { lineId: line, quantity: '0' } } }),
    ).toEqual({ lines: 'inventory_nothing_used' });
    expect(
      errors(reservationUseSchema, { lines: { '0': { lineId: line, quantity: '-1' } } }),
    ).toMatchObject({ 'lines.0.quantity': 'out_of_range' });
  });

  it('filtri: vista sconosciuta → vigentes', () => {
    expect(reservationListFiltersSchema.parse({ view: 'boh', page: 'x' })).toEqual({
      view: 'current',
      q: '',
      page: 1,
    });
    expect(reservationListFiltersSchema.parse({ view: 'closed', q: ' ana ' }).view).toBe('closed');
  });
});

describe('ramos del catálogo (ADR-063)', () => {
  it('quanti ramos: il minimo fra gli ingredienti controllati, mai un numero inventato', () => {
    const lines = [
      { quantity: 12, available: 50 }, // rose: 4 ramos
      { quantity: 3, available: 20 }, // eucalipto: 6 ramos
      { quantity: 1, available: null }, // carta comprata a richiesta: non limita
    ];
    expect(bouquetsPossible(lines)).toBe(4);
    expect(bouquetShortages(lines, 5)).toEqual([10, 0, null]);
    expect(bouquetsPossible([{ quantity: 12, available: -3 }])).toBe(0);
    expect(bouquetsPossible([{ quantity: 1, available: null }])).toBeNull();
    expect(bouquetsPossible([])).toBeNull();
  });

  it('costo dei materiali: previsto col catalogo, reale col costo medio dove c’è', () => {
    expect(
      bouquetMaterialCost([
        { quantity: 12, realUnitCostMinor: 1200, catalogUnitCostMinor: 1000 },
        { quantity: 1, realUnitCostMinor: null, catalogUnitCostMinor: 450 },
      ]),
    ).toEqual({ expectedMinor: 12_450, realMinor: 14_850, catalogFallbackLines: 1 });
    // Un costo che manca dappertutto: nessun totale che sembri completo.
    expect(
      bouquetMaterialCost([
        { quantity: 12, realUnitCostMinor: 1200, catalogUnitCostMinor: null },
        { quantity: 1, realUnitCostMinor: null, catalogUnitCostMinor: null },
      ]),
    ).toEqual({ expectedMinor: null, realMinor: null, catalogFallbackLines: 1 });
  });

  it('ramos hechos: da 1 a 500, conferma solo se spuntata', () => {
    expect(bouquetsMadeSchema.parse({ count: '3' })).toEqual({ count: 3, confirmShortage: false });
    expect(bouquetsMadeSchema.safeParse({ count: '0' }).success).toBe(false);
    expect(bouquetsMadeSchema.safeParse({ count: '501' }).success).toBe(false);
  });
});
