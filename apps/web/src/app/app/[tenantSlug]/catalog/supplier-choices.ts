import 'server-only';
import { getEntitlements, hasPermission, listSuppliers, type TenantContext } from '@floral/core';
import { tenantRoutes } from '@/lib/routes';
import type { SupplierChoices } from './item-form';

/**
 * I proveedores per il campo "Proveedor habitual" (ADR-081): solo con il piano dell'inventario e per
 * chi li gestisce; altrimenti null e il campo non c'è (il valore salvato resta). Quello già scelto
 * resta nella lista anche se archiviato, così non si perde salvando.
 */
export async function loadSupplierChoices(
  ctx: TenantContext,
  currentId: string | null = null,
): Promise<SupplierChoices | null> {
  if (!hasPermission(ctx, 'inventory:write') || !(await getEntitlements(ctx)).inventory) {
    return null;
  }
  const suppliers = await listSuppliers(ctx, { includeArchived: true });
  return {
    options: suppliers
      .filter((supplier) => supplier.status === 'ACTIVE' || supplier.id === currentId)
      .map((supplier) => ({ id: supplier.id, name: supplier.name })),
    manageHref: tenantRoutes(ctx.tenantSlug).inventory.suppliers(),
  };
}
