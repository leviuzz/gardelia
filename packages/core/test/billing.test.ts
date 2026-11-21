import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser, type TestUser } from '@floral/db/testing';
import {
  ForbiddenError,
  NotFoundError,
  PlanRequiredError,
  ValidationError,
  getEntitlements,
  getTenantPlan,
  requireEntitlement,
} from '../src/index';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, type TestShop } from '../src/testing';

const db = getDb();
let admin: TestUser;

async function createPlatformAdmin(): Promise<TestUser> {
  const user = await createTestUser(db, { name: 'Equipo de plataforma' });
  await withSystemContext(db, { reason: 'test: promuove admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: user.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  return user;
}

function assign(shop: TestShop, overrides: Record<string, unknown> = {}) {
  return assignTenantPlan({
    operatorEmail: admin.email,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
    ...overrides,
  });
}

beforeAll(async () => {
  admin = await createPlatformAdmin();
});

afterAll(async () => {
  await disconnectDb();
});

describe('piano predefinito', () => {
  it('senza abbonamento la fioreria è BASIC e non ha il Builder', async () => {
    const shop = await createTestShop();
    const plan = await getTenantPlan(shop.owner);
    expect(plan).toMatchObject({ planCode: 'BASIC', subscription: null });
    expect(plan.entitlements.bouquetBuilder).toBe(false);
    await expect(requireEntitlement(shop.owner, 'bouquetBuilder')).rejects.toBeInstanceOf(
      PlanRequiredError,
    );
  });

  it('il piano è visibile a proprietario e manager, non allo staff', async () => {
    const shop = await createTestShop();
    await expect(getTenantPlan(shop.manager)).resolves.toMatchObject({ planCode: 'BASIC' });
    await expect(getTenantPlan(shop.staff)).rejects.toBeInstanceOf(ForbiddenError);
    // Gli entitlements servono a tutti i ruoli per mostrare cosa è disponibile.
    await expect(getEntitlements(shop.staff)).resolves.toMatchObject({ bouquetBuilder: false });
  });
});

describe('assegnazione dalla piattaforma (pilota)', () => {
  it('solo un SUPER_ADMIN può assegnare un piano', async () => {
    const shop = await createTestShop();
    const outsider = await createTestUser(db);
    await expect(
      assignTenantPlan({
        operatorEmail: outsider.email,
        tenantSlug: shop.tenant.slug,
        planCode: 'PLUS',
        status: 'PILOT',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Nemmeno il proprietario della fioreria.
    await expect(
      assignTenantPlan({
        operatorEmail: shop.tenant.owner.email,
        tenantSlug: shop.tenant.slug,
        planCode: 'PLUS',
        status: 'ACTIVE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getTenantPlan(shop.owner)).planCode).toBe('BASIC');
  });

  it('PLUS in pilota abilita il Builder, con audit nel tenant e senza effetti sugli altri', async () => {
    const shop = await createTestShop();
    const other = await createTestShop();
    const result = await assign(shop, { note: 'Piloto Aguascalientes' });
    expect(result).toMatchObject({ planCode: 'PLUS', status: 'PILOT', previous: null });

    const plan = await getTenantPlan(shop.owner);
    expect(plan).toMatchObject({
      planCode: 'PLUS',
      subscription: { planCode: 'PLUS', status: 'PILOT', source: 'MANUAL', grantsAccess: true },
    });
    await expect(requireEntitlement(shop.manager, 'bouquetBuilder')).resolves.toBeUndefined();

    const audit = await withTenantContext(db, shop.owner, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId: shop.owner.tenantId, action: 'subscription.assigned' },
      }),
    );
    expect(audit).toMatchObject({ actorUserId: admin.id, entityType: 'TenantSubscription' });
    expect(audit?.metadata).toMatchObject({
      planCode: 'PLUS',
      status: 'PILOT',
      via: 'platform-cli',
    });

    expect((await getTenantPlan(other.owner)).planCode).toBe('BASIC');
    await expect(requireEntitlement(other.owner, 'bouquetBuilder')).rejects.toBeInstanceOf(
      PlanRequiredError,
    );
  });

  it('cancellazione o periodo scaduto riportano al piano predefinito', async () => {
    const shop = await createTestShop();
    await assign(shop);
    const cancelled = await assign(shop, { status: 'CANCELLED' });
    expect(cancelled.previous).toEqual({ planCode: 'PLUS', status: 'PILOT' });
    expect(await getTenantPlan(shop.owner)).toMatchObject({
      planCode: 'BASIC',
      subscription: { planCode: 'PLUS', status: 'CANCELLED', grantsAccess: false },
    });

    // Assegnazione fatta "nel passato" con periodo ormai terminato.
    await assignTenantPlan(
      {
        operatorEmail: admin.email,
        tenantSlug: shop.tenant.slug,
        planCode: 'PLUS',
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2020-02-01T00:00:00Z'),
      },
      new Date('2020-01-01T00:00:00Z'),
    );
    const expired = await getTenantPlan(shop.owner);
    expect(expired.planCode).toBe('BASIC');
    expect(expired.subscription).toMatchObject({ status: 'ACTIVE', grantsAccess: false });
    await expect(requireEntitlement(shop.owner, 'bouquetBuilder')).rejects.toBeInstanceOf(
      PlanRequiredError,
    );
  });

  it('valida piano, stato, scadenza, nota e fioreria', async () => {
    const shop = await createTestShop();
    await expect(assign(shop, { planCode: 'GOLD' })).rejects.toBeInstanceOf(ValidationError);
    await expect(assign(shop, { status: 'PAST_DUE' })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      assign(shop, { currentPeriodEnd: new Date(Date.now() - 1000) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(assign(shop, { note: 'x'.repeat(201) })).rejects.toBeInstanceOf(ValidationError);
    await expect(assign(shop, { tenantSlug: 'no-existe-esta-floreria' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
