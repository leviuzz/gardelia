/**
 * Row-Level Security: il database stesso impedisce a un tenant di vedere o modificare
 * i dati di un altro, anche se il codice applicativo dimenticasse un filtro.
 * Questi test usano il ruolo applicativo (DATABASE_URL → TEST_DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkRlsSafety,
  createDbClient,
  disconnectDb,
  getDb,
  isForeignKeyViolation,
  isRlsViolation,
  withSystemContext,
  withTenantContext,
  withUserContext,
} from '../src/index';
import {
  addTestMember,
  createTestCatalogItem,
  createTestTenant,
  createTestUser,
  type TestTenant,
} from '../src/testing';

const db = getDb();

/** Tabelle volutamente SENZA RLS: identità/sessioni gestite da Better Auth e metadati Prisma. */
const TABLES_WITHOUT_RLS = new Set([
  'User',
  'Session',
  'Account',
  'Verification',
  'RateLimit',
  '_prisma_migrations',
]);

let tenantA: TestTenant;
let tenantB: TestTenant;
let itemA: { id: string };
let itemB: { id: string };

beforeAll(async () => {
  tenantA = await createTestTenant(db, { displayName: 'Florería A' });
  tenantB = await createTestTenant(db, { displayName: 'Florería B' });
  itemA = await createTestCatalogItem(db, tenantA.tenantId, { name: 'Rosa A' });
  itemB = await createTestCatalogItem(db, tenantB.tenantId, { name: 'Rosa B' });
});

afterAll(async () => {
  await disconnectDb();
});

describe('configurazione di sicurezza', () => {
  it('il ruolo applicativo non è superuser, né BYPASSRLS, né proprietario delle tabelle', async () => {
    const report = await checkRlsSafety(db);
    expect(report).toMatchObject({
      isSuperuser: false,
      canBypassRls: false,
      ownsTables: false,
      rlsEffective: true,
    });
  });

  it('il ruolo delle migrazioni (proprietario delle tabelle) non passa il controllo', async () => {
    const ownerUrl = process.env.DATABASE_MIGRATION_URL;
    if (!ownerUrl) throw new Error('DATABASE_MIGRATION_URL mancante nei test di integrazione');
    const owner = createDbClient({ connectionString: ownerUrl, poolMax: 1 });
    try {
      const report = await checkRlsSafety(owner);
      expect(report.ownsTables).toBe(true);
      expect(report.rlsEffective).toBe(false);
    } finally {
      await owner.$disconnect();
    }
  });

  it('ogni tabella con "tenantId" ha RLS abilitata e forzata, con almeno una policy', async () => {
    const tables = await db.$queryRaw<
      { table: string; rls: boolean; forced: boolean; policies: bigint }[]
    >`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenantId' AND NOT a.attisdropped)`;
    expect(tables.length).toBeGreaterThanOrEqual(10);
    for (const table of tables) {
      expect({ table: table.table, rls: table.rls, forced: table.forced }).toEqual({
        table: table.table,
        rls: true,
        forced: true,
      });
      expect(Number(table.policies), `${table.table} senza policy`).toBeGreaterThan(0);
    }
  });

  it('ogni tabella senza RLS è nella lista esplicita delle eccezioni', async () => {
    const tables = await db.$queryRaw<{ table: string }[]>`
      SELECT c.relname AS table FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    const unexpected = tables.map((t) => t.table).filter((name) => !TABLES_WITHOUT_RLS.has(name));
    expect(unexpected).toEqual([]);
  });
});

describe('isolamento dei tenant nel database', () => {
  it('senza contesto le tabelle dei tenant risultano vuote (fail closed)', async () => {
    expect(await db.catalogItem.count()).toBe(0);
    expect(await db.tenant.count()).toBe(0);
    expect(await db.membership.count()).toBe(0);
  });

  it('nel contesto A si vedono solo le righe di A', async () => {
    const items = await withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.catalogItem.findMany({ select: { id: true, tenantId: true } }),
    );
    expect(items.map((item) => item.id)).toContain(itemA.id);
    expect(items.map((item) => item.id)).not.toContain(itemB.id);
    expect(new Set(items.map((item) => item.tenantId))).toEqual(new Set([tenantA.tenantId]));
  });

  it('un ID di B letto nel contesto A non esiste', async () => {
    const found = await withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.catalogItem.findUnique({ where: { id: itemB.id } }),
    );
    expect(found).toBeNull();
  });

  it('UPDATE e DELETE di righe di B dal contesto A non hanno effetto', async () => {
    const result = await withTenantContext(
      db,
      { tenantId: tenantA.tenantId, userId: null },
      async (tx) => ({
        updated: await tx.catalogItem.updateMany({
          where: { id: itemB.id },
          data: { name: 'Hackeado' },
        }),
        deleted: await tx.catalogItem.deleteMany({ where: { id: itemB.id } }),
      }),
    );
    expect(result.updated.count).toBe(0);
    expect(result.deleted.count).toBe(0);

    const itemBNow = await withTenantContext(
      db,
      { tenantId: tenantB.tenantId, userId: null },
      (tx) => tx.catalogItem.findUnique({ where: { id: itemB.id } }),
    );
    expect(itemBNow?.name).toBe('Rosa B');
  });

  it('non si può inserire una riga con il tenantId di un altro tenant (WITH CHECK)', async () => {
    const attempt = withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.catalogItem.create({
        data: {
          tenantId: tenantB.tenantId,
          type: 'CUT_FLOWER',
          name: 'Intruso',
          saleUnit: 'STEM',
          priceMinor: 100,
          currency: 'MXN',
        },
      }),
    );
    await expect(attempt).rejects.toSatisfy(isRlsViolation);
  });

  it('non si può spostare una riga verso un altro tenant', async () => {
    const attempt = withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.catalogItem.update({ where: { id: itemA.id }, data: { tenantId: tenantB.tenantId } }),
    );
    await expect(attempt).rejects.toSatisfy(isRlsViolation);
  });

  it('le FK composite impediscono riferimenti fra tenant, anche in contesto di sistema', async () => {
    const bouquet = await createTestCatalogItem(db, tenantA.tenantId, {
      type: 'BOUQUET',
      name: 'Ramo A',
    });
    const recipe = await withSystemContext(db, { reason: 'test: create recipe' }, (tx) =>
      tx.bouquetRecipe.create({ data: { tenantId: tenantA.tenantId, catalogItemId: bouquet.id } }),
    );
    // Anche aggirando la RLS, la riga (tenant A) non può puntare a un ingrediente del tenant B.
    const attempt = withSystemContext(db, { reason: 'test: cross-tenant FK' }, (tx) =>
      tx.bouquetRecipeLine.create({
        data: {
          tenantId: tenantA.tenantId,
          recipeId: recipe.id,
          ingredientItemId: itemB.id,
          quantity: 3,
        },
      }),
    );
    await expect(attempt).rejects.toSatisfy(isForeignKeyViolation);
  });

  it('il contesto non sopravvive alla transazione (nessuna fuga fra connessioni del pool)', async () => {
    await withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.catalogItem.count(),
    );
    const leaked = await Promise.all(Array.from({ length: 5 }, () => db.catalogItem.count()));
    expect(leaked).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('membership e risoluzione del tenant', () => {
  it('un utente vede le proprie membership in tutti i tenant, non quelle altrui', async () => {
    const shared = await createTestUser(db);
    await addTestMember(db, tenantA.tenantId, 'STAFF', shared);
    await addTestMember(db, tenantB.tenantId, 'MANAGER', shared);

    const memberships = await withUserContext(db, shared.id, (tx) =>
      tx.membership.findMany({ select: { tenantId: true, userId: true } }),
    );
    expect(new Set(memberships.map((m) => m.tenantId))).toEqual(
      new Set([tenantA.tenantId, tenantB.tenantId]),
    );
    expect(memberships.every((m) => m.userId === shared.id)).toBe(true);
  });

  it('il tenant è leggibile solo dai membri attivi', async () => {
    const outsider = await createTestUser(db);
    const member = await addTestMember(db, tenantA.tenantId, 'STAFF');

    const asOutsider = await withUserContext(db, outsider.id, (tx) =>
      tx.tenant.findUnique({ where: { slug: tenantA.slug } }),
    );
    expect(asOutsider).toBeNull();

    const asMember = await withUserContext(db, member.id, (tx) =>
      tx.tenant.findUnique({ where: { slug: tenantA.slug } }),
    );
    expect(asMember?.id).toBe(tenantA.tenantId);

    await withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.membership.updateMany({
        where: { tenantId: tenantA.tenantId, userId: member.id },
        data: { status: 'SUSPENDED' },
      }),
    );
    const asSuspended = await withUserContext(db, member.id, (tx) =>
      tx.tenant.findUnique({ where: { slug: tenantA.slug } }),
    );
    expect(asSuspended).toBeNull();
  });

  it('un utente non può aggiungersi a un tenant altrui', async () => {
    const intruder = await createTestUser(db);
    const attempt = withUserContext(db, intruder.id, (tx) =>
      tx.membership.create({
        data: { tenantId: tenantB.tenantId, userId: intruder.id, role: 'OWNER' },
      }),
    );
    await expect(attempt).rejects.toSatisfy(isRlsViolation);
  });
});

describe('registro di audit e dati globali', () => {
  it('l’audit log è append-only per il ruolo applicativo', async () => {
    const scope = { tenantId: tenantA.tenantId, userId: null };
    const entry = await withTenantContext(db, scope, (tx) =>
      tx.auditLog.create({
        data: { tenantId: tenantA.tenantId, action: 'test.event', entityType: 'Test' },
      }),
    );
    const result = await withTenantContext(db, scope, async (tx) => ({
      updated: await tx.auditLog.updateMany({ where: { id: entry.id }, data: { action: 'x' } }),
      deleted: await tx.auditLog.deleteMany({ where: { id: entry.id } }),
    }));
    expect(result).toEqual({ updated: { count: 0 }, deleted: { count: 0 } });

    const crossTenant = withTenantContext(db, scope, (tx) =>
      tx.auditLog.create({
        data: { tenantId: tenantB.tenantId, action: 'test.forged', entityType: 'Test' },
      }),
    );
    await expect(crossTenant).rejects.toSatisfy(isRlsViolation);
  });

  it('la tassonomia globale è leggibile da tutti ma scrivibile solo dal sistema', async () => {
    await expect(db.canonicalFlower.count()).resolves.toBeGreaterThanOrEqual(0);
    const attempt = db.canonicalFlower.create({
      data: {
        slug: `test-${Date.now()}`,
        scientificName: 'Testus floralis',
        category: 'CUT_FLOWER',
        names: { 'es-MX': 'Prueba' },
      },
    });
    await expect(attempt).rejects.toSatisfy(isRlsViolation);
  });
});

describe('piani e abbonamenti', () => {
  it('i piani sono leggibili da tutti ma modificabili solo dalla piattaforma', async () => {
    const plans = await db.saasPlan.findMany({ select: { code: true }, orderBy: { code: 'asc' } });
    expect(plans.map((plan) => plan.code)).toEqual(['BASIC', 'PLUS']);

    const scope = { tenantId: tenantA.tenantId, userId: null };
    const result = await withTenantContext(db, scope, async (tx) => ({
      updated: await tx.saasPlan.updateMany({
        where: { code: 'BASIC' },
        data: { entitlements: { bouquetBuilder: true, aiPreviewsPerMonth: 999 } },
      }),
      deleted: await tx.saasPlan.deleteMany({ where: { code: 'PLUS' } }),
    }));
    expect(result).toEqual({ updated: { count: 0 }, deleted: { count: 0 } });
    const forged = withTenantContext(db, scope, (tx) =>
      tx.saasPlan.create({ data: { code: 'PLUS', entitlements: {} } }),
    );
    await expect(forged).rejects.toThrow();
  });

  it('il tenant legge solo il proprio abbonamento e non può crearlo né modificarlo', async () => {
    const tenantC = await createTestTenant(db, { displayName: 'Florería C' });
    const tenantD = await createTestTenant(db, { displayName: 'Florería D' });
    const plus = await db.saasPlan.findUniqueOrThrow({ where: { code: 'PLUS' } });
    await withSystemContext(db, { reason: 'test: assegna piano' }, async (tx) => {
      await tx.tenantSubscription.create({
        data: { tenantId: tenantC.tenantId, planId: plus.id, status: 'PILOT' },
      });
      await tx.tenantSubscription.create({
        data: { tenantId: tenantD.tenantId, planId: plus.id, status: 'ACTIVE' },
      });
    });

    const scopeC = { tenantId: tenantC.tenantId, userId: null };
    const visible = await withTenantContext(db, scopeC, (tx) =>
      tx.tenantSubscription.findMany({ select: { tenantId: true } }),
    );
    expect(visible).toEqual([{ tenantId: tenantC.tenantId }]);

    const tampering = await withTenantContext(db, scopeC, async (tx) => ({
      updated: await tx.tenantSubscription.updateMany({ data: { status: 'ACTIVE' } }),
      deleted: await tx.tenantSubscription.deleteMany({}),
    }));
    expect(tampering).toEqual({ updated: { count: 0 }, deleted: { count: 0 } });

    const selfAssigned = withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.tenantSubscription.create({
        data: { tenantId: tenantA.tenantId, planId: plus.id, status: 'ACTIVE' },
      }),
    );
    await expect(selfAssigned).rejects.toSatisfy(isRlsViolation);
    expect(await db.tenantSubscription.count()).toBe(0);
  });
});

describe('foto del catalogo e Mis ramos', () => {
  const photo = (tenantId: string, keyTenant: string, catalogItemId: string) => ({
    tenantId,
    catalogItemId,
    storageKey: `tenants/${keyTenant}/catalog-photos/foto.jpg`,
    thumbKey: `tenants/${keyTenant}/catalog-photos/foto-thumb.jpg`,
    contentType: 'image/jpeg',
    width: 800,
    height: 600,
    sizeBytes: 1000,
    createdById: '00000000-0000-4000-8000-000000000001',
  });

  it('la foto di un articolo resta nel suo tenant e i file nella sua cartella', async () => {
    const ctxA = { tenantId: tenantA.tenantId, userId: null };
    const created = await withTenantContext(db, ctxA, (tx) =>
      tx.catalogItemPhoto.create({ data: photo(tenantA.tenantId, tenantA.tenantId, itemA.id) }),
    );
    // B non la vede.
    const seenByB = await withTenantContext(
      db,
      { tenantId: tenantB.tenantId, userId: null },
      (tx) => tx.catalogItemPhoto.findUnique({ where: { id: created.id } }),
    );
    expect(seenByB).toBeNull();
    // File sotto la cartella di un'altra fioreria: rifiutato dal database.
    await expect(
      withTenantContext(db, ctxA, (tx) =>
        tx.catalogItemPhoto.create({ data: photo(tenantA.tenantId, tenantB.tenantId, itemA.id) }),
      ),
    ).rejects.toThrow(/CatalogItemPhoto_keys_check/);
    // Articolo di un'altra fioreria: la FK composita lo impedisce.
    await expect(
      withTenantContext(db, ctxA, (tx) =>
        tx.catalogItemPhoto.create({ data: photo(tenantA.tenantId, tenantA.tenantId, itemB.id) }),
      ),
    ).rejects.toSatisfy(isForeignKeyViolation);
  });
});

describe('anteprime AI: crediti e coda', () => {
  it('i crediti extra si leggono solo nel proprio tenant e non si possono auto-assegnare', async () => {
    const tenantC = await createTestTenant(db, { displayName: 'Florería Créditos' });
    const operator = await createTestUser(db);
    await withSystemContext(db, { reason: 'test: concede crediti' }, (tx) =>
      tx.aiCreditGrant.create({
        data: {
          tenantId: tenantC.tenantId,
          feature: 'BOUQUET_PREVIEW',
          units: 50,
          grantedById: operator.id,
        },
      }),
    );
    const scopeC = { tenantId: tenantC.tenantId, userId: null };
    const own = await withTenantContext(db, scopeC, (tx) =>
      tx.aiCreditGrant.findMany({ select: { units: true } }),
    );
    expect(own).toEqual([{ units: 50 }]);
    const fromA = await withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.aiCreditGrant.count(),
    );
    expect(fromA).toBe(0);

    const tampering = await withTenantContext(db, scopeC, async (tx) => ({
      updated: await tx.aiCreditGrant.updateMany({ data: { units: 10_000 } }),
      deleted: await tx.aiCreditGrant.deleteMany({}),
    }));
    expect(tampering).toEqual({ updated: { count: 0 }, deleted: { count: 0 } });
    const selfGranted = withTenantContext(db, scopeC, (tx) =>
      tx.aiCreditGrant.create({
        data: {
          tenantId: tenantC.tenantId,
          feature: 'BOUQUET_PREVIEW',
          units: 999,
          grantedById: operator.id,
        },
      }),
    );
    await expect(selfGranted).rejects.toSatisfy(isRlsViolation);
  });

  it('la coda preleva job di qualsiasi tenant senza lasciare attivo il bypass', async () => {
    const requester = await createTestUser(db);
    const job = await withSystemContext(db, { reason: 'test: accoda job' }, (tx) =>
      tx.aiJob.create({
        data: {
          tenantId: tenantB.tenantId,
          feature: 'BOUQUET_PREVIEW',
          requestedById: requester.id,
          inputHash: 'hash-test',
          input: {},
          estimatedCostMicros: 40_000,
        },
      }),
    );
    // Prelevato da una transazione nel contesto di A: la funzione vede anche B,
    // ma alla fine il contesto di A resta soggetto alla RLS.
    const result = await withTenantContext(
      db,
      { tenantId: tenantA.tenantId, userId: null },
      async (tx) => {
        const claimed = await tx.$queryRaw<{ job_id: string; tenant_id: string }[]>`
          SELECT * FROM app_claim_ai_job(60, ${tenantB.tenantId}::uuid)`;
        const bypass = await tx.$queryRaw<{ on: boolean }[]>`SELECT app_rls_bypass() AS "on"`;
        const visible = await tx.aiJob.count({ where: { id: job.id } });
        return { claimed, bypass: bypass[0]?.on, visible };
      },
    );
    expect(result.claimed).toEqual([
      { job_id: job.id, tenant_id: tenantB.tenantId, requested_by: requester.id },
    ]);
    expect(result.bypass).toBe(false);
    expect(result.visible).toBe(0);

    const spent = await withTenantContext(
      db,
      { tenantId: tenantA.tenantId, userId: null },
      (tx) => tx.$queryRaw<{ total: bigint }[]>`
        SELECT app_ai_spend_since(${new Date(Date.now() - 60_000)}::timestamptz) AS total`,
    );
    expect(Number(spent[0]?.total)).toBeGreaterThanOrEqual(40_000);
    const running = await withSystemContext(db, { reason: 'test: verifica stato' }, (tx) =>
      tx.aiJob.findUniqueOrThrow({
        where: { id: job.id },
        select: { status: true, attempts: true },
      }),
    );
    expect(running).toEqual({ status: 'RUNNING', attempts: 1 });
  });
});
