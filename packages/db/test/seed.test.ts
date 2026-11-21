import { afterAll, describe, expect, it } from 'vitest';
import { runSeed } from '../prisma/seed';
import { disconnectDb, getDb, withSystemContext } from '../src/index';

const db = getDb();

afterAll(async () => {
  await disconnectDb();
});

describe('seed demo', () => {
  it('crea la fioreria demo con almeno 8 SKU, 2 ricette e 3 clienti, ed è idempotente', async () => {
    const first = await runSeed(db, { password: 'password-de-prueba-123' });
    expect(first.catalogItems).toBeGreaterThanOrEqual(8);
    expect(first.recipes).toBe(2);
    expect(first.customers).toBe(3);

    const second = await runSeed(db, { password: 'password-de-prueba-123' });
    expect(second).toEqual(first);

    const counts = await withSystemContext(db, { reason: 'test: verify seed' }, async (tx) => ({
      tenants: await tx.tenant.count({
        where: { slug: { in: ['las-camelias', 'flores-del-valle'] } },
      }),
      lines: await tx.bouquetRecipeLine.count({
        where: { recipe: { catalogItem: { sku: { in: ['RAM-12-ROJ', 'RAM-PRIM'] } } } },
      }),
      owners: await tx.membership.count({
        where: { tenant: { slug: 'las-camelias' }, role: 'OWNER' },
      }),
    }));
    expect(counts).toEqual({ tenants: 2, lines: 9, owners: 1 });
  });
});
