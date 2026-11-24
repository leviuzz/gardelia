import { describe, expect, it } from 'vitest';
import {
  bucketOf,
  changePercent,
  marginSummary,
  reportBuckets,
  reportPeriod,
  summarizeSales,
  topProducts,
  type ReportLine,
} from '../src/index';

/** Reportes (ADR-080): periodo, vendite, prodotti e margine dichiarato sui costi noti. */

const today = { year: 2026, month: 11, day: 24 };

describe('periodo', () => {
  it('di default il mese di oggi; mese passato con avanti e indietro; mai il futuro', () => {
    const current = reportPeriod({}, today);
    expect(current).toMatchObject({
      kind: 'month',
      param: '2026-11',
      previousParam: '2026-10',
      nextParam: null,
      isCurrent: true,
      from: { year: 2026, month: 11, day: 1 },
      to: { year: 2026, month: 12, day: 1 },
    });
    const may = reportPeriod({ mes: '2026-05' }, today);
    expect(may).toMatchObject({ param: '2026-05', nextParam: '2026-06', isCurrent: false });
    expect(reportPeriod({ mes: '2027-01' }, today).param).toBe('2026-11');
    expect(reportPeriod({ mes: '2026-13' }, today).param).toBe('2026-11');
    expect(reportPeriod({ mes: 'mayo' }, today).param).toBe('2026-11');
    // Gennaio: il mese prima è dicembre dell'anno prima.
    expect(reportPeriod({ mes: '2026-01' }, today).previousParam).toBe('2025-12');
  });

  it("l'anno, con il confronto sull'anno prima", () => {
    const year = reportPeriod({ ano: '2026' }, today);
    expect(year).toMatchObject({
      kind: 'year',
      param: '2026',
      previousParam: '2025',
      nextParam: null,
      from: { year: 2026, month: 1, day: 1 },
      to: { year: 2027, month: 1, day: 1 },
    });
    expect(reportPeriod({ ano: '2025' }, today).nextParam).toBe('2026');
    expect(reportPeriod({ ano: '2030' }, today).kind).toBe('month');
  });

  it("barre del grafico: i giorni del mese o i mesi dell'anno", () => {
    const feb = reportPeriod({ mes: '2026-02' }, today);
    expect(reportBuckets(feb)).toHaveLength(28);
    expect(bucketOf(feb, '2026-02-14')).toBe('2026-02-14');
    const year = reportPeriod({ ano: '2026' }, today);
    expect(reportBuckets(year)[4]).toBe('2026-05');
    expect(bucketOf(year, '2026-05-10')).toBe('2026-05');
  });
});

describe('vendite', () => {
  it('totale, numero e ticket medio; variazione sul periodo prima', () => {
    expect(
      summarizeSales([
        { date: '2026-11-02', totalMinor: 69000 },
        { date: '2026-11-03', totalMinor: 35000 },
      ]),
    ).toEqual({ totalMinor: 104000, orders: 2, averageMinor: 52000 });
    expect(summarizeSales([])).toEqual({ totalMinor: 0, orders: 0, averageMinor: null });
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(50, 100)).toBe(-50);
    expect(changePercent(100, 0)).toBeNull();
  });
});

const line = (overrides: Partial<ReportLine>): ReportLine => ({
  orderId: 'o1',
  catalogItemId: 'rosa',
  kind: 'CATALOG_ITEM',
  description: 'Rosa roja',
  quantity: 1,
  lineTotalMinor: 1000,
  unitCostMinor: 400,
  ...overrides,
});

describe('prodotti più venduti', () => {
  it('si uniscono per prodotto; i disegni insieme; i concetti liberi per descrizione', () => {
    const top = topProducts(
      [
        line({ quantity: 10, lineTotalMinor: 10000 }),
        line({ orderId: 'o2', quantity: 5, lineTotalMinor: 5000 }),
        line({
          catalogItemId: null,
          kind: 'BUILDER',
          description: 'Diseño 1',
          lineTotalMinor: 9000,
        }),
        line({
          catalogItemId: null,
          kind: 'BUILDER',
          description: 'Diseño 2',
          lineTotalMinor: 9000,
        }),
        line({
          catalogItemId: null,
          kind: 'CUSTOM',
          description: 'Arreglo especial',
          lineTotalMinor: 2000,
        }),
        line({
          catalogItemId: null,
          kind: 'CUSTOM',
          description: 'arreglo especial ',
          lineTotalMinor: 1000,
        }),
      ],
      10,
    );
    expect(top.map((item) => [item.key, item.quantity, item.revenueMinor])).toEqual([
      ['builder', 2, 18000],
      ['rosa', 15, 15000],
      ['custom:arreglo especial', 2, 3000],
    ]);
  });
});

describe('margine', () => {
  it('solo sulle righe con il costo, con lo sconto ripartito, e dice quanto copre', () => {
    const orders = new Map([['o1', { subtotalMinor: 20000, discountMinor: 2000 }]]);
    const margin = marginSummary(
      [
        // 10 rose a 10.00 (costo 4.00): netto 90.00 dopo il 10% di sconto.
        line({ quantity: 10, lineTotalMinor: 10000, unitCostMinor: 400 }),
        // Concepto libre senza costo: non entra nel margine.
        line({
          catalogItemId: null,
          kind: 'CUSTOM',
          description: 'Montaje',
          lineTotalMinor: 10000,
          unitCostMinor: null,
        }),
      ],
      orders,
    );
    expect(margin).toEqual({
      productSalesMinor: 18000,
      coveredSalesMinor: 9000,
      costMinor: 4000,
      marginMinor: 5000,
      marginPercent: 56,
      coveragePercent: 50,
      linesWithoutCost: 1,
    });
  });

  it('senza nessun costo non mostra un margine', () => {
    const margin = marginSummary([line({ unitCostMinor: null })], new Map());
    expect(margin).toMatchObject({ marginMinor: null, marginPercent: null, coveragePercent: 0 });
  });
});
