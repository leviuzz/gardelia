/**
 * Inventario [INV-01] (ADR-060): giacenze dei prodotti del catalogo, registri di magazzino e avvisi
 * di scorta.
 *
 *  - La giacenza si conta nell'unità di vendita del prodotto, la stessa delle ricette (founder,
 *    23/11/2026): rose vendute a stelo → steli, gypsophila venduta a mazzo → mazzi.
 *  - Si controllano solo i prodotti che la fioreria sceglie, fra i tipi fisici. Gli altri prodotti,
 *    e le fiorerie senza inventario (chi compra gli steli dopo l'ordine), non cambiano: nessun
 *    avviso, nessun blocco.
 *  - La giacenza cambia solo con un registro, mai con un numero scritto a mano (spec §14): il
 *    conteggio fisico diventa un ajuste con la differenza.
 *  - Se la merce non basta si avvisa e si chiede conferma (founder; spec CAT-01): la giacenza può
 *    scendere sotto zero e resta in rosso finché un conteggio o una compra non la correggono.
 *  - Costo reale = media ponderata degli ingressi con costo (existencia inicial al costo del
 *    catalogo, poi le compras); costo previsto = costo del catalogo.
 */
import { z } from 'zod';
import { INGREDIENT_TYPES, type Availability, type CatalogItemType } from './catalog';
import {
  checkboxField,
  optionalInteger,
  optionalText,
  requiredInteger,
  toTrimmedString,
} from './validation';

/** Tipi di prodotto con giacenza: quelli fisici, gli stessi che entrano in una ricetta. */
export const INVENTORY_ITEM_TYPES = INGREDIENT_TYPES;

export function isInventoryItemType(type: CatalogItemType): boolean {
  return (INVENTORY_ITEM_TYPES as readonly CatalogItemType[]).includes(type);
}

/**
 * Tipi di registro. Il segno delle quantità dipende dal tipo (CHECK nel database):
 * OPENING e PURCHASE aggiungono, USE e WASTE tolgono, ADJUSTMENT e REVERSAL in entrambi i sensi.
 */
export const INVENTORY_ENTRY_KINDS = [
  'OPENING',
  'PURCHASE',
  'USE',
  'WASTE',
  'ADJUSTMENT',
  'REVERSAL',
] as const;
export type InventoryEntryKind = (typeof INVENTORY_ENTRY_KINDS)[number];

/** Uscite registrate a mano: uso (ramo, vendita) e merma (merce buttata). */
export const STOCK_OUT_KINDS = ['USE', 'WASTE'] as const satisfies readonly InventoryEntryKind[];
export type StockOutKind = (typeof STOCK_OUT_KINDS)[number];

export function isStockOutKind(value: unknown): value is StockOutKind {
  return typeof value === 'string' && (STOCK_OUT_KINDS as readonly string[]).includes(value);
}

/**
 * Registri che si possono annullare con un registro opposto. L'existencia inicial no: si corregge
 * con un conteggio. Un'anulación non si annulla: si registra di nuovo il movimento giusto.
 */
export const REVERSIBLE_ENTRY_KINDS = [
  'PURCHASE',
  'USE',
  'WASTE',
  'ADJUSTMENT',
] as const satisfies readonly InventoryEntryKind[];

export function isReversibleEntryKind(kind: InventoryEntryKind): boolean {
  return (REVERSIBLE_ENTRY_KINDS as readonly InventoryEntryKind[]).includes(kind);
}

export const INVENTORY_LIMITS = {
  /** Quantità di una riga (uso, merma, compra) e della existencia inicial. */
  quantity: 100_000,
  /** Giacenza massima in valore assoluto (CHECK nel database). */
  onHand: 1_000_000,
  /** Nota di un registro (motivo della merma, del conteggio…). */
  note: 300,
  /** Prodotti avviati insieme dalla pagina "Elegir productos". */
  startRows: 100,
  /** Prodotti diversi in un registro (una compra, i materiali di un ordine). */
  entryLines: 200,
} as const;

/** Stato di un prodotto per gli avvisi: a posto, sta per finire, finito (o in negativo). */
export const STOCK_STATUSES = ['OK', 'LOW', 'OUT'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export interface StockLevel {
  readonly onHand: number;
  /** Quantità apartada (blocco 3); 0 finché non esistono gli apartados. */
  readonly reserved: number;
  /** "Avísame cuando queden": null = nessun avviso di scorta. */
  readonly minQuantity: number | null;
}

/** Quanto si può ancora usare: giacenza meno quanto è apartado. */
export function availableQuantity(level: Pick<StockLevel, 'onHand' | 'reserved'>): number {
  return level.onHand - level.reserved;
}

/** OUT se non resta nulla da usare; LOW quando ne restano quanti il minimo o meno. */
export function stockStatus(level: StockLevel): StockStatus {
  const available = availableQuantity(level);
  if (available <= 0) return 'OUT';
  if (level.minQuantity !== null && available <= level.minQuantity) return 'LOW';
  return 'OK';
}

/**
 * Disponibilità del catalogo da proporre con un clic quando la giacenza la contraddice: la
 * giacenza non la cambia mai da sola (founder, 23/11/2026), così un conteggio sbagliato non
 * blocca Diseñador, preventivi e marketplace. "Bajo pedido" è una scelta della fioreria: resta.
 */
export function suggestedAvailability(
  status: StockStatus,
  current: Availability,
): Availability | null {
  if (current === 'ON_REQUEST') return null;
  if (status === 'OUT') return current === 'OUT_OF_STOCK' ? null : 'OUT_OF_STOCK';
  if (status === 'LOW') return current === 'LIMITED' ? null : 'LIMITED';
  return current === 'AVAILABLE' ? null : 'AVAILABLE';
}

/** Quanto manca per coprire una richiesta: 0 se basta. Una giacenza negativa non copre nulla. */
export function missingQuantity(requested: number, available: number): number {
  return Math.max(0, requested - Math.max(available, 0));
}

/**
 * Costo medio dopo un ingresso con costo (compra, existencia inicial): media ponderata con la
 * giacenza che c'era. Se non c'era merce (o ne mancava) o il suo costo non era noto, vale il costo
 * dell'ingresso. Arrotondato all'unità minima.
 */
export function averageCostAfterReceipt(
  current: { readonly onHand: number; readonly avgUnitCostMinor: number | null },
  receipt: { readonly quantity: number; readonly totalCostMinor: number },
): number {
  if (receipt.quantity <= 0) throw new RangeError('quantità di un ingresso non positiva');
  if (current.onHand <= 0 || current.avgUnitCostMinor === null) {
    return Math.round(receipt.totalCostMinor / receipt.quantity);
  }
  return Math.round(
    (current.onHand * current.avgUnitCostMinor + receipt.totalCostMinor) /
      (current.onHand + receipt.quantity),
  );
}

/** Valore al costo di una quantità (in valore assoluto); null se il costo non è noto. */
export function stockValue(quantity: number, unitCostMinor: number | null): number | null {
  return unitCostMinor === null ? null : Math.abs(quantity) * unitCostMinor;
}

/**
 * Somma di valori che possono mancare: null se ne manca anche uno solo (come i margini delle
 * ricette, ADR-015), così un totale incompleto non passa per completo.
 */
export function sumKnown(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

// -----------------------------------------------------------------------------
// Schemi dei form e dei filtri
// -----------------------------------------------------------------------------

export const INVENTORY_PAGE_SIZE = 20;

const pageField = z.preprocess(
  (value) => (typeof value === 'string' ? Number(value) : value),
  z.int().min(1).max(10_000).catch(1),
);

/** Filtri dell'elenco delle existencias (`?q=…&status=LOW|OUT&view=archived&page=…`). */
export const inventoryListFiltersSchema = z.object({
  q: z.preprocess(toTrimmedString, z.string().max(80).catch('')),
  status: z.preprocess(toTrimmedString, z.enum(['LOW', 'OUT']).nullable().catch(null)),
  /** Prodotti che non si controllano più (archiviati nell'inventario). */
  archived: z.preprocess((value) => value === '1' || value === true, z.boolean()),
  page: pageField,
});
export type InventoryListFilters = z.infer<typeof inventoryListFiltersSchema>;

/** Filtri dell'elenco dei movimenti (`?kind=…&page=…`). */
export const inventoryMovementFiltersSchema = z.object({
  kind: z.preprocess(toTrimmedString, z.enum(INVENTORY_ENTRY_KINDS).nullable().catch(null)),
  page: pageField,
});
export type InventoryMovementFilters = z.infer<typeof inventoryMovementFiltersSchema>;

/** Ricerca fra i prodotti del catalogo da cominciare a controllare. */
export const inventoryStartFiltersSchema = z.object({
  q: z.preprocess(toTrimmedString, z.string().max(80).catch('')),
});

const startRowSchema = z.object({
  catalogItemId: z.preprocess(toTrimmedString, z.uuid({ error: 'invalid_option' })),
  /** Vuoto = questo prodotto non si comincia a controllare. */
  quantity: optionalInteger({ min: 0, max: INVENTORY_LIMITS.quantity }),
  minQuantity: optionalInteger({ min: 0, max: INVENTORY_LIMITS.quantity }),
});

/** Le righe del form arrivano come oggetto per indice (`rows.3.quantity`): in ordine di indice. */
function rowsToArray(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, row]) => row);
}

/**
 * "Elegir productos": una riga per prodotto; si cominciano a controllare quelli con la quantità
 * scritta. Un minimo senza quantità è un errore sulla quantità; nessuna quantità, errore su `rows`
 * (`inventory_none_selected`).
 */
export const startInventorySchema = z
  .object({
    rows: z.preprocess(
      rowsToArray,
      z.array(startRowSchema).max(INVENTORY_LIMITS.startRows, { error: 'too_many_items' }),
    ),
  })
  .superRefine((value, ctx) => {
    value.rows.forEach((row, index) => {
      if (row.quantity === null && row.minQuantity !== null) {
        ctx.addIssue({ code: 'custom', path: ['rows', index, 'quantity'], message: 'required' });
      }
    });
    if (!value.rows.some((row) => row.quantity !== null)) {
      ctx.addIssue({ code: 'custom', path: ['rows'], message: 'inventory_none_selected' });
    }
  })
  .transform((value) =>
    value.rows.flatMap((row) =>
      row.quantity === null
        ? []
        : [
            {
              catalogItemId: row.catalogItemId,
              quantity: row.quantity,
              minQuantity: row.minQuantity,
            },
          ],
    ),
  );
export type StartInventoryRow = z.infer<typeof startInventorySchema>[number];

/** Uso o merma di un prodotto. `confirmShortage`: registrare anche se la merce non basta. */
export const stockOutSchema = z.object({
  quantity: requiredInteger({ min: 1, max: INVENTORY_LIMITS.quantity }),
  note: optionalText(INVENTORY_LIMITS.note),
  confirmShortage: checkboxField(),
});
export type StockOutInput = z.infer<typeof stockOutSchema>;

/** Conteggio fisico: quanti ce ne sono davvero; il sistema registra la differenza. */
export const stockCountSchema = z.object({
  countedQuantity: requiredInteger({ min: 0, max: INVENTORY_LIMITS.onHand }),
  note: optionalText(INVENTORY_LIMITS.note),
});
export type StockCountInput = z.infer<typeof stockCountSchema>;

/** Impostazioni di un prodotto controllato. */
export const inventoryItemSettingsSchema = z.object({
  minQuantity: optionalInteger({ min: 0, max: INVENTORY_LIMITS.quantity }),
});
export type InventoryItemSettingsInput = z.infer<typeof inventoryItemSettingsSchema>;

/** Anulación di un registro: la finestra di conferma vale come conferma se la merce non basta. */
export const reverseEntrySchema = z.object({
  confirmShortage: checkboxField(),
});
