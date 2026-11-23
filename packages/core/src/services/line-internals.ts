/**
 * Righe di preventivi e ordini (ORD-01, ADR-054): prezzo, costo, distinta e snapshot si calcolano
 * SOLO qui, sul server, dal catalogo del tenant. Il client invia soltanto ID e quantità.
 *
 * Funzioni interne, NON esportate da `@floral/core`: lavorano dentro una transazione già aperta
 * con il contesto del tenant e presuppongono permessi (ed eventuale piano) già verificati.
 */
import type { Prisma, TransactionClient } from '@floral/db';
import {
  BUILDER_PRICING_VERSION,
  PRICING_ENGINE_VERSION,
  computeRecipeCosting,
  type SaleUnit,
} from '@floral/domain';
import type { TenantContext } from '../context';
import { ConflictError, ValidationError } from '../errors';
import { currentPreviewJobId } from './ai-previews';
import {
  laborFee,
  loadComponents,
  priceComponents,
  type PricedComponent,
} from './builder-internals';

/** Ingrediente nello snapshot di una riga (distinta al momento in cui la riga è nata). */
export interface RecipeLineSnapshot {
  /**
   * Prodotto del catalogo dell'ingrediente, per scaricarlo dall'inventario quando l'ordine è pronto
   * (ADR-071). Assente nelle righe nate prima: allora vale la ricetta attuale del ramo.
   */
  readonly catalogItemId?: string;
  readonly name: string;
  readonly variety: string | null;
  readonly quantity: number;
  readonly saleUnit: SaleUnit;
  /** Colore di carta, vaso o nastro scelto nel Builder. */
  readonly color?: string | null;
}

/**
 * La distinta da mostrare (preventivo, ordine): nome, varietà, quantità e colore, senza gli ID dei
 * prodotti, che nello snapshot servono solo allo scarico dell'inventario (ADR-071).
 */
export function recipeForDisplay(
  recipe: readonly Omit<RecipeLineSnapshot, 'catalogItemId'>[] | undefined,
): Omit<RecipeLineSnapshot, 'catalogItemId'>[] | null {
  if (!recipe) return null;
  return recipe.map((line) => ({
    name: line.name,
    variety: line.variety,
    quantity: line.quantity,
    saleUnit: line.saleUnit,
    ...(line.color !== undefined ? { color: line.color } : {}),
  }));
}

/** Riga pronta da inserire, con la quantità decisa da chi la aggiunge. */
export interface LineDraft {
  readonly kind: 'CATALOG_ITEM' | 'CUSTOM' | 'BUILDER';
  readonly catalogItemId: string | null;
  readonly bouquetConfigurationId: string | null;
  /** Immagine del ramo del disegno, se già generata (ADR-035). */
  readonly previewJobId: string | null;
  /** Foto vera del ramo caricata dalla fioreria: si mostra al posto dell'anteprima (ADR-052). */
  readonly bouquetPhotoId: string | null;
  readonly description: string;
  readonly unitPriceMinor: number;
  /** NULL se il costo non è compilato. */
  readonly unitCostMinor: number | null;
  readonly snapshot: Prisma.InputJsonValue;
  /** Nome per il registro di audit. */
  readonly itemName: string;
}

/**
 * Articolo ATTIVO e non esaurito del catalogo del tenant, con lo snapshot di nome, tipo e (per i
 * ramos) distinta e costo calcolato dalla ricetta.
 */
export async function catalogLineDraft(
  tx: TransactionClient,
  // Basta la fioreria: lo usano anche gli ordini del cliente online, senza un membro (ADR-067).
  scope: { readonly tenantId: string },
  catalogItemId: string,
): Promise<LineDraft> {
  const item = await tx.catalogItem.findFirst({
    where: { id: catalogItemId, tenantId: scope.tenantId, status: 'ACTIVE' },
    include: {
      recipe: {
        include: {
          lines: {
            where: { tenantId: scope.tenantId },
            include: { ingredient: true },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  });
  if (!item) throw new ValidationError({ catalogItemId: 'invalid_option' });
  if (item.availability === 'OUT_OF_STOCK') {
    throw new ValidationError({ catalogItemId: 'item_unavailable' });
  }

  let unitCostMinor = item.costMinor;
  let recipe: RecipeLineSnapshot[] | undefined;
  if (item.type === 'BOUQUET' && item.recipe) {
    recipe = item.recipe.lines.map((line) => ({
      catalogItemId: line.ingredientItemId,
      name: line.ingredient.name,
      variety: line.ingredient.variety,
      quantity: line.quantity,
      saleUnit: line.ingredient.saleUnit,
    }));
    const costing = computeRecipeCosting({
      salePriceMinor: item.priceMinor,
      laborCostMinor: item.recipe.laborCostMinor,
      lines: item.recipe.lines.map((line) => ({
        quantity: line.quantity,
        unitPriceMinor: line.ingredient.priceMinor,
        unitCostMinor: line.ingredient.costMinor,
      })),
    });
    unitCostMinor = costing.totalCostMinor;
  }
  const snapshot = {
    version: 1,
    engine: PRICING_ENGINE_VERSION,
    item: {
      name: item.name,
      variety: item.variety,
      sku: item.sku,
      type: item.type,
      saleUnit: item.saleUnit,
      availability: item.availability,
    },
    ...(recipe ? { recipe } : {}),
  };
  return {
    kind: 'CATALOG_ITEM',
    catalogItemId: item.id,
    bouquetConfigurationId: null,
    previewJobId: null,
    bouquetPhotoId: null,
    description: item.variety ? `${item.name} · ${item.variety}` : item.name,
    unitPriceMinor: item.priceMinor,
    unitCostMinor,
    snapshot: snapshot as unknown as Prisma.InputJsonValue,
    itemName: item.name,
  };
}

/** Riga libera con il prezzo del fiorista (consegna speciale, allestimento…). */
export function customLineDraft(input: {
  readonly description: string;
  readonly unitPrice: number;
}): LineDraft {
  return {
    kind: 'CUSTOM',
    catalogItemId: null,
    bouquetConfigurationId: null,
    previewJobId: null,
    bouquetPhotoId: null,
    description: input.description,
    unitPriceMinor: input.unitPrice,
    unitCostMinor: null,
    snapshot: { version: 1, engine: PRICING_ENGINE_VERSION } as Prisma.InputJsonValue,
    itemName: input.description,
  };
}

/**
 * Ramo composto nel Diseñador: prezzo ricalcolato ADESSO dal catalogo, distinta esatta nello
 * snapshot, immagine del ramo se già generata e foto vera se caricata. `null` se il disegno non c'è (o è archiviato);
 * `builder_configuration_outdated` se il catalogo è cambiato e il disegno non è più valido.
 */
export async function configurationLineDraft(
  tx: TransactionClient,
  ctx: TenantContext,
  configurationId: string,
): Promise<LineDraft | null> {
  const config = await tx.bouquetConfiguration.findFirst({
    where: { id: configurationId, tenantId: ctx.tenantId, status: 'ACTIVE' },
    include: { lines: { where: { tenantId: ctx.tenantId } } },
  });
  if (!config) return null;

  let components: PricedComponent[];
  try {
    components = await loadComponents(
      tx,
      ctx,
      config.lines.map((line) => ({
        catalogItemId: line.catalogItemId,
        quantity: line.quantity,
        color: line.color,
      })),
    );
  } catch (error) {
    // Il disegno è stato salvato valido: se ora non lo è, il catalogo è cambiato.
    if (error instanceof ValidationError) throw new ConflictError('builder_configuration_outdated');
    throw error;
  }
  const pricing = priceComponents(components, await laborFee(tx, ctx));
  const ownPhoto = await tx.bouquetPhoto.findFirst({
    where: { tenantId: ctx.tenantId, configurationId: config.id, status: 'ACTIVE' },
    select: { id: true },
  });

  const snapshot = {
    version: 1,
    engine: BUILDER_PRICING_VERSION,
    builder: {
      configurationId: config.id,
      name: config.name,
      style: config.style,
      size: config.size,
      componentsMinor: pricing.componentsMinor,
      laborMinor: pricing.laborMinor,
    },
    recipe: components.map((component) => ({
      name: component.item.name,
      variety: component.item.variety,
      quantity: component.quantity,
      saleUnit: component.item.saleUnit,
      color: component.color,
    })),
    components: components.map((component) => ({
      catalogItemId: component.item.id,
      name: component.item.name,
      variety: component.item.variety,
      role: component.role,
      quantity: component.quantity,
      color: component.color,
      saleUnit: component.item.saleUnit,
      unitPriceMinor: component.item.priceMinor,
      availability: component.item.availability,
    })),
  };
  return {
    kind: 'BUILDER',
    catalogItemId: null,
    bouquetConfigurationId: config.id,
    // L'immagine resta con la riga anche se poi il disegno cambia (ADR-035).
    previewJobId: await currentPreviewJobId(tx, ctx, config.id),
    bouquetPhotoId: ownPhoto?.id ?? null,
    description: config.name,
    unitPriceMinor: pricing.totalMinor,
    // Costo dei materiali: l'armado è un ricavo del fiorista, non un costo stimato.
    unitCostMinor: pricing.estimatedCostMinor,
    snapshot: snapshot as unknown as Prisma.InputJsonValue,
    itemName: config.name,
  };
}

/** Campi comuni della riga da inserire, per `quoteLine.create` e `orderLine.create`. */
export function lineRowData(draft: LineDraft, quantity: number, sortOrder: number) {
  return {
    kind: draft.kind,
    catalogItemId: draft.catalogItemId,
    bouquetConfigurationId: draft.bouquetConfigurationId,
    previewJobId: draft.previewJobId,
    bouquetPhotoId: draft.bouquetPhotoId,
    description: draft.description,
    quantity,
    unitPriceMinor: draft.unitPriceMinor,
    unitCostMinor: draft.unitCostMinor,
    lineTotalMinor: quantity * draft.unitPriceMinor,
    snapshot: draft.snapshot,
    sortOrder,
  };
}
