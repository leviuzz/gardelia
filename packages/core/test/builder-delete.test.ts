import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import { AUDIT_ACTIONS, type BouquetPreviewSpec } from '@floral/domain';
import {
  DELETED_PREVIEW_HASH_PREFIX,
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  createCatalogItem,
  createCustomer,
  createQuoteFromConfiguration,
  deleteBouquetConfiguration,
  getAiPreviewImage,
  getAiQuota,
  getBouquetConfiguration,
  getBouquetPreview,
  requestBouquetPreview,
  saveBouquetConfiguration,
  setAiProvider,
  setBouquetConfigurationArchived,
  setObjectStorage,
  type AiImageProvider,
  type CatalogItemDto,
  type GeneratedImage,
} from '../src/index';
import { processNextAiJob } from '../src/ai/worker';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

/**
 * "Eliminar" di un disegno del Diseñador (ADR-051): via il disegno e le foto generate per lui,
 * solo se nessun preventivo lo usa; i crediti già usati restano usati; le foto che un preventivo o
 * un altro disegno identico mostrano restano.
 */

const db = getDb();

class StubProvider implements AiImageProvider {
  readonly id = 'stub';
  readonly model = 'stub-delete-v1';
  readonly simulated = false;
  readonly supportsSketch = false;
  readonly estimatedCostMicros = 40_000;

  async generate(_request: { readonly spec: BouquetPreviewSpec }): Promise<GeneratedImage> {
    return {
      bytes: new Uint8Array([137, 80, 78, 71, 2]),
      contentType: 'image/png',
      costMicros: 35_000,
    };
  }
}

const storage = new MemoryStorage();
let operatorEmail: string;

interface Kit {
  readonly shop: TestShop;
  readonly rose: CatalogItemDto;
  readonly kraft: CatalogItemDto;
}

async function createKit(name?: string): Promise<Kit> {
  const shop = await createTestShop(name);
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  return {
    shop,
    rose: await createCatalogItem(shop.owner, itemInput({ name: 'Rosa roja' })),
    kraft: await createCatalogItem(
      shop.owner,
      itemInput({
        name: 'Papel kraft',
        type: 'PACKAGING',
        saleUnit: 'PIECE',
        variety: null,
        colors: [],
      }),
    ),
  };
}

function save(kit: Kit, roses: number, name = `Ramo ${roses} rosas`, id?: string) {
  return saveBouquetConfiguration(
    kit.shop.owner,
    {
      name,
      style: 'ROMANTIC',
      size: 'MEDIUM',
      budget: '',
      notes: '',
      lines: [
        { catalogItemId: kit.rose.id, quantity: roses },
        { catalogItemId: kit.kraft.id, quantity: 1 },
      ],
    },
    id,
  );
}

/** Anteprima pronta per il disegno (accoda e lavora il job). */
async function previewReady(kit: Kit, configurationId: string, anotherVersion = false) {
  const requested = await requestBouquetPreview(kit.shop.owner, configurationId, new Date(), {
    anotherVersion,
  });
  expect(await processNextAiJob({ onlyTenantId: kit.shop.tenant.tenantId })).toBe('succeeded');
  return requested.jobId;
}

async function jobRow(jobId: string) {
  return withSystemContext(db, { reason: 'test: job' }, (tx) =>
    tx.aiJob.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        status: true,
        usageUnits: true,
        bouquetConfigurationId: true,
        outputKey: true,
        inputHash: true,
      },
    }),
  );
}

async function quoteFor(kit: Kit, configurationId: string) {
  const customer = await createCustomer(kit.shop.owner, {
    type: 'PERSON',
    displayName: 'Cliente Eliminar',
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550123',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });
  return createQuoteFromConfiguration(kit.shop.owner, {
    configurationId,
    customerId: customer.id,
  });
}

async function linesOf(configurationId: string) {
  return withSystemContext(db, { reason: 'test: righe' }, (tx) =>
    tx.bouquetConfigurationLine.count({ where: { configurationId } }),
  );
}

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador Eliminar' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
  setObjectStorage(storage);
  setAiProvider(new StubProvider());
});

afterAll(async () => {
  setAiProvider(undefined);
  setObjectStorage(null);
  await disconnectDb();
});

describe('eliminare un disegno', () => {
  it('via il disegno e le sue foto; i crediti usati restano usati e la cache non le ridà', async () => {
    const kit = await createKit();
    const design = await save(kit, 12);
    const first = await previewReady(kit, design.id);
    const second = await previewReady(kit, design.id, true);
    const keys = [(await jobRow(first)).outputKey!, (await jobRow(second)).outputKey!];
    expect(keys.every((key) => storage.objects.has(key))).toBe(true);
    expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(2);
    expect((await getBouquetConfiguration(kit.shop.owner, design.id)).usedInQuotes).toBe(false);

    expect(await deleteBouquetConfiguration(kit.shop.manager, design.id)).toEqual({
      deletedImages: 2,
      keptImages: 0,
    });

    await expect(getBouquetConfiguration(kit.shop.owner, design.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await linesOf(design.id)).toBe(0);
    expect(keys.some((key) => storage.objects.has(key))).toBe(false);
    for (const jobId of [first, second]) {
      const job = await jobRow(jobId);
      expect(job).toMatchObject({
        status: 'SUCCEEDED',
        usageUnits: 1,
        bouquetConfigurationId: null,
        outputKey: null,
      });
      expect(job.inputHash.startsWith(DELETED_PREVIEW_HASH_PREFIX)).toBe(true);
      await expect(getAiPreviewImage(kit.shop.owner, jobId)).rejects.toBeInstanceOf(NotFoundError);
    }
    // I crediti non tornano.
    expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(2);

    const audit = await withSystemContext(db, { reason: 'test: audit' }, (tx) =>
      tx.auditLog.findFirst({
        where: { entityId: design.id, action: AUDIT_ACTIONS.builderConfigurationDeleted },
        select: { tenantId: true, actorUserId: true, metadata: true },
      }),
    );
    expect(audit).toMatchObject({
      tenantId: kit.shop.tenant.tenantId,
      actorUserId: kit.shop.manager.userId,
      metadata: { name: 'Ramo 12 rosas', deletedImages: 2, keptImages: 0 },
    });

    // Un disegno nuovo uguale non ritrova la foto cancellata: ne genera una nuova.
    const again = await save(kit, 12);
    expect(await requestBouquetPreview(kit.shop.owner, again.id)).toMatchObject({
      status: 'QUEUED',
      reused: false,
    });
  });

  it('in un preventivo: non si elimina (si archivia) e non cambia nulla', async () => {
    const kit = await createKit();
    const design = await save(kit, 6);
    const jobId = await previewReady(kit, design.id);
    await quoteFor(kit, design.id);
    expect((await getBouquetConfiguration(kit.shop.owner, design.id)).usedInQuotes).toBe(true);

    await expect(deleteBouquetConfiguration(kit.shop.owner, design.id)).rejects.toMatchObject({
      reason: 'builder_configuration_in_quote',
    });
    expect(await linesOf(design.id)).toBe(2);
    expect(await jobRow(jobId)).toMatchObject({ bouquetConfigurationId: design.id });
    expect((await getAiPreviewImage(kit.shop.owner, jobId)).bytes.length).toBeGreaterThan(0);

    await setBouquetConfigurationArchived(kit.shop.owner, design.id, true);
    expect((await getBouquetConfiguration(kit.shop.owner, design.id)).status).toBe('ARCHIVED');
  });

  it('una foto in preparazione blocca l’eliminazione finché non finisce', async () => {
    const kit = await createKit();
    const design = await save(kit, 4);
    const queued = await requestBouquetPreview(kit.shop.owner, design.id);
    await expect(deleteBouquetConfiguration(kit.shop.owner, design.id)).rejects.toMatchObject({
      reason: 'ai_preview_in_progress',
    });
    expect(await jobRow(queued.jobId)).toMatchObject({
      status: 'QUEUED',
      bouquetConfigurationId: design.id,
    });

    expect(await processNextAiJob({ onlyTenantId: kit.shop.tenant.tenantId })).toBe('succeeded');
    expect(await deleteBouquetConfiguration(kit.shop.owner, design.id)).toEqual({
      deletedImages: 1,
      keptImages: 0,
    });
  });

  it('la foto che un disegno identico mostra passa a lui; quella di un preventivo resta', async () => {
    const kit = await createKit();
    // Due disegni con lo stesso ramo condividono la foto (cache per contenuto).
    const original = await save(kit, 7, 'Ramo para Ana');
    const shared = await previewReady(kit, original.id);
    const twin = await save(kit, 7, 'Ramo para Bea');
    expect(await requestBouquetPreview(kit.shop.owner, twin.id)).toMatchObject({
      jobId: shared,
      reused: true,
    });

    expect(await deleteBouquetConfiguration(kit.shop.owner, original.id)).toEqual({
      deletedImages: 0,
      keptImages: 1,
    });
    expect(await jobRow(shared)).toMatchObject({ bouquetConfigurationId: twin.id });
    expect((await getBouquetPreview(kit.shop.owner, twin.id)).preview).toMatchObject({
      jobId: shared,
      status: 'SUCCEEDED',
    });
    expect((await getAiPreviewImage(kit.shop.owner, shared)).bytes.length).toBeGreaterThan(0);

    // Foto finita in un preventivo di un altro disegno, che poi è cambiato: resta per il preventivo.
    const source = await save(kit, 9, 'Ramo para Carla');
    const quoted = await previewReady(kit, source.id);
    const copy = await save(kit, 9, 'Ramo para Dora');
    await quoteFor(kit, copy.id);
    await save(kit, 10, 'Ramo para Dora', copy.id);
    expect(await deleteBouquetConfiguration(kit.shop.owner, source.id)).toEqual({
      deletedImages: 0,
      keptImages: 1,
    });
    expect(await jobRow(quoted)).toMatchObject({ bouquetConfigurationId: null });
    expect((await getAiPreviewImage(kit.shop.owner, quoted)).bytes.length).toBeGreaterThan(0);

    // Anche un disegno identico ma archiviato la eredita: ripristinato, la rivede.
    const lead = await save(kit, 11, 'Ramo para Elena');
    const leadPhoto = await previewReady(kit, lead.id);
    const archivedTwin = await save(kit, 11, 'Ramo para Flor');
    await setBouquetConfigurationArchived(kit.shop.owner, archivedTwin.id, true);
    expect(await deleteBouquetConfiguration(kit.shop.owner, lead.id)).toEqual({
      deletedImages: 0,
      keptImages: 1,
    });
    await setBouquetConfigurationArchived(kit.shop.owner, archivedTwin.id, false);
    expect((await getBouquetPreview(kit.shop.owner, archivedTwin.id)).preview).toMatchObject({
      jobId: leadPhoto,
      status: 'SUCCEEDED',
    });
  });

  it('solo proprietario e manager; un’altra fioreria riceve 404 e non cambia nulla', async () => {
    const kit = await createKit('Florería Eliminar A');
    const other = await createKit('Florería Eliminar B');
    const design = await save(kit, 3);

    await expect(deleteBouquetConfiguration(kit.shop.staff, design.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(deleteBouquetConfiguration(other.shop.owner, design.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteBouquetConfiguration(kit.shop.owner, 'no-es-un-id')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getBouquetConfiguration(kit.shop.owner, design.id)).name).toBe('Ramo 3 rosas');
    expect(await linesOf(design.id)).toBe(2);
  });
});
