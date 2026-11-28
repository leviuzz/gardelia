/**
 * Row-Level Security: il database stesso impedisce a un tenant di vedere o modificare
 * i dati di un altro, anche se il codice applicativo dimenticasse un filtro.
 * Questi test usano il ruolo applicativo (DATABASE_URL → TEST_DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkRlsSafety,
  createDbClient,
  disconnectDb,
  getDb,
  isForeignKeyViolation,
  isRlsViolation,
  withBuyerOrderContext,
  withPortalContext,
  withPortalWriteContext,
  withSystemContext,
  withTenantContext,
  withUserContext,
  type TransactionClient,
} from '../src/index';
import {
  addTestMember,
  createTestCatalogItem,
  createTestTenant,
  createTestUser,
  type TestTenant,
  type TestUser,
} from '../src/testing';

const db = getDb();

/** Tabelle volutamente SENZA RLS: identità/sessioni gestite da Better Auth e metadati Prisma. */
const TABLES_WITHOUT_RLS = new Set([
  'User',
  'Session',
  'Account',
  // Segreti della verifica in due passaggi, cifrati da Better Auth (ADR-077).
  'TwoFactor',
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

  it('ogni tabella per persona ("userId", niente "tenantId") ha la RLS per utente', async () => {
    const tables = await db.$queryRaw<
      { table: string; rls: boolean; forced: boolean; userPolicies: bigint }[]
    >`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname
                AND p.qual LIKE '%app_current_user_id()%'
                AND p.with_check LIKE '%app_current_user_id()%') AS "userPolicies"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'userId' AND NOT a.attisdropped)
        AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenantId' AND NOT a.attisdropped)`;
    const perPerson = tables.filter((table) => !TABLES_WITHOUT_RLS.has(table.table));
    // Conto del cliente del marketplace (blocco C1).
    expect(perPerson.map((table) => table.table).sort()).toEqual(
      expect.arrayContaining(['BuyerAddress', 'BuyerProfile']),
    );
    for (const table of perPerson) {
      expect({ table: table.table, rls: table.rls, forced: table.forced }).toEqual({
        table: table.table,
        rls: true,
        forced: true,
      });
      expect(Number(table.userPolicies), `${table.table} senza policy per utente`).toBe(1);
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

// -----------------------------------------------------------------------------
// Floral Care, pagina del cliente (ADR-084)
// -----------------------------------------------------------------------------

/** Le sole tabelle che danno righe in modalità portale (policy `portal_read`). */
const PORTAL_READ_TABLES = [
  // Blocco 6b (ADR-085): solo i propri casi e le proprie risposte dell'assistente.
  'AssistantAnswer',
  'AssistantCase',
  'Customer',
  'CustomerAddress',
  'CustomerSubscription',
  'CustomerSubscriptionService',
  'CustomerSubscriptionSlot',
  'CareCharge',
  'CareChargeLine',
  'CareMessage',
  'CarePhoto',
  'CarePlant',
  'CarePortalRead',
  'CareSlot',
  'CareVisit',
  'CareVisitPlantResult',
  'CareVisitServiceResult',
];

let contractCount = 1000;

/** Un cliente con la sua sede e un contratto di Floral Care attivo (fixture di sistema). */
async function careContract(tenantId: string, name: string) {
  contractCount += 1;
  const number = contractCount;
  return withSystemContext(db, { reason: 'test fixture: care contract' }, async (tx) => {
    const customer = await tx.customer.create({ data: { tenantId, displayName: name } });
    const address = await tx.customerAddress.create({
      data: {
        tenantId,
        customerId: customer.id,
        addressLine1: 'Av. Siempre Viva 1',
        city: 'Aguascalientes',
        region: 'AGU',
        postalCode: '20000',
        countryCode: 'MX',
      },
    });
    const subscription = await tx.customerSubscription.create({
      data: {
        tenantId,
        number,
        customerId: customer.id,
        customerAddressId: address.id,
        kind: 'CARE',
        status: 'ACTIVE',
        frequency: 'MONTHLY_1',
        startDate: new Date('2026-11-01T00:00:00Z'),
        currency: 'MXN',
        confirmedAt: new Date(),
        missedVisitPolicy: 'COUNTS',
        deadPlantPolicy: 'INCLUDED',
        lateCancelHours: 12,
        minNoticeHours: 24,
      },
    });
    return { customerId: customer.id, subscriptionId: subscription.id, tenantId };
  });
}

/** Un accesso al portale già accettato da `person` (tutti i contratti del cliente, o uno). */
async function grantPortal(
  contract: { tenantId: string; customerId: string; subscriptionId: string },
  person: TestUser,
  options: { onlyContract?: boolean; canSeeMoney?: boolean } = {},
) {
  return withSystemContext(db, { reason: 'test fixture: portal access' }, async (tx) => {
    const invite = await tx.carePortalInvite.create({
      data: {
        tenantId: contract.tenantId,
        customerId: contract.customerId,
        subscriptionId: options.onlyContract ? contract.subscriptionId : null,
        email: person.email,
        canSeeMoney: options.canSeeMoney ?? true,
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: new Date(),
        acceptedUserId: person.id,
      },
    });
    return tx.carePortalAccess.create({
      data: {
        tenantId: contract.tenantId,
        customerId: contract.customerId,
        subscriptionId: options.onlyContract ? contract.subscriptionId : null,
        userId: person.id,
        inviteId: invite.id,
        canSeeMoney: options.canSeeMoney ?? true,
      },
    });
  });
}

async function tenantTables(tx: TransactionClient): Promise<string[]> {
  const rows = await tx.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name`;
  return rows.map((row) => row.table_name);
}

describe('pagina del cliente di Floral Care (ADR-084)', () => {
  let person: TestUser;
  let stranger: TestUser;
  let own: Awaited<ReturnType<typeof careContract>>;
  let otherCustomer: Awaited<ReturnType<typeof careContract>>;
  let otherShop: Awaited<ReturnType<typeof careContract>>;

  beforeAll(async () => {
    person = await createTestUser(db);
    stranger = await createTestUser(db);
    own = await careContract(tenantA.tenantId, 'Hotel Jardín');
    otherCustomer = await careContract(tenantA.tenantId, 'Oficinas Centro');
    otherShop = await careContract(tenantB.tenantId, 'Clínica Norte');
    await grantPortal(own, person, { canSeeMoney: false });
    await grantPortal(otherShop, person);
  });

  it('ogni policy del portale è una lettura ammessa, un inserimento dei messaggi o la guardia delle visite', async () => {
    const policies = await withSystemContext(
      db,
      { reason: 'test: policy del portale' },
      (tx) =>
        tx.$queryRaw<{ tablename: string; policyname: string; cmd: string; permissive: string }[]>`
        SELECT tablename, policyname, cmd, permissive
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (coalesce(qual, '') LIKE '%app_portal_%' OR coalesce(with_check, '') LIKE '%app_portal_%')
        ORDER BY tablename, policyname`,
    );
    const reads = policies.filter((policy) => policy.policyname === 'portal_read');
    expect(reads.map((policy) => policy.tablename).sort()).toEqual([...PORTAL_READ_TABLES].sort());
    expect(
      reads.every((policy) => policy.cmd === 'SELECT' && policy.permissive === 'PERMISSIVE'),
    ).toBe(true);
    // Blocco 5b: il portale inserisce solo i propri messaggi e le loro foto; blocco 6b: i propri
    // casi, risposte e chiamate dell'assistente (mai UPDATE o DELETE).
    expect(policies.filter((policy) => policy.policyname !== 'portal_read')).toEqual([
      {
        tablename: 'AssistantAnswer',
        policyname: 'portal_insert',
        cmd: 'INSERT',
        permissive: 'PERMISSIVE',
      },
      {
        tablename: 'AssistantCall',
        policyname: 'portal_insert',
        cmd: 'INSERT',
        permissive: 'PERMISSIVE',
      },
      {
        tablename: 'AssistantCase',
        policyname: 'portal_insert',
        cmd: 'INSERT',
        permissive: 'PERMISSIVE',
      },
      {
        tablename: 'CareMessage',
        policyname: 'portal_insert',
        cmd: 'INSERT',
        permissive: 'PERMISSIVE',
      },
      {
        tablename: 'CarePhoto',
        policyname: 'portal_insert',
        cmd: 'INSERT',
        permissive: 'PERMISSIVE',
      },
      {
        tablename: 'CareVisit',
        policyname: 'portal_write_guard',
        cmd: 'UPDATE',
        permissive: 'RESTRICTIVE',
      },
    ]);
  });

  it('senza accesso il portale non si apre e non imposta niente', async () => {
    const opened = await withPortalContext(
      db,
      { userId: stranger.id, subscriptionId: own.subscriptionId },
      async () => 'aperto',
    );
    expect(opened).toBeNull();
    // Lo stesso contratto da chi ha accesso solo in un'altra fioreria, o con un ID inventato.
    expect(
      await withPortalContext(
        db,
        { userId: person.id, subscriptionId: otherCustomer.subscriptionId },
        async () => 'aperto',
      ),
    ).toBeNull();
    const settings = await withUserContext(db, stranger.id, async (tx) => {
      await tx.$queryRaw`SELECT * FROM app_portal_enter(${own.subscriptionId}::uuid)`;
      return tx.$queryRaw<{ tenant: string | null; sub: string | null }[]>`
        SELECT app_portal_tenant_id()::text AS tenant, app_portal_subscription_id()::text AS sub`;
    });
    expect(settings).toEqual([{ tenant: null, sub: null }]);
  });

  it('in modalità portale si vede solo il contratto aperto, e nient’altro della fioreria', async () => {
    const seen = await withPortalContext(
      db,
      { userId: person.id, subscriptionId: own.subscriptionId },
      async (tx, entry) => {
        const counts: Record<string, number> = {};
        for (const table of await tenantTables(tx)) {
          const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*)::bigint AS n FROM "${table}"`,
          );
          counts[table] = Number(rows[0]?.n ?? 0);
        }
        const contracts = await tx.customerSubscription.findMany({ select: { id: true } });
        const customers = await tx.customer.findMany({ select: { id: true } });
        return { entry, counts, contracts, customers };
      },
    );
    expect(seen).not.toBeNull();
    if (!seen) return;
    expect(seen.entry).toMatchObject({
      tenantId: tenantA.tenantId,
      customerId: own.customerId,
      subscriptionId: own.subscriptionId,
      canSeeMoney: false,
      readOnly: false,
      shop: { name: 'Florería A', timezone: 'America/Mexico_City', currency: 'MXN' },
    });
    expect(seen.contracts).toEqual([{ id: own.subscriptionId }]);
    expect(seen.customers).toEqual([{ id: own.customerId }]);
    for (const [table, count] of Object.entries(seen.counts)) {
      if (!PORTAL_READ_TABLES.includes(table))
        expect({ table, count }).toEqual({ table, count: 0 });
    }
    expect(seen.counts.CustomerAddress).toBe(1);
  });

  it('dal portale non si scrive, e i GUC del portale non passano alla transazione dopo', async () => {
    const attempt = await withPortalContext(
      db,
      { userId: person.id, subscriptionId: own.subscriptionId },
      async (tx) => {
        const updated = await tx.customerSubscription.updateMany({
          where: { id: own.subscriptionId },
          data: { notes: 'cambiata dal portale' },
        });
        let inserted = true;
        try {
          await tx.$executeRaw`SAVEPOINT p`;
          await tx.customer.create({
            data: { tenantId: tenantA.tenantId, displayName: 'Intrusa' },
          });
        } catch (error) {
          inserted = !isRlsViolation(error);
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT p`;
        }
        return { updated: updated.count, inserted };
      },
    );
    expect(attempt).toEqual({ updated: 0, inserted: false });
    const after = await withUserContext(
      db,
      person.id,
      (tx) =>
        tx.$queryRaw<{ tenant: string | null; sub: string | null }[]>`
        SELECT app_portal_tenant_id()::text AS tenant, app_portal_subscription_id()::text AS sub`,
    );
    expect(after).toEqual([{ tenant: null, sub: null }]);
  });

  it('dal portale si inseriscono solo i propri messaggi, con la loro foto, sul contratto aperto', async () => {
    // Un messaggio della fioreria sullo stesso contratto: la persona non ci attacca foto.
    const shopMessage = await withSystemContext(db, { reason: 'test: messaggio fioreria' }, (tx) =>
      tx.careMessage.create({
        data: {
          tenantId: tenantA.tenantId,
          customerId: own.customerId,
          subscriptionId: own.subscriptionId,
          authorKind: 'SHOP',
          body: 'Mañana pasamos a las 9.',
          submitKey: randomUUID(),
        },
      }),
    );
    const base = {
      tenantId: tenantA.tenantId,
      customerId: own.customerId,
      subscriptionId: own.subscriptionId,
      authorKind: 'CUSTOMER' as const,
      authorUserId: person.id,
      body: 'Perfecto, gracias.',
    };
    const photoOf = (messageId: string) => ({
      tenantId: tenantA.tenantId,
      subscriptionId: own.subscriptionId,
      messageId,
      storageKey: `tenants/${tenantA.tenantId}/care-photos/${own.subscriptionId}-${randomUUID()}.jpg`,
      thumbKey: `tenants/${tenantA.tenantId}/care-photos/${own.subscriptionId}-${randomUUID()}-thumb.jpg`,
      contentType: 'image/jpeg',
      width: 640,
      height: 480,
      sizeBytes: 1000,
    });
    const result = await withPortalContext(
      db,
      { userId: person.id, subscriptionId: own.subscriptionId },
      async (tx) => {
        const attempt = async (run: () => Promise<unknown>) => {
          await tx.$executeRaw`SAVEPOINT m`;
          try {
            await run();
            await tx.$executeRaw`RELEASE SAVEPOINT m`;
            return 'ok';
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT m`;
            if (isRlsViolation(error)) return 'rls';
            throw error;
          }
        };
        const mineKey = randomUUID();
        const mine = await attempt(() =>
          tx.careMessage.create({ data: { ...base, submitKey: mineKey } }),
        );
        const asShop = await attempt(() =>
          tx.careMessage.create({ data: { ...base, authorKind: 'SHOP', submitKey: randomUUID() } }),
        );
        const asSomeoneElse = await attempt(() =>
          tx.careMessage.create({
            data: { ...base, authorUserId: stranger.id, submitKey: randomUUID() },
          }),
        );
        const otherContract = await attempt(() =>
          tx.careMessage.create({
            data: {
              ...base,
              customerId: otherCustomer.customerId,
              subscriptionId: otherCustomer.subscriptionId,
              submitKey: randomUUID(),
            },
          }),
        );
        const alreadyRead = await attempt(() =>
          tx.careMessage.create({
            data: { ...base, readByShopAt: new Date(), submitKey: randomUUID() },
          }),
        );
        const message = await tx.careMessage.findFirstOrThrow({
          where: { tenantId: tenantA.tenantId, submitKey: mineKey },
          select: { id: true },
        });
        const photo = await attempt(() =>
          tx.carePhoto.create({ data: photoOf(message.id), select: { id: true } }),
        );
        const photoOnShopMessage = await attempt(() =>
          tx.carePhoto.create({ data: photoOf(shopMessage.id), select: { id: true } }),
        );
        const updated = await tx.careMessage.updateMany({
          where: { tenantId: tenantA.tenantId, id: message.id },
          data: { body: 'cambiato' },
        });
        const deleted = await tx.carePhoto.deleteMany({
          where: { tenantId: tenantA.tenantId, messageId: message.id },
        });
        const marked = await tx.$queryRaw<
          { at: Date | null }[]
        >`SELECT app_portal_mark_read() AS at`;
        const reads = await tx.carePortalRead.findMany({ select: { userId: true } });
        const thread = await tx.careMessage.count();
        return {
          mine,
          asShop,
          asSomeoneElse,
          otherContract,
          alreadyRead,
          photo,
          photoOnShopMessage,
          updated: updated.count,
          deleted: deleted.count,
          marked: marked[0]?.at instanceof Date,
          reads,
          thread,
        };
      },
    );
    expect(result).toEqual({
      mine: 'ok',
      asShop: 'rls',
      asSomeoneElse: 'rls',
      otherContract: 'rls',
      alreadyRead: 'rls',
      photo: 'ok',
      photoOnShopMessage: 'rls',
      updated: 0,
      deleted: 0,
      marked: true,
      reads: [{ userId: person.id }],
      thread: 2,
    });
    // Fuori dal portale il segno di lettura non si scrive.
    const outside = await withUserContext(
      db,
      person.id,
      (tx) => tx.$queryRaw<{ at: Date | null }[]>`SELECT app_portal_mark_read() AS at`,
    );
    expect(outside).toEqual([{ at: null }]);
  });

  it('a contratto finito il portale non scrive più messaggi (il filo si legge e basta)', async () => {
    const ended = await careContract(tenantA.tenantId, 'Consultorio Cerrado');
    await grantPortal(ended, person, { onlyContract: true });
    await withSystemContext(db, { reason: 'test: contratto finito' }, (tx) =>
      tx.customerSubscription.update({
        where: { id: ended.subscriptionId },
        data: { status: 'ENDED', endDate: new Date(), endedAt: new Date() },
      }),
    );
    const outcome = await withPortalContext(
      db,
      { userId: person.id, subscriptionId: ended.subscriptionId },
      async (tx, entry) => {
        try {
          await tx.careMessage.create({
            data: {
              tenantId: tenantA.tenantId,
              customerId: ended.customerId,
              subscriptionId: ended.subscriptionId,
              authorKind: 'CUSTOMER',
              authorUserId: person.id,
              body: '¿Siguen?',
              submitKey: randomUUID(),
            },
          });
          return { readOnly: entry.readOnly, inserted: true };
        } catch (error) {
          if (!isRlsViolation(error)) throw error;
          return { readOnly: entry.readOnly, inserted: false };
        }
      },
    );
    expect(outcome).toEqual({ readOnly: true, inserted: false });
  });

  it('assistente (6b): solo i propri casi e risposte; i crediti solo con le funzioni, mai sotto zero', async () => {
    const tenantId = tenantA.tenantId;
    await withSystemContext(db, { reason: 'test: crediti dell’assistente' }, (tx) =>
      tx.assistantCreditAllocation.create({
        data: { tenantId, subscriptionId: own.subscriptionId, kind: 'GIVE', credits: 2 },
      }),
    );
    const key = () =>
      `tenants/${tenantId}/care-photos/${own.subscriptionId}-assistant-${randomUUID()}`;
    const caseOf = (overrides: Record<string, unknown> = {}) => ({
      tenantId,
      customerId: own.customerId,
      subscriptionId: own.subscriptionId,
      channel: 'PORTAL' as const,
      askedByUserId: person.id,
      photoUsable: true,
      storageKey: `${key()}.jpg`,
      thumbKey: `${key()}-thumb.jpg`,
      ...overrides,
    });
    // Un caso della fioreria sullo stesso contratto: la persona non lo vede.
    await withSystemContext(db, { reason: 'test: caso della fioreria' }, (tx) =>
      tx.assistantCase.create({ data: caseOf({ channel: 'SHOP', askedByUserId: null }) }),
    );
    const result = await withPortalContext(
      db,
      { userId: person.id, subscriptionId: own.subscriptionId },
      async (tx) => {
        const attempt = async (run: () => Promise<unknown>) => {
          await tx.$executeRaw`SAVEPOINT a`;
          try {
            await run();
            await tx.$executeRaw`RELEASE SAVEPOINT a`;
            return 'ok';
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT a`;
            if (isRlsViolation(error)) return 'rls';
            throw error;
          }
        };
        const mine = await tx.assistantCase.create({ data: caseOf(), select: { id: true } });
        const asShop = await attempt(() =>
          tx.assistantCase.create({ data: caseOf({ channel: 'SHOP' }) }),
        );
        const forSomeoneElse = await attempt(() =>
          tx.assistantCase.create({ data: caseOf({ askedByUserId: stranger.id }) }),
        );
        const dayStart = new Date(Date.now() - 60_000);
        const credits = () =>
          tx.$queryRaw<
            {
              allocated: number;
              used: number;
              held: number;
              answers_since: number;
              cases_since: number;
            }[]
          >`SELECT * FROM app_portal_assistant_credits(${dayStart})`;
        const reserve = async () =>
          (
            await tx.$queryRaw<{ hold: string | null }[]>`
            SELECT app_portal_assistant_reserve(120) AS hold`
          )[0]?.hold ?? null;
        const before = (await credits())[0];
        const first = await reserve();
        const second = await reserve();
        const third = await reserve();
        // La risposta usa la prima riserva nella stessa transazione; la seconda si rende.
        const answer = await attempt(() =>
          tx.assistantAnswer.create({
            data: {
              tenantId,
              caseId: mine.id,
              subscriptionId: own.subscriptionId,
              channel: 'PORTAL',
              askedByUserId: person.id,
              kind: 'CARE',
              question: '¿Cada cuándo la riego?',
              answer: 'Cuando la tierra esté seca.',
            },
          }),
        );
        const answerForSomeoneElse = await attempt(() =>
          tx.assistantAnswer.create({
            data: {
              tenantId,
              caseId: mine.id,
              subscriptionId: own.subscriptionId,
              channel: 'PORTAL',
              askedByUserId: stranger.id,
              question: '¿?',
              answer: 'No.',
            },
          }),
        );
        // La chiamata si scrive senza RETURNING: il portale non legge le chiamate.
        await tx.assistantCall.createMany({
          data: [
            {
              tenantId,
              caseId: mine.id,
              kind: 'ANSWER',
              status: 'SUCCEEDED',
              model: 'claude-haiku-5-5',
              promptVersion: 'v2',
              costMicros: 200,
            },
          ],
        });
        const released = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT app_portal_assistant_release(${first}::uuid) AS ok`;
        await tx.$queryRaw`SELECT app_portal_assistant_release(${second}::uuid)`;
        return {
          asShop,
          forSomeoneElse,
          before,
          first,
          second,
          third,
          answer,
          answerForSomeoneElse,
          released: released[0]?.ok,
          after: (await credits())[0],
          visibleCases: await tx.assistantCase.count(),
          visibleCalls: await tx.assistantCall.count(),
        };
      },
    );
    expect(result).toMatchObject({
      asShop: 'rls',
      forSomeoneElse: 'rls',
      before: { allocated: 2, used: 0, held: 0, answers_since: 0, cases_since: 1 },
      third: null,
      answer: 'ok',
      answerForSomeoneElse: 'rls',
      released: true,
      after: { allocated: 2, used: 1, held: 0, answers_since: 1, cases_since: 1 },
      visibleCases: 1,
      visibleCalls: 0,
    });
    expect(result?.first).toBeTruthy();
    expect(result?.second).toBeTruthy();
    // Fuori dal portale le funzioni non danno niente.
    const outside = await withTenantContext(
      db,
      { tenantId: tenantA.tenantId, userId: null },
      (tx) =>
        tx.$queryRaw<{ hold: string | null }[]>`SELECT app_portal_assistant_reserve(120) AS hold`,
    );
    expect(outside[0]?.hold).toBeNull();
  });

  it('assistente (6b): due domande insieme sull’ultimo credito, una sola riserva passa', async () => {
    const race = await careContract(tenantA.tenantId, 'Oficinas Carrera');
    await grantPortal(race, person);
    await withSystemContext(db, { reason: 'test: un credito' }, (tx) =>
      tx.assistantCreditAllocation.create({
        data: {
          tenantId: race.tenantId,
          subscriptionId: race.subscriptionId,
          kind: 'GIVE',
          credits: 1,
        },
      }),
    );
    const attemptReserve = () =>
      withPortalContext(
        db,
        { userId: person.id, subscriptionId: race.subscriptionId },
        async (tx) => {
          const rows = await tx.$queryRaw<{ hold: string | null }[]>`
            SELECT app_portal_assistant_reserve(120) AS hold`;
          // Tiene aperta la transazione: l'altra aspetta il lock del contratto.
          await tx.$executeRaw`SELECT pg_sleep(0.3)`;
          return rows[0]?.hold ?? null;
        },
      );
    const holds = await Promise.all([attemptReserve(), attemptReserve()]);
    expect(holds.filter((hold) => hold !== null)).toHaveLength(1);
  });

  it('nel contesto di scrittura la fioreria deve essere quella del contratto', async () => {
    const wrongShop = await withPortalWriteContext(
      db,
      { userId: person.id, tenantId: tenantB.tenantId, subscriptionId: own.subscriptionId },
      async () => 'aperto',
    );
    expect(wrongShop).toBeNull();
    const guarded = await withPortalWriteContext(
      db,
      { userId: person.id, tenantId: tenantA.tenantId, subscriptionId: own.subscriptionId },
      async (tx) => {
        // Nel contesto di scrittura si legge tutta la fioreria (i posti si contano sulle visite di
        // tutti i clienti); la guardia sulle visite la provano i test dei servizi.
        const other = await tx.customerSubscription.count({
          where: { id: otherCustomer.subscriptionId },
        });
        return { other };
      },
    );
    expect(guarded).toEqual({ other: 1 });
  });
});

// -----------------------------------------------------------------------------
// Marketplace M3: chi compra scrive solo sul suo ordine (ADR-088)
// -----------------------------------------------------------------------------

/** Le tabelle dell'ordine con la guardia di chi compra (policy RESTRICTIVE `buyer_order_guard`). */
const BUYER_ORDER_GUARD_TABLES = [
  'Order',
  'OrderBuyerRead',
  'OrderChangeRequest',
  'OrderLine',
  'OrderMessage',
  'OrderNotice',
  'OrderPayment',
  'OrderPaymentProof',
  'OrderPhoto',
  'OrderStatusEvent',
  'PublicLink',
];

let orderNumber = 9000;

/** Un ordine online confermato di `buyer` (fixture di sistema). */
async function onlineOrder(tenantId: string, buyer: TestUser | null) {
  orderNumber += 1;
  const number = orderNumber;
  return withSystemContext(db, { reason: 'test fixture: online order' }, async (tx) => {
    const customer = await tx.customer.create({
      data: { tenantId, displayName: `Cliente en línea ${number}` },
    });
    return tx.order.create({
      data: {
        tenantId,
        number,
        customerId: customer.id,
        status: 'CONFIRMED',
        currency: 'MXN',
        fulfillmentMode: 'PICKUP',
        scheduledDate: new Date('2026-12-01T00:00:00Z'),
        subtotalMinor: 10000,
        totalMinor: 10000,
        placedOnline: buyer !== null,
        buyerUserId: buyer?.id ?? null,
      },
      select: { id: true, tenantId: true },
    });
  });
}

describe('ordini online: la guardia di chi compra (ADR-088)', () => {
  let buyer: TestUser;
  let stranger: TestUser;
  let mine: { id: string; tenantId: string };
  let another: { id: string; tenantId: string };
  let counter: { id: string; tenantId: string };
  let otherShop: { id: string; tenantId: string };

  beforeAll(async () => {
    buyer = await createTestUser(db);
    stranger = await createTestUser(db);
    mine = await onlineOrder(tenantA.tenantId, buyer);
    another = await onlineOrder(tenantA.tenantId, stranger);
    counter = await onlineOrder(tenantA.tenantId, null);
    otherShop = await onlineOrder(tenantB.tenantId, buyer);
  });

  it('ogni guardia è RESTRICTIVE, per tutti i comandi, sulle sole tabelle dell’ordine', async () => {
    const policies = await withSystemContext(
      db,
      { reason: 'test: guardia ordini' },
      (tx) =>
        tx.$queryRaw<{ tablename: string; cmd: string; permissive: string }[]>`
        SELECT tablename, cmd, permissive FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'buyer_order_guard'
        ORDER BY tablename`,
    );
    expect(policies.map((policy) => policy.tablename)).toEqual(BUYER_ORDER_GUARD_TABLES);
    expect(policies.every((p) => p.cmd === 'ALL' && p.permissive === 'RESTRICTIVE')).toBe(true);
  });

  it('con la guardia si vede e si tocca solo quell’ordine; senza, la fioreria vede tutto', async () => {
    const guarded = await withBuyerOrderContext(
      db,
      { tenantId: tenantA.tenantId, userId: buyer.id, orderId: mine.id },
      async (tx) => {
        const visible = await tx.order.findMany({
          where: { tenantId: tenantA.tenantId },
          select: { id: true },
        });
        const touched = await tx.order.updateMany({
          where: { tenantId: tenantA.tenantId, id: another.id },
          data: { notes: 'no' },
        });
        return { visible: visible.map((row) => row.id), touched: touched.count };
      },
    );
    expect(guarded).toEqual({ visible: [mine.id], touched: 0 });

    const message = (orderId: string) => ({
      tenantId: tenantA.tenantId,
      orderId,
      authorKind: 'BUYER' as const,
      authorUserId: buyer.id,
      body: 'Hola',
      submitKey: randomUUID(),
    });
    await expect(
      withBuyerOrderContext(
        db,
        { tenantId: tenantA.tenantId, userId: buyer.id, orderId: mine.id },
        (tx) => tx.orderMessage.create({ data: message(another.id) }),
      ),
    ).rejects.toSatisfy(isRlsViolation);
    await withBuyerOrderContext(
      db,
      { tenantId: tenantA.tenantId, userId: buyer.id, orderId: mine.id },
      (tx) => tx.orderMessage.create({ data: message(mine.id) }),
    );

    // La variabile non passa alla transazione dopo: la fioreria vede di nuovo tutti i suoi ordini.
    const shop = await withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.order.count({ where: { tenantId: tenantA.tenantId, id: { in: [mine.id, another.id] } } }),
    );
    expect(shop).toBe(2);
  });

  it('la fioreria di un ordine la dà solo a chi l’ha fatto online', async () => {
    const shopOf = (user: TestUser, orderId: string) =>
      withUserContext(
        db,
        user.id,
        (tx) =>
          tx.$queryRaw<{ tenant_id: string; shop_active: boolean }[]>`
          SELECT tenant_id, shop_active FROM app_buyer_order_shop(${orderId}::uuid)`,
      );
    expect(await shopOf(buyer, mine.id)).toEqual([
      { tenant_id: tenantA.tenantId, shop_active: true },
    ]);
    expect(await shopOf(buyer, otherShop.id)).toEqual([
      { tenant_id: tenantB.tenantId, shop_active: true },
    ]);
    expect(await shopOf(buyer, another.id)).toEqual([]);
    expect(await shopOf(stranger, mine.id)).toEqual([]);
    expect(await shopOf(buyer, counter.id)).toEqual([]);
    // Senza utente nel contesto non risponde niente.
    const anonymous = await withTenantContext(
      db,
      { tenantId: tenantA.tenantId, userId: null },
      (tx) =>
        tx.$queryRaw<
          { tenant_id: string }[]
        >`SELECT tenant_id FROM app_buyer_order_shop(${mine.id}::uuid)`,
    );
    expect(anonymous).toEqual([]);
  });

  it('«I miei ordini» conta i messaggi nuovi della fioreria dopo l’ultima lettura', async () => {
    const order = await onlineOrder(tenantA.tenantId, buyer);
    const newMessages = async () => {
      const rows = await withUserContext(
        db,
        buyer.id,
        (tx) =>
          tx.$queryRaw<{ order_id: string; new_messages: number }[]>`
          SELECT order_id, new_messages FROM app_buyer_orders()`,
      );
      return rows.find((row) => row.order_id === order.id)?.new_messages;
    };
    await withSystemContext(db, { reason: 'test: messaggi della fioreria' }, async (tx) => {
      for (const body of ['Uno', 'Dos']) {
        await tx.orderMessage.create({
          data: {
            tenantId: order.tenantId,
            orderId: order.id,
            authorKind: 'SHOP',
            body,
            submitKey: randomUUID(),
            createdAt: new Date(Date.now() - 60_000),
          },
        });
      }
    });
    expect(await newMessages()).toBe(2);
    await withBuyerOrderContext(
      db,
      { tenantId: order.tenantId, userId: buyer.id, orderId: order.id },
      (tx) =>
        tx.orderBuyerRead.create({
          data: { tenantId: order.tenantId, orderId: order.id, userId: buyer.id },
        }),
    );
    expect(await newMessages()).toBe(0);
  });

  it('un messaggio ha testo o foto, e la foto sta nella cartella della sua fioreria', async () => {
    const base = {
      tenantId: tenantA.tenantId,
      orderId: mine.id,
      authorKind: 'SHOP' as const,
    };
    const insert = (data: Record<string, unknown>) =>
      withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
        tx.orderMessage.create({ data: { ...base, submitKey: randomUUID(), ...data } }),
      );
    await expect(insert({ body: '' })).rejects.toThrow();
    await expect(
      insert({
        body: '',
        photoKey: `tenants/${tenantB.tenantId}/order-messages/x.jpg`,
        photoThumbKey: `tenants/${tenantB.tenantId}/order-messages/x-thumb.jpg`,
        photoWidth: 10,
        photoHeight: 10,
      }),
    ).rejects.toThrow();
    await expect(insert({ body: 'Hola', readByShopAt: new Date() })).rejects.toThrow();
    await expect(
      insert({
        body: '',
        photoKey: `tenants/${tenantA.tenantId}/order-messages/x.jpg`,
        photoThumbKey: `tenants/${tenantA.tenantId}/order-messages/x-thumb.jpg`,
        photoWidth: 10,
        photoHeight: 10,
      }),
    ).resolves.toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // M3-2: cambi da confermare e domande «sì / no»
  // ---------------------------------------------------------------------------

  const snapshot = { lines: [], totalMinor: 10000 };

  it('la richiesta di cambi: chi compra tocca solo quella del suo ordine', async () => {
    const order = await onlineOrder(tenantA.tenantId, buyer);
    const other = await onlineOrder(tenantA.tenantId, stranger);
    await withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, async (tx) => {
      for (const target of [order, other]) {
        await tx.orderChangeRequest.create({
          data: {
            tenantId: tenantA.tenantId,
            orderId: target.id,
            status: 'ASKED',
            before: snapshot,
            after: snapshot,
            round: 1,
            askedAt: new Date(),
          },
        });
      }
    });
    const seen = await withBuyerOrderContext(
      db,
      { tenantId: tenantA.tenantId, userId: buyer.id, orderId: order.id },
      async (tx) => {
        const visible = await tx.orderChangeRequest.findMany({
          where: { tenantId: tenantA.tenantId },
          select: { orderId: true },
        });
        const touched = await tx.orderChangeRequest.updateMany({
          where: { tenantId: tenantA.tenantId, orderId: other.id },
          data: { status: 'CONFIRMED', answeredAt: new Date() },
        });
        const own = await tx.orderChangeRequest.updateMany({
          where: { tenantId: tenantA.tenantId, orderId: order.id },
          data: { status: 'DECLINED', answeredAt: new Date() },
        });
        return {
          visible: visible.map((row) => row.orderId),
          touched: touched.count,
          own: own.count,
        };
      },
    );
    expect(seen).toEqual({ visible: [order.id], touched: 0, own: 1 });
    // Dall'altra fioreria non si vede niente.
    const fromB = await withTenantContext(db, { tenantId: tenantB.tenantId, userId: null }, (tx) =>
      tx.orderChangeRequest.count({ where: { orderId: { in: [order.id, other.id] } } }),
    );
    expect(fromB).toBe(0);
  });

  it('la richiesta di cambi: stati, fotografie e testi dentro i limiti', async () => {
    const order = await onlineOrder(tenantA.tenantId, buyer);
    const create = (data: Record<string, unknown>) =>
      withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
        tx.orderChangeRequest.create({
          data: { tenantId: tenantA.tenantId, orderId: order.id, before: snapshot, ...data },
        }),
      );
    // Chiesta senza la fotografia di dopo, risposta senza data, stato sconosciuto, testi lunghi.
    await expect(create({ status: 'ASKED', round: 1, askedAt: new Date() })).rejects.toThrow();
    await expect(
      create({ status: 'DECLINED', after: snapshot, round: 1, askedAt: new Date() }),
    ).rejects.toThrow();
    await expect(create({ status: 'MAYBE' })).rejects.toThrow();
    await expect(create({ before: [] })).rejects.toThrow();
    await expect(create({ message: 'x'.repeat(501) })).rejects.toThrow();
    await expect(create({ declineReason: '' })).rejects.toThrow();
    await expect(create({})).resolves.toMatchObject({ status: 'EDITING', round: 0 });
  });

  it('domanda e risposta: la domanda della fioreria, una risposta di chi compra, dello stesso ordine', async () => {
    const order = await onlineOrder(tenantA.tenantId, buyer);
    const other = await onlineOrder(tenantA.tenantId, buyer);
    const shopInsert = (data: Record<string, unknown>) =>
      withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
        tx.orderMessage.create({
          data: { tenantId: tenantA.tenantId, submitKey: randomUUID(), ...data } as never,
        }),
      );
    const question = await shopInsert({
      orderId: order.id,
      authorKind: 'SHOP',
      kind: 'QUESTION',
      body: '¿Te parece el sábado?',
    });
    // Una domanda la scrive la fioreria e ha il testo.
    await expect(
      shopInsert({ orderId: order.id, authorKind: 'BUYER', kind: 'QUESTION', body: '¿Sí?' }),
    ).rejects.toThrow();
    await expect(
      shopInsert({ orderId: order.id, authorKind: 'SHOP', kind: 'QUESTION', body: '' }),
    ).rejects.toThrow();
    const answer = (orderId: string, data: Record<string, unknown> = {}) =>
      withBuyerOrderContext(db, { tenantId: tenantA.tenantId, userId: buyer.id, orderId }, (tx) =>
        tx.orderMessage.create({
          data: {
            tenantId: tenantA.tenantId,
            orderId,
            authorKind: 'BUYER',
            authorUserId: buyer.id,
            kind: 'ANSWER',
            answer: 'YES',
            answersMessageId: question.id,
            submitKey: randomUUID(),
            ...data,
          } as never,
        }),
      );
    // La risposta non ha testo, ha «YES» o «NO» e risponde a una domanda dello stesso ordine.
    await expect(answer(order.id, { body: 'Sí' })).rejects.toThrow();
    await expect(answer(order.id, { answer: 'MAYBE' })).rejects.toThrow();
    await expect(answer(other.id)).rejects.toSatisfy(isForeignKeyViolation);
    await expect(answer(order.id)).resolves.toBeDefined();
    // Una risposta per domanda.
    await expect(answer(order.id, { answer: 'NO' })).rejects.toThrow();
  });

  it('prove di pagamento (M3-3): chi compra vede e tocca solo quelle del suo ordine', async () => {
    const order = await onlineOrder(tenantA.tenantId, buyer);
    const other = await onlineOrder(tenantA.tenantId, stranger);
    const proofKey = (orderId: string) =>
      `tenants/${tenantA.tenantId}/order-payment-proofs/${orderId}-${randomUUID()}.jpg`;
    await withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, async (tx) => {
      for (const [target, owner] of [
        [order, buyer],
        [other, stranger],
      ] as const) {
        await tx.orderPaymentProof.create({
          data: {
            tenantId: tenantA.tenantId,
            orderId: target.id,
            buyerUserId: owner.id,
            amountMinor: 5000,
            photoKey: proofKey(target.id),
            photoThumbKey: proofKey(target.id),
            photoWidth: 800,
            photoHeight: 600,
            submitKey: randomUUID(),
          },
        });
      }
    });
    const seen = await withBuyerOrderContext(
      db,
      { tenantId: tenantA.tenantId, userId: buyer.id, orderId: order.id },
      async (tx) => {
        const visible = await tx.orderPaymentProof.findMany({
          where: { tenantId: tenantA.tenantId },
          select: { orderId: true },
        });
        const touched = await tx.orderPaymentProof.updateMany({
          where: { tenantId: tenantA.tenantId, orderId: other.id },
          data: { note: 'cambiada' },
        });
        return { visible: visible.map((row) => row.orderId), touched: touched.count };
      },
    );
    expect(seen).toEqual({ visible: [order.id], touched: 0 });
    const fromB = await withTenantContext(db, { tenantId: tenantB.tenantId, userId: null }, (tx) =>
      tx.orderPaymentProof.count({ where: { orderId: { in: [order.id, other.id] } } }),
    );
    expect(fromB).toBe(0);
  });

  it('prove di pagamento (M3-3): foto nella cartella della fioreria, stato coerente', async () => {
    const order = await onlineOrder(tenantA.tenantId, buyer);
    const key = `tenants/${tenantA.tenantId}/order-payment-proofs/${order.id}.jpg`;
    const base = {
      tenantId: tenantA.tenantId,
      orderId: order.id,
      buyerUserId: buyer.id,
      amountMinor: 5000,
      photoKey: key,
      photoThumbKey: key,
      photoWidth: 800,
      photoHeight: 600,
    };
    const create = (data: Record<string, unknown>) =>
      withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
        tx.orderPaymentProof.create({ data: { ...base, submitKey: randomUUID(), ...data } }),
      );
    // Foto di un'altra fioreria, importo a zero, stati senza i loro dati, testi lunghi.
    await expect(
      create({ photoKey: `tenants/${tenantB.tenantId}/order-payment-proofs/x.jpg` }),
    ).rejects.toThrow();
    await expect(create({ amountMinor: 0 })).rejects.toThrow();
    await expect(create({ status: 'REJECTED', reviewedAt: new Date() })).rejects.toThrow();
    await expect(create({ status: 'CONFIRMED', reviewedAt: new Date() })).rejects.toThrow();
    await expect(create({ status: 'MAYBE' })).rejects.toThrow();
    await expect(create({ note: 'x'.repeat(301) })).rejects.toThrow();
    await expect(
      create({ status: 'REJECTED', rejectReason: 'No llegó', reviewedAt: new Date() }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
    await expect(create({})).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('contanti (M3-3): uno in attesa per ordine, stato coerente; rimborso negativo e mai stornato', async () => {
    const order = await onlineOrder(tenantA.tenantId, buyer);
    const membership = await withSystemContext(db, { reason: 'test: membro' }, (tx) =>
      tx.membership.findFirstOrThrow({
        where: { tenantId: tenantA.tenantId },
        select: { id: true },
      }),
    );
    const collect = (data: Record<string, unknown> = {}) =>
      withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
        tx.orderCashCollection.create({
          data: {
            tenantId: tenantA.tenantId,
            orderId: order.id,
            collectedByMembershipId: membership.id,
            amountMinor: 5000,
            submitKey: randomUUID(),
            ...data,
          },
        }),
      );
    await expect(collect()).resolves.toMatchObject({ status: 'PENDING' });
    // Il secondo in attesa sullo stesso ordine no; uno rifiutato sì.
    await expect(collect()).rejects.toThrow();
    await expect(
      collect({ status: 'REJECTED', rejectReason: 'No cuadra', reviewedAt: new Date() }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
    await expect(collect({ status: 'REJECTED', reviewedAt: new Date() })).rejects.toThrow();
    // Il rimborso è negativo e senza pagamento collegato; positivo o legato a un pagamento no.
    const pay = (data: Record<string, unknown>) =>
      withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
        tx.orderPayment.create({
          data: {
            tenantId: tenantA.tenantId,
            orderId: order.id,
            method: 'TRANSFER',
            paidOn: new Date('2026-12-01T00:00:00Z'),
            ...data,
          },
          select: { id: true },
        } as never),
      );
    const deposit = await pay({ kind: 'DEPOSIT', amountMinor: 5000 });
    await expect(pay({ kind: 'REFUND', amountMinor: 3000 })).rejects.toThrow();
    await expect(
      pay({ kind: 'REFUND', amountMinor: -3000, reversedPaymentId: deposit.id }),
    ).rejects.toThrow();
    await expect(pay({ kind: 'REFUND', amountMinor: -3000 })).resolves.toBeTruthy();
  });

  it('«Scarica i miei dati»: le prove della persona, senza foto né ID', async () => {
    const order = await onlineOrder(tenantA.tenantId, buyer);
    const key = `tenants/${tenantA.tenantId}/order-payment-proofs/${order.id}-data.jpg`;
    await withTenantContext(db, { tenantId: tenantA.tenantId, userId: null }, (tx) =>
      tx.orderPaymentProof.create({
        data: {
          tenantId: tenantA.tenantId,
          orderId: order.id,
          buyerUserId: buyer.id,
          amountMinor: 4200,
          note: 'SPEI de las 10',
          photoKey: key,
          photoThumbKey: key,
          photoWidth: 800,
          photoHeight: 600,
          submitKey: randomUUID(),
        },
      }),
    );
    const rows = await withUserContext(
      db,
      buyer.id,
      (tx) =>
        tx.$queryRaw<{ amount_minor: number; note: string; currency: string }[]>`
        SELECT amount_minor, note, currency FROM app_buyer_order_payment_proofs()`,
    );
    expect(rows).toContainEqual({ amount_minor: 4200, note: 'SPEI de las 10', currency: 'MXN' });
    const strangers = await withUserContext(
      db,
      stranger.id,
      (tx) => tx.$queryRaw<{ note: string }[]>`SELECT note FROM app_buyer_order_payment_proofs()`,
    );
    expect(strangers.map((row) => row.note)).not.toContain('SPEI de las 10');
  });

  it('«I miei ordini» dice quali ordini hanno cambi da confermare', async () => {
    const order = await onlineOrder(tenantA.tenantId, buyer);
    await withSystemContext(db, { reason: 'test: ordine da accettare con cambi' }, async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'PENDING_ACCEPTANCE' } });
      await tx.orderChangeRequest.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          status: 'ASKED',
          before: snapshot,
          after: snapshot,
          round: 1,
          askedAt: new Date(),
        },
      });
    });
    const toConfirm = async () => {
      const rows = await withUserContext(
        db,
        buyer.id,
        (tx) =>
          tx.$queryRaw<{ order_id: string; changes_to_confirm: boolean }[]>`
          SELECT order_id, changes_to_confirm FROM app_buyer_orders()`,
      );
      return rows.find((row) => row.order_id === order.id)?.changes_to_confirm;
    };
    expect(await toConfirm()).toBe(true);
    await withSystemContext(db, { reason: 'test: cambi confermati' }, (tx) =>
      tx.orderChangeRequest.update({
        where: { tenantId_orderId: { tenantId: order.tenantId, orderId: order.id } },
        data: { status: 'CONFIRMED', answeredAt: new Date() },
      }),
    );
    expect(await toConfirm()).toBe(false);
  });
});
