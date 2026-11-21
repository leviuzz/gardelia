/**
 * Helper per i test di integrazione dei servizi (NON usare nel codice applicativo).
 * I contesti sono ottenuti con la VERA risoluzione (`resolveTenantContext`), come in produzione.
 */
import { getDb } from '@floral/db';
import {
  addTestMember,
  createTestTenant,
  type TestTenant,
  type TestUser,
} from '@floral/db/testing';
import { resolveTenantContext, type TenantContext } from './context';

export async function contextFor(userId: string, slug: string): Promise<TenantContext> {
  const ctx = await resolveTenantContext({ userId, slug, request: { requestId: 'test-request' } });
  if (!ctx) throw new Error(`Contesto non risolto per ${userId} su ${slug}`);
  return ctx;
}

export interface TestShop {
  readonly tenant: TestTenant;
  readonly owner: TenantContext;
  readonly manager: TenantContext;
  readonly staff: TenantContext;
  readonly managerUser: TestUser;
  readonly staffUser: TestUser;
}

/** Fioreria con proprietario, manager e staff, ciascuno con il proprio contesto. */
export async function createTestShop(displayName?: string): Promise<TestShop> {
  const db = getDb();
  const tenant = await createTestTenant(db, displayName ? { displayName } : {});
  const managerUser = await addTestMember(db, tenant.tenantId, 'MANAGER');
  const staffUser = await addTestMember(db, tenant.tenantId, 'STAFF');
  return {
    tenant,
    owner: await contextFor(tenant.owner.id, tenant.slug),
    manager: await contextFor(managerUser.id, tenant.slug),
    staff: await contextFor(staffUser.id, tenant.slug),
    managerUser,
    staffUser,
  };
}

/** Input valido di un articolo, personalizzabile. */
export function itemInput(overrides: Record<string, unknown> = {}) {
  return {
    type: 'CUT_FLOWER',
    name: 'Rosa roja',
    description: null,
    sku: null,
    canonicalFlowerId: null,
    variety: 'Freedom',
    colors: ['red'],
    saleUnit: 'STEM',
    priceMinor: 3500,
    costMinor: 1400,
    availability: 'AVAILABLE',
    prepMinutes: null,
    heightCm: 60,
    widthCm: null,
    tags: ['clásico'],
    ...overrides,
  };
}
