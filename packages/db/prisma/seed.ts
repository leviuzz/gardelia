/**
 * Seed demo IDEMPOTENTE e NON DISTRUTTIVO: si può rieseguire senza duplicare dati e senza
 * sovrascrivere le modifiche fatte a mano (gli upsert non aggiornano i record esistenti).
 *
 *   pnpm db:seed
 *
 * Crea: tassonomia fiori, "Florería Las Camelias" (owner/manager/staff, 14 articoli,
 * 2 ricette bouquet, 3 clienti, piano Plus in pilota) e "Flores del Valle" (secondo tenant
 * per verificare l'isolamento, piano Basic). Si rifiuta di girare con NODE_ENV=production.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import { config as loadEnv } from 'dotenv';
import { isBuilderComponentType, newId } from '@floral/domain';
import { createDbClient, type DbClient } from '../src/client';
import { withSystemContext, type TransactionClient } from '../src/tenancy';
import {
  DEMO_CATALOG,
  DEMO_CUSTOMERS,
  DEMO_RECIPES,
  DEMO_TENANT,
  DEMO_USERS,
  SECOND_TENANT,
} from './seed-data';
import { upsertCanonicalFlowers } from '../src/reference-data';

export interface SeedResult {
  readonly tenants: readonly string[];
  readonly users: number;
  readonly catalogItems: number;
  readonly recipes: number;
  readonly customers: number;
}

interface TenantSeed {
  readonly slug: string;
  readonly displayName: string;
  /** Cargo per l'armado nel Builder (unità minime). */
  readonly builderLaborFeeMinor?: number;
  readonly legalName?: string;
  readonly contactEmail?: string;
  readonly contactPhone?: string;
  readonly location: {
    readonly name: string;
    readonly addressLine1: string;
    readonly neighborhood: string;
    readonly city: string;
    readonly region: string;
    readonly postalCode: string;
    readonly phone?: string;
    readonly deliveryRadiusKm: number;
  };
}

async function upsertTenant(tx: TransactionClient, seed: TenantSeed): Promise<string> {
  const tenant = await tx.tenant.upsert({
    where: { slug: seed.slug },
    update: {},
    create: {
      id: newId(),
      slug: seed.slug,
      displayName: seed.displayName,
      legalName: seed.legalName ?? null,
      contactEmail: seed.contactEmail ?? null,
      contactPhone: seed.contactPhone ?? null,
      marketCountry: 'MX',
      currency: 'MXN',
      timezone: 'America/Mexico_City',
      defaultLocale: 'es-MX',
      mode: 'DEMO',
      onboardingCompletedAt: new Date(),
      builderLaborFeeMinor: seed.builderLaborFeeMinor ?? 0,
    },
  });
  const primary = await tx.location.findFirst({ where: { tenantId: tenant.id, isPrimary: true } });
  if (!primary) {
    await tx.location.create({
      data: {
        tenantId: tenant.id,
        isPrimary: true,
        name: seed.location.name,
        addressLine1: seed.location.addressLine1,
        neighborhood: seed.location.neighborhood,
        city: seed.location.city,
        region: seed.location.region,
        postalCode: seed.location.postalCode,
        countryCode: 'MX',
        phone: seed.location.phone ?? null,
        timezone: 'America/Mexico_City',
        deliveryRadiusKm: seed.location.deliveryRadiusKm,
      },
    });
  }
  return tenant.id;
}

export async function runSeed(db: DbClient, options: { password: string }): Promise<SeedResult> {
  const passwordHash = await hashPassword(options.password);

  return withSystemContext(
    db,
    { reason: 'seed: dati demo di sviluppo' },
    async (tx) => {
      // Dati di riferimento (anche in produzione arrivano con `pnpm db:deploy`).
      await upsertCanonicalFlowers(tx);
      const canonicalBySlug = new Map(
        (await tx.canonicalFlower.findMany({ select: { id: true, slug: true } })).map((f) => [
          f.slug,
          f.id,
        ]),
      );

      const tenantIds = {
        demo: await upsertTenant(tx, DEMO_TENANT),
        second: await upsertTenant(tx, SECOND_TENANT),
      };

      for (const seedUser of DEMO_USERS) {
        const user = await tx.user.upsert({
          where: { email: seedUser.email },
          update: {},
          create: { id: newId(), email: seedUser.email, name: seedUser.name, emailVerified: true },
        });
        await tx.account.upsert({
          where: { providerId_accountId: { providerId: 'credential', accountId: user.id } },
          update: {},
          create: {
            userId: user.id,
            providerId: 'credential',
            accountId: user.id,
            password: passwordHash,
          },
        });
        const tenantId = tenantIds[seedUser.tenant];
        await tx.membership.upsert({
          where: { tenantId_userId: { tenantId, userId: user.id } },
          update: {},
          create: { tenantId, userId: user.id, role: seedUser.role },
        });
      }

      const itemIdBySku = new Map<string, string>();
      for (const item of DEMO_CATALOG) {
        const record = await tx.catalogItem.upsert({
          where: { tenantId_sku: { tenantId: tenantIds.demo, sku: item.sku } },
          update: {},
          create: {
            tenantId: tenantIds.demo,
            sku: item.sku,
            type: item.type,
            name: item.name,
            variety: item.variety ?? null,
            description: item.description ?? null,
            canonicalFlowerId: item.canonical
              ? (canonicalBySlug.get(item.canonical) ?? null)
              : null,
            colors: [...item.colors],
            saleUnit: item.saleUnit,
            priceMinor: item.priceMinor,
            costMinor: item.costMinor,
            currency: 'MXN',
            availability: item.availability,
            prepMinutes: item.prepMinutes ?? null,
            heightCm: item.heightCm ?? null,
            serviceDurationMinutes: item.serviceDurationMinutes ?? null,
            serviceRadiusKm: item.serviceRadiusKm ?? null,
            tags: [...item.tags],
            // Stesso default dei nuovi articoli: i componenti sono utilizzabili nel Builder.
            isBuilderEnabled: isBuilderComponentType(item.type),
          },
        });
        itemIdBySku.set(item.sku, record.id);
      }

      for (const recipe of DEMO_RECIPES) {
        const bouquetId = itemIdBySku.get(recipe.bouquetSku);
        if (!bouquetId) throw new Error(`Bouquet mancante nel seed: ${recipe.bouquetSku}`);
        const saved = await tx.bouquetRecipe.upsert({
          where: { tenantId_catalogItemId: { tenantId: tenantIds.demo, catalogItemId: bouquetId } },
          update: {},
          create: {
            tenantId: tenantIds.demo,
            catalogItemId: bouquetId,
            laborCostMinor: recipe.laborCostMinor,
            styleTags: [...recipe.styleTags],
            substitutionPolicy: recipe.substitutionPolicy,
            notes: recipe.notes,
          },
        });
        for (const [index, line] of recipe.lines.entries()) {
          const ingredientId = itemIdBySku.get(line.sku);
          if (!ingredientId) throw new Error(`Ingrediente mancante nel seed: ${line.sku}`);
          await tx.bouquetRecipeLine.upsert({
            where: {
              tenantId_recipeId_ingredientItemId: {
                tenantId: tenantIds.demo,
                recipeId: saved.id,
                ingredientItemId: ingredientId,
              },
            },
            update: {},
            create: {
              tenantId: tenantIds.demo,
              recipeId: saved.id,
              ingredientItemId: ingredientId,
              quantity: line.quantity,
              sortOrder: index,
            },
          });
        }
      }

      for (const customer of DEMO_CUSTOMERS) {
        const existing = await tx.customer.findFirst({
          where: { tenantId: tenantIds.demo, email: customer.email },
          select: { id: true, _count: { select: { occasions: true } } },
        });
        if (existing) {
          // Date speciali per il calendario anche nei database seminati prima che esistessero.
          if (existing._count.occasions === 0 && customer.occasions.length > 0) {
            await tx.customerOccasion.createMany({
              data: customer.occasions.map((occasion) => ({
                tenantId: tenantIds.demo,
                customerId: existing.id,
                ...occasion,
              })),
            });
          }
          continue;
        }
        await tx.customer.create({
          data: {
            tenantId: tenantIds.demo,
            type: customer.type,
            displayName: customer.displayName,
            email: customer.email,
            phone: customer.phone,
            preferences: customer.preferences,
            restrictions: customer.restrictions,
            tags: [...customer.tags],
            acquisitionSource: 'MERCHANT_DIRECT',
            acquisitionChannel: customer.acquisitionChannel,
            marketingConsent: customer.marketingConsent,
            marketingConsentAt: customer.marketingConsent ? new Date() : null,
            // tenantId e customerId arrivano dalla relazione con il cliente.
            occasions: { create: customer.occasions.map((occasion) => ({ ...occasion })) },
          },
        });
      }

      // La fioreria demo ha Plus (anteprime AI incluse) assegnato dalla piattaforma; la seconda
      // resta senza abbonamento: nella fase di prova (D-29) ha tutte le funzioni ma nessuna
      // anteprima inclusa, solo i crediti assegnati dalla piattaforma.
      const plus = await tx.saasPlan.findUnique({ where: { code: 'PLUS' }, select: { id: true } });
      if (!plus) throw new Error('Piano PLUS mancante: esegui le migrazioni (pnpm db:deploy).');
      await tx.tenantSubscription.upsert({
        where: { tenantId: tenantIds.demo },
        update: {},
        create: { tenantId: tenantIds.demo, planId: plus.id, status: 'PILOT', source: 'MANUAL' },
      });

      // Asistente de plantas (ADR-085): la fioreria demo ha crediti da dare ai suoi servizi, come se
      // li avesse comprati dalla piattaforma (in produzione li accredita l'operazione di piattaforma).
      const assistantGrants = await tx.aiCreditGrant.count({
        where: { tenantId: tenantIds.demo, feature: 'PLANT_ASSISTANT' },
      });
      if (assistantGrants === 0) {
        const owner = await tx.membership.findFirst({
          where: { tenantId: tenantIds.demo, role: 'OWNER' },
          select: { userId: true },
        });
        if (!owner) throw new Error('Proprietario della fioreria demo mancante nel seed.');
        await tx.aiCreditGrant.create({
          data: {
            tenantId: tenantIds.demo,
            feature: 'PLANT_ASSISTANT',
            units: 100,
            note: 'seed: crediti di prova',
            grantedById: owner.userId,
          },
        });
      }

      return {
        tenants: [DEMO_TENANT.slug, SECOND_TENANT.slug],
        users: DEMO_USERS.length,
        catalogItems: await tx.catalogItem.count({ where: { tenantId: tenantIds.demo } }),
        recipes: await tx.bouquetRecipe.count({ where: { tenantId: tenantIds.demo } }),
        customers: await tx.customer.count({ where: { tenantId: tenantIds.demo } }),
      };
    },
    { timeout: 60_000 },
  );
}

async function main(): Promise<void> {
  loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Il seed demo non può essere eseguito in produzione.');
  }
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error('Imposta SEED_DEMO_PASSWORD (almeno 10 caratteri) nel file .env.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL non configurata.');

  const db = createDbClient({ connectionString, poolMax: 2, applicationName: 'floral-seed' });
  try {
    const result = await runSeed(db, { password });
    console.info('Seed completato:', result);
    console.info('Utenti demo (password = SEED_DEMO_PASSWORD):');
    for (const user of DEMO_USERS) console.info(`  ${user.role.padEnd(8)} ${user.email}`);
  } finally {
    await db.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
