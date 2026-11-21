/**
 * Funzioni interne del Bouquet Builder condivise con le anteprime AI. NON esportate da
 * `@floral/core`: lavorano in una transazione già aperta nel contesto del tenant.
 */
import type { Prisma, TransactionClient } from '@floral/db';
import { builderRoleOf, checkComposition, priceBouquet, type BuilderRole } from '@floral/domain';
import type { TenantContext } from '../context';
import { ValidationError } from '../errors';

export const ROLE_ORDER: Readonly<Record<BuilderRole, number>> = {
  FLOWER: 0,
  FOLIAGE: 1,
  ACCESSORY: 2,
  PACKAGING: 3,
};

export const componentSelect = {
  id: true,
  name: true,
  variety: true,
  type: true,
  saleUnit: true,
  priceMinor: true,
  costMinor: true,
  availability: true,
  colors: true,
  status: true,
  isBuilderEnabled: true,
} satisfies Prisma.CatalogItemSelect;

export type ComponentItem = Prisma.CatalogItemGetPayload<{ select: typeof componentSelect }>;

export function isUsable(item: ComponentItem): boolean {
  return (
    item.status === 'ACTIVE' &&
    item.isBuilderEnabled &&
    item.availability !== 'OUT_OF_STOCK' &&
    builderRoleOf(item.type) !== null
  );
}

export interface PricedComponent {
  readonly item: ComponentItem;
  readonly role: BuilderRole;
  readonly quantity: number;
}

/**
 * Rilegge dal DB del tenant gli articoli richiesti, verifica che siano utilizzabili e
 * applica le regole di composizione. Gli ID di altri tenant semplicemente non esistono.
 */
export async function loadComponents(
  tx: TransactionClient,
  ctx: TenantContext,
  lines: readonly { readonly catalogItemId: string; readonly quantity: number }[],
): Promise<PricedComponent[]> {
  const items = await tx.catalogItem.findMany({
    where: { tenantId: ctx.tenantId, id: { in: lines.map((line) => line.catalogItemId) } },
    select: componentSelect,
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  const components = lines.map((line) => {
    const item = byId.get(line.catalogItemId);
    const role = item ? builderRoleOf(item.type) : null;
    if (!item || role === null || item.status !== 'ACTIVE' || !item.isBuilderEnabled) {
      throw new ValidationError({ lines: 'builder_item_not_allowed' });
    }
    if (item.availability === 'OUT_OF_STOCK') {
      throw new ValidationError({ lines: 'item_unavailable' });
    }
    return { item, role, quantity: line.quantity };
  });
  const compositionError = checkComposition(components);
  if (compositionError) throw new ValidationError({ lines: compositionError });
  return components.sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.item.name.localeCompare(b.item.name),
  );
}

export async function laborFee(tx: TransactionClient, ctx: TenantContext): Promise<number> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: ctx.tenantId },
    select: { builderLaborFeeMinor: true },
  });
  return tenant.builderLaborFeeMinor;
}

export function priceComponents(components: readonly PricedComponent[], laborMinor: number) {
  const pricing = priceBouquet({
    lines: components.map((component) => ({
      role: component.role,
      quantity: component.quantity,
      unitPriceMinor: component.item.priceMinor,
      unitCostMinor: component.item.costMinor,
    })),
    laborMinor,
  });
  if (!pricing.ok) throw new ValidationError({ lines: pricing.error });
  return pricing;
}
