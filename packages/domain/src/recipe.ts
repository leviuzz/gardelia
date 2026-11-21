/**
 * Distinta base (BOM) dei bouquet e calcolo deterministico di costi e margini.
 *
 * Principio (spec §5.4, §6): la distinta strutturata è la fonte di verità per
 * composizione e costi. Se un costo manca NON si mostra un margine "apparentemente
 * accurato": i valori diventano null e si segnala quanti dati mancano.
 */
import { z } from 'zod';
import { multiplyMinor, ratioInBasisPoints, sumMinor, type CurrencyCode } from './money';
import {
  optionalMoneyField,
  optionalText,
  requiredInteger,
  tagsField,
  toTrimmedString,
} from './validation';

export const SUBSTITUTION_POLICIES = ['ASK_CUSTOMER', 'SIMILAR_ALLOWED', 'NOT_ALLOWED'] as const;
export type SubstitutionPolicy = (typeof SUBSTITUTION_POLICIES)[number];

export const RECIPE_LIMITS = {
  linesMax: 40,
  quantityMax: 999,
  notes: 2000,
  styleTags: 12,
  styleTagLength: 30,
} as const;

export interface RecipeCostingLine {
  readonly quantity: number;
  readonly unitPriceMinor: number;
  /** null = costo non compilato per l'ingrediente. */
  readonly unitCostMinor: number | null;
}

export interface RecipeCostingInput {
  /** Prezzo di vendita del bouquet (CatalogItem.priceMinor). */
  readonly salePriceMinor: number;
  /** null = manodopera non stimata. */
  readonly laborCostMinor: number | null;
  readonly lines: readonly RecipeCostingLine[];
}

export interface RecipeCosting {
  readonly isEmpty: boolean;
  readonly salePriceMinor: number;
  /** Valore a listino dei componenti (Σ prezzo × quantità): riferimento, non il prezzo del bouquet. */
  readonly componentsRetailMinor: number;
  /** Costo materiali; null se almeno un ingrediente non ha costo. */
  readonly materialCostMinor: number | null;
  /** Somma dei soli costi noti (utile per mostrare un dato parziale dichiarato come tale). */
  readonly knownMaterialCostMinor: number;
  readonly linesMissingCost: number;
  readonly laborCostMinor: number | null;
  /** Materiali + manodopera; null se uno dei due non è completo. */
  readonly totalCostMinor: number | null;
  /** Margine lordo sui soli materiali. */
  readonly materialMarginMinor: number | null;
  readonly materialMarginBps: number | null;
  /** Margine lordo su materiali + manodopera. */
  readonly fullMarginMinor: number | null;
  readonly fullMarginBps: number | null;
}

export function computeRecipeCosting(input: RecipeCostingInput): RecipeCosting {
  const retailParts: number[] = [];
  const knownCostParts: number[] = [];
  let linesMissingCost = 0;

  for (const line of input.lines) {
    retailParts.push(multiplyMinor(line.unitPriceMinor, line.quantity));
    if (line.unitCostMinor === null) linesMissingCost += 1;
    else knownCostParts.push(multiplyMinor(line.unitCostMinor, line.quantity));
  }

  const isEmpty = input.lines.length === 0;
  const knownMaterialCostMinor = sumMinor(knownCostParts);
  const materialCostMinor = !isEmpty && linesMissingCost === 0 ? knownMaterialCostMinor : null;
  const totalCostMinor =
    materialCostMinor !== null && input.laborCostMinor !== null
      ? materialCostMinor + input.laborCostMinor
      : null;

  const materialMarginMinor =
    materialCostMinor !== null ? input.salePriceMinor - materialCostMinor : null;
  const fullMarginMinor = totalCostMinor !== null ? input.salePriceMinor - totalCostMinor : null;

  return {
    isEmpty,
    salePriceMinor: input.salePriceMinor,
    componentsRetailMinor: sumMinor(retailParts),
    materialCostMinor,
    knownMaterialCostMinor,
    linesMissingCost,
    laborCostMinor: input.laborCostMinor,
    totalCostMinor,
    materialMarginMinor,
    materialMarginBps:
      materialMarginMinor !== null
        ? ratioInBasisPoints(materialMarginMinor, input.salePriceMinor)
        : null,
    fullMarginMinor,
    fullMarginBps:
      fullMarginMinor !== null ? ratioInBasisPoints(fullMarginMinor, input.salePriceMinor) : null,
  };
}

/** Riga di distinta (input normalizzato accettato dai servizi). */
export const recipeLineInputSchema = z.object({
  ingredientItemId: z.uuid({ error: 'required' }),
  quantity: z.int().min(1, { error: 'out_of_range' }).max(RECIPE_LIMITS.quantityMax, {
    error: 'out_of_range',
  }),
});
export type RecipeLineInput = z.infer<typeof recipeLineInputSchema>;

/** Form "aggiungi/modifica riga". */
export const recipeLineFormSchema = z
  .object({
    ingredientItemId: z.preprocess(toTrimmedString, z.string().min(1, { error: 'required' })),
    quantity: requiredInteger({ min: 1, max: RECIPE_LIMITS.quantityMax }),
  })
  .pipe(recipeLineInputSchema);

/** Dettagli della ricetta (input normalizzato). */
export const recipeDetailsInputSchema = z.object({
  laborCostMinor: z.int().min(0).nullable(),
  styleTags: z
    .array(z.string().trim().toLowerCase().min(1).max(RECIPE_LIMITS.styleTagLength))
    .max(RECIPE_LIMITS.styleTags),
  notes: z.string().trim().max(RECIPE_LIMITS.notes).nullable(),
  substitutionPolicy: z.enum(SUBSTITUTION_POLICIES, { error: 'invalid_option' }),
});
export type RecipeDetailsInput = z.infer<typeof recipeDetailsInputSchema>;

export function recipeDetailsFormSchema(currency: CurrencyCode) {
  return z
    .object({
      laborCost: optionalMoneyField(currency),
      styleTags: tagsField(RECIPE_LIMITS.styleTags, RECIPE_LIMITS.styleTagLength),
      notes: optionalText(RECIPE_LIMITS.notes),
      substitutionPolicy: z.preprocess(
        toTrimmedString,
        z.enum(SUBSTITUTION_POLICIES, { error: 'invalid_option' }),
      ),
    })
    .transform(
      ({ laborCost, ...rest }): RecipeDetailsInput => ({ ...rest, laborCostMinor: laborCost }),
    )
    .pipe(recipeDetailsInputSchema);
}
