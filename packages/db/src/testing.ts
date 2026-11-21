/**
 * Helper per i test di integrazione (NON usare nel codice applicativo).
 * Creano dati isolati con identificativi univoci: i test non dipendono da un database vuoto
 * e possono girare in parallelo.
 */
import type { DbClient } from './client';
import type { MembershipRole } from './generated/prisma/enums.ts';
import { withSystemContext } from './tenancy';

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomSuffix()}@test.floral.local`;
}

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export async function createTestUser(
  db: DbClient,
  overrides: { email?: string; name?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? uniqueEmail();
  const name = overrides.name ?? 'Usuario de prueba';
  const user = await db.user.create({ data: { email, name, emailVerified: true } });
  return { id: user.id, email: user.email, name: user.name };
}

export interface TestTenant {
  readonly tenantId: string;
  readonly slug: string;
  readonly owner: TestUser;
}

/** Crea una fioreria con il suo proprietario (in contesto di sistema, come farebbe il seed). */
export async function createTestTenant(
  db: DbClient,
  overrides: { displayName?: string; owner?: TestUser } = {},
): Promise<TestTenant> {
  const owner = overrides.owner ?? (await createTestUser(db));
  const slug = `test-${randomSuffix()}`;
  const tenant = await withSystemContext(db, { reason: 'test fixture: create tenant' }, (tx) =>
    tx.tenant.create({
      data: {
        slug,
        displayName: overrides.displayName ?? `Florería ${slug}`,
        marketCountry: 'MX',
        currency: 'MXN',
        timezone: 'America/Mexico_City',
        mode: 'DEMO',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
        locations: {
          create: {
            name: 'Principal',
            isPrimary: true,
            addressLine1: 'Calle de prueba 1',
            city: 'Aguascalientes',
            region: 'AGU',
            postalCode: '20000',
            countryCode: 'MX',
            timezone: 'America/Mexico_City',
          },
        },
      },
    }),
  );
  return { tenantId: tenant.id, slug, owner };
}

export async function addTestMember(
  db: DbClient,
  tenantId: string,
  role: MembershipRole,
  user?: TestUser,
): Promise<TestUser> {
  const member = user ?? (await createTestUser(db));
  await withSystemContext(db, { reason: 'test fixture: add member' }, (tx) =>
    tx.membership.create({ data: { tenantId, userId: member.id, role } }),
  );
  return member;
}

export async function createTestCatalogItem(
  db: DbClient,
  tenantId: string,
  overrides: Partial<{
    name: string;
    type: 'CUT_FLOWER' | 'FOLIAGE' | 'BOUQUET' | 'PACKAGING';
    priceMinor: number;
    costMinor: number | null;
  }> = {},
) {
  const type = overrides.type ?? 'CUT_FLOWER';
  return withSystemContext(db, { reason: 'test fixture: create catalog item' }, (tx) =>
    tx.catalogItem.create({
      data: {
        tenantId,
        type,
        name: overrides.name ?? `Artículo ${randomSuffix()}`,
        saleUnit: type === 'CUT_FLOWER' ? 'STEM' : 'PIECE',
        priceMinor: overrides.priceMinor ?? 3500,
        costMinor: overrides.costMinor === undefined ? 1400 : overrides.costMinor,
        currency: 'MXN',
      },
    }),
  );
}
