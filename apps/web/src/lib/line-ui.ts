/**
 * Righe di preventivi e ordini (ORD-01, ADR-054): come si mostrano prezzo per unità, distinta,
 * avviso di disponibilità e prodotti del catalogo da aggiungere. Lato server: i testi arrivano ai
 * componenti già tradotti nella lingua di chi guarda.
 */
import { getFormatter, getTranslations } from 'next-intl/server';
import type { QuotableItemOption } from '@floral/core';
import { isIngredientType, type Availability, type SaleUnit } from '@floral/domain';
import { money } from '@/lib/format';

export type LineWarning = 'LIMITED' | 'ON_REQUEST' | 'UNAVAILABLE';
export type QuotableGroup = 'BOUQUET' | 'INGREDIENTS' | 'OTHER';

interface RecipeIngredient {
  readonly name: string;
  readonly variety: string | null;
  readonly quantity: number;
  readonly color?: string | null;
}

interface LineAvailability {
  readonly kind: 'CATALOG_ITEM' | 'CUSTOM' | 'BUILDER';
  readonly catalogItemId: string | null;
  /** Dallo snapshot della riga. */
  readonly availability: Availability | null;
}

function groupOf(item: QuotableItemOption): QuotableGroup {
  if (item.type === 'BOUQUET') return 'BOUQUET';
  return isIngredientType(item.type) ? 'INGREDIENTS' : 'OTHER';
}

/**
 * Avviso di disponibilità. Se la riga si può ancora cambiare conta lo stato ATTUALE del catalogo
 * (`current`: l'articolo potrebbe essere esaurito o archiviato dopo l'aggiunta); altrimenti lo
 * snapshot del momento in cui la riga è nata. Le righe del Diseñador usano sempre lo snapshot
 * (la disponibilità più critica fra i componenti).
 */
export function lineWarning(
  line: LineAvailability,
  current: ReadonlyMap<string, { readonly availability: Availability }> | null,
): LineWarning | null {
  if (line.kind === 'CUSTOM') return null;
  const availability =
    line.kind === 'CATALOG_ITEM' && line.catalogItemId && current
      ? (current.get(line.catalogItemId)?.availability ?? 'UNAVAILABLE')
      : line.availability;
  if (availability === 'LIMITED' || availability === 'ON_REQUEST') return availability;
  if (availability === 'UNAVAILABLE' || availability === 'OUT_OF_STOCK') return 'UNAVAILABLE';
  return null;
}

/** Formattatori delle righe nella lingua di chi guarda, per la valuta del documento. */
export async function lineFormatters(currency: string) {
  const t = await getTranslations();
  const format = await getFormatter();
  const fmt = (minor: number) => money(minor, currency);
  const perUnit = (unit: SaleUnit) => t('catalog.perUnit', { unit: t(`catalog.units.${unit}`) });

  return {
    /** "$45.00 por tallo"; senza unità per le righe libere e del Diseñador. */
    unitPrice(unitPriceMinor: number, saleUnit: SaleUnit | null): string {
      return saleUnit ? `${fmt(unitPriceMinor)} ${perUnit(saleUnit)}` : fmt(unitPriceMinor);
    },
    /** "12 Rosa Freedom, 1 Papel kraft (kraft)" o null se la riga non ha distinta. */
    recipe(recipe: readonly RecipeIngredient[] | null): string | null {
      if (!recipe || recipe.length === 0) return null;
      return format.list(
        recipe.map((ingredient) => {
          const name = ingredient.variety
            ? `${ingredient.name} ${ingredient.variety}`
            : ingredient.name;
          return ingredient.color && t.has(`catalog.colors.${ingredient.color}`)
            ? t('quotes.editor.recipeItemColor', {
                quantity: ingredient.quantity,
                name,
                color: t(`catalog.colors.${ingredient.color}`).toLocaleLowerCase('es-MX'),
              })
            : t('quotes.editor.recipeItem', { quantity: ingredient.quantity, name });
        }),
      );
    },
    /** Prodotto del catalogo da aggiungere: nome, prezzo per unità ed eventuale disponibilità. */
    option(item: QuotableItemOption): { id: string; group: QuotableGroup; label: string } {
      return {
        id: item.id,
        group: groupOf(item),
        label: [
          item.variety ? `${item.name} · ${item.variety}` : item.name,
          `${fmt(item.priceMinor)} ${perUnit(item.saleUnit)}`,
          ...(item.availability === 'AVAILABLE'
            ? []
            : [t(`catalog.availability.${item.availability}`)]),
        ].join(' — '),
      };
    },
  };
}
