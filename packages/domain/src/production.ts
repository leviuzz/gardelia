/**
 * Producción del día (ADR-057, blocco B1): quanti fiori e materiali servono per gli ordini di un
 * giorno, sommati dalle distinte congelate nelle righe (snapshot). È la lista per il mercato
 * all'ingrosso e per il banco: la distinta è la fonte di verità, mai l'immagine del ramo.
 */
import type { SaleUnit } from './catalog';

/** Ingrediente nello snapshot di una riga (per UN ramo). */
export interface ProductionRecipeItem {
  readonly name: string;
  readonly variety: string | null;
  readonly quantity: number;
  readonly saleUnit: SaleUnit;
  readonly color?: string | null;
}

export interface ProductionLineInput {
  readonly kind: 'CATALOG_ITEM' | 'CUSTOM' | 'BUILDER';
  readonly description: string;
  /** Quante unità della riga (es. 2 ramos). */
  readonly quantity: number;
  /** Distinta per una unità (ramos del catalogo e del Diseñador). */
  readonly recipe: readonly ProductionRecipeItem[] | null;
  /** Articolo venduto così com'è (righe del catalogo senza distinta). */
  readonly item: {
    readonly name: string;
    readonly variety: string | null;
    readonly saleUnit: SaleUnit;
  } | null;
}

export interface ProductionItem {
  readonly name: string;
  readonly variety: string | null;
  readonly color: string | null;
  readonly saleUnit: SaleUnit;
  readonly quantity: number;
}

export interface ProductionSummary {
  /** Fiori, verde e materiali da avere, sommati e in ordine alfabetico. */
  readonly items: readonly ProductionItem[];
  /** Ramos da armare (righe con distinta). */
  readonly bouquets: number;
  /** Righe libere (es. "Globo metálico"): non hanno distinta, si elencano come sono. */
  readonly custom: readonly { readonly description: string; readonly quantity: number }[];
}

export function aggregateProduction(lines: readonly ProductionLineInput[]): ProductionSummary {
  const items = new Map<string, { item: ProductionItem; quantity: number }>();
  const custom = new Map<string, number>();
  let bouquets = 0;

  const add = (entry: Omit<ProductionItem, 'quantity'>, quantity: number) => {
    const key = [entry.name, entry.variety ?? '', entry.color ?? '', entry.saleUnit].join('|');
    const current = items.get(key);
    if (current) current.quantity += quantity;
    else items.set(key, { item: { ...entry, quantity: 0 }, quantity });
  };

  for (const line of lines) {
    if (line.quantity <= 0) continue;
    if (line.recipe && line.recipe.length > 0) {
      bouquets += line.quantity;
      for (const ingredient of line.recipe) {
        add(
          {
            name: ingredient.name,
            variety: ingredient.variety,
            color: ingredient.color ?? null,
            saleUnit: ingredient.saleUnit,
          },
          ingredient.quantity * line.quantity,
        );
      }
    } else if (line.item) {
      add({ ...line.item, color: null }, line.quantity);
    } else {
      custom.set(line.description, (custom.get(line.description) ?? 0) + line.quantity);
    }
  }

  const byName = (a: ProductionItem, b: ProductionItem) =>
    a.name.localeCompare(b.name, 'es') ||
    (a.variety ?? '').localeCompare(b.variety ?? '', 'es') ||
    (a.color ?? '').localeCompare(b.color ?? '', 'es');

  return {
    items: [...items.values()].map(({ item, quantity }) => ({ ...item, quantity })).sort(byName),
    bouquets,
    custom: [...custom.entries()]
      .map(([description, quantity]) => ({ description, quantity }))
      .sort((a, b) => a.description.localeCompare(b.description, 'es')),
  };
}
