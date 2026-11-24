/**
 * Reportes [BI-01] (ADR-080): regole pure di periodo, vendite, prodotti e margine.
 *
 * - **Ventas** = pedidos consegnati o ritirati con la data di consegna nel periodo (il totale del
 *   pedido, consegna compresa). Gli altri ordini del periodo non ancora consegnati si mostrano a
 *   parte ("por entregar").
 * - **Margen** solo dove il costo è noto (spec 5.8: "se mancano i costi non mostrare margini
 *   apparentemente accurati"): si dice sempre su quanta parte delle vendite è calcolato. Lo sconto
 *   del pedido si ripartisce sulle righe in proporzione; il costo di consegna non entra.
 */
import { addDays, compareDates, daysInMonth, toIsoDate, type CalendarDate } from './calendar';

export type ReportPeriodKind = 'month' | 'year';

export interface ReportPeriod {
  readonly kind: ReportPeriodKind;
  /** Primo giorno incluso. */
  readonly from: CalendarDate;
  /** Primo giorno escluso. */
  readonly to: CalendarDate;
  /** Il periodo prima, della stessa lunghezza (mese o anno), per il confronto. */
  readonly previous: { readonly from: CalendarDate; readonly to: CalendarDate };
  /** "2026-11" o "2026": valore del parametro dell'URL. */
  readonly param: string;
  readonly previousParam: string;
  /** null se il periodo è quello di oggi (niente futuro). */
  readonly nextParam: string | null;
  readonly isCurrent: boolean;
}

const firstOfMonth = (year: number, month: number): CalendarDate => ({ year, month, day: 1 });
const monthParam = (date: CalendarDate) => `${date.year}-${String(date.month).padStart(2, '0')}`;

function shiftMonth(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months;
  return firstOfMonth(Math.floor(index / 12), (index % 12) + 1);
}

/**
 * Il periodo del report: `mes=AAAA-MM` o `ano=AAAA`; senza (o con valori non validi o futuri) il
 * mese di oggi.
 */
export function reportPeriod(
  input: { readonly mes?: unknown; readonly ano?: unknown },
  today: CalendarDate,
): ReportPeriod {
  const year =
    typeof input.ano === 'string' && /^\d{4}$/.test(input.ano) ? Number(input.ano) : null;
  if (year !== null && year >= 2000 && year <= today.year) {
    const from = firstOfMonth(year, 1);
    return {
      kind: 'year',
      from,
      to: firstOfMonth(year + 1, 1),
      previous: { from: firstOfMonth(year - 1, 1), to: from },
      param: String(year),
      previousParam: String(year - 1),
      nextParam: year < today.year ? String(year + 1) : null,
      isCurrent: year === today.year,
    };
  }
  const match = typeof input.mes === 'string' ? /^(\d{4})-(\d{2})$/.exec(input.mes) : null;
  const current = firstOfMonth(today.year, today.month);
  let from = current;
  if (match) {
    const candidate = firstOfMonth(Number(match[1]), Number(match[2]));
    if (candidate.month >= 1 && candidate.month <= 12 && compareDates(candidate, current) <= 0) {
      from = candidate;
    }
  }
  const isCurrent = compareDates(from, current) === 0;
  return {
    kind: 'month',
    from,
    to: shiftMonth(from, 1),
    previous: { from: shiftMonth(from, -1), to: from },
    param: monthParam(from),
    previousParam: monthParam(shiftMonth(from, -1)),
    nextParam: isCurrent ? null : monthParam(shiftMonth(from, 1)),
    isCurrent,
  };
}

/** I giorni (mese) o i mesi (anno) del periodo, per il grafico: chiavi "AAAA-MM-GG" o "AAAA-MM". */
export function reportBuckets(period: ReportPeriod): string[] {
  if (period.kind === 'year') {
    return Array.from({ length: 12 }, (_, i) => monthParam(firstOfMonth(period.from.year, i + 1)));
  }
  const days = daysInMonth(period.from.year, period.from.month);
  return Array.from({ length: days }, (_, i) => toIsoDate(addDays(period.from, i)));
}

/** La chiave del grafico per una data "AAAA-MM-GG". */
export function bucketOf(period: ReportPeriod, isoDate: string): string {
  return period.kind === 'year' ? isoDate.slice(0, 7) : isoDate;
}

export interface ReportOrder {
  /** "AAAA-MM-GG" (giorno di consegna o ritiro). */
  readonly date: string;
  readonly totalMinor: number;
}

export interface SalesSummary {
  readonly totalMinor: number;
  readonly orders: number;
  /** null senza ordini. */
  readonly averageMinor: number | null;
}

export function summarizeSales(orders: readonly ReportOrder[]): SalesSummary {
  const totalMinor = orders.reduce((sum, order) => sum + order.totalMinor, 0);
  return {
    totalMinor,
    orders: orders.length,
    averageMinor: orders.length > 0 ? Math.round(totalMinor / orders.length) : null,
  };
}

/** Variazione rispetto al periodo prima, in percento intero; null se prima era zero. */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface ReportLine {
  readonly orderId: string;
  /** Il prodotto del catalogo, se la riga ne viene; null per concetti liberi e disegni. */
  readonly catalogItemId: string | null;
  readonly kind: 'CATALOG_ITEM' | 'CUSTOM' | 'BUILDER';
  readonly description: string;
  readonly quantity: number;
  readonly lineTotalMinor: number;
  /** Costo unitario al momento dell'ordine; null = non compilato. */
  readonly unitCostMinor: number | null;
}

export interface ProductSales {
  /** Chiave stabile: il prodotto, "builder" per i disegni o la descrizione per i concetti liberi. */
  readonly key: string;
  readonly catalogItemId: string | null;
  readonly kind: ReportLine['kind'];
  /** Il nome più recente visto nelle righe (o la descrizione). */
  readonly name: string;
  readonly quantity: number;
  readonly revenueMinor: number;
}

/** I prodotti più venduti per importo (a parità, per quantità): i disegni contano insieme. */
export function topProducts(lines: readonly ReportLine[], limit: number): ProductSales[] {
  const byKey = new Map<string, ProductSales>();
  for (const line of lines) {
    const key =
      line.catalogItemId ??
      (line.kind === 'BUILDER' ? 'builder' : `custom:${line.description.trim().toLowerCase()}`);
    const previous = byKey.get(key);
    byKey.set(key, {
      key,
      catalogItemId: line.catalogItemId,
      kind: line.kind,
      name: previous?.name ?? line.description,
      quantity: (previous?.quantity ?? 0) + line.quantity,
      revenueMinor: (previous?.revenueMinor ?? 0) + line.lineTotalMinor,
    });
  }
  return [...byKey.values()]
    .sort((a, b) => b.revenueMinor - a.revenueMinor || b.quantity - a.quantity)
    .slice(0, limit);
}

export interface MarginSummary {
  /** Vendite dei prodotti (righe, dopo lo sconto ripartito). */
  readonly productSalesMinor: number;
  /** La parte di quelle vendite con il costo noto. */
  readonly coveredSalesMinor: number;
  readonly costMinor: number;
  /** null se nessuna riga ha il costo. */
  readonly marginMinor: number | null;
  /** Margine sul venduto con costo (0–100, intero); null se non calcolabile. */
  readonly marginPercent: number | null;
  /** Quota delle vendite di prodotti coperta da costi (0–100, intero). */
  readonly coveragePercent: number;
  readonly linesWithoutCost: number;
}

/**
 * Margine lordo dei prodotti venduti. `orders` dice, per ogni pedido, subtotale e sconto: lo
 * sconto si toglie dalle righe in proporzione al loro importo.
 */
export function marginSummary(
  lines: readonly ReportLine[],
  orders: ReadonlyMap<string, { readonly subtotalMinor: number; readonly discountMinor: number }>,
): MarginSummary {
  let productSalesMinor = 0;
  let coveredSalesMinor = 0;
  let costMinor = 0;
  let linesWithoutCost = 0;
  for (const line of lines) {
    const order = orders.get(line.orderId);
    const share =
      order && order.subtotalMinor > 0
        ? 1 - Math.min(order.discountMinor, order.subtotalMinor) / order.subtotalMinor
        : 1;
    const net = Math.round(line.lineTotalMinor * share);
    productSalesMinor += net;
    if (line.unitCostMinor === null) {
      if (line.lineTotalMinor > 0) linesWithoutCost += 1;
      continue;
    }
    coveredSalesMinor += net;
    costMinor += line.unitCostMinor * line.quantity;
  }
  const covered = lines.some((line) => line.unitCostMinor !== null);
  const marginMinor = covered ? coveredSalesMinor - costMinor : null;
  return {
    productSalesMinor,
    coveredSalesMinor,
    costMinor,
    marginMinor,
    marginPercent:
      marginMinor !== null && coveredSalesMinor > 0
        ? Math.round((marginMinor / coveredSalesMinor) * 100)
        : null,
    coveragePercent:
      productSalesMinor > 0 ? Math.round((coveredSalesMinor / productSalesMinor) * 100) : 0,
    linesWithoutCost,
  };
}
