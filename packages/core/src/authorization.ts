import { can, type Permission } from '@floral/domain';
import type { TenantContext } from './context';
import { ForbiddenError } from './errors';

/** Verifica server-side di un permesso; da chiamare in OGNI servizio prima di leggere/scrivere. */
export function requirePermission(ctx: TenantContext, permission: Permission): void {
  if (!can(ctx.role, permission)) throw new ForbiddenError(permission);
}

export function hasPermission(ctx: TenantContext, permission: Permission): boolean {
  return can(ctx.role, permission);
}
