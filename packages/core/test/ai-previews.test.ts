import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import type { BouquetPreviewSpec } from '@floral/domain';
import {
  AiProviderError,
  ConflictError,
  ForbiddenError,
  MemoryStorage,
  NotFoundError,
  PlanRequiredError,
  ValidationError,
  createCatalogItem,
  getAiPreviewImage,
  getAiQuota,
  getBouquetConfiguration,
  addStyleReference,
  getBouquetPreview,
  listCanonicalFlowers,
  listStyleReferences,
  setStyleDescriber,
  requestBouquetPreview,
  saveBouquetConfiguration,
  setAiProvider,
  setObjectStorage,
  startAiWorker,
  type AiImageProvider,
  type CatalogItemDto,
  type GeneratedImage,
  type StyleDescriber,
} from '../src/index';
import { drainAiQueue, processNextAiJob } from '../src/ai/worker';
import { assignTenantPlan, grantAiCredits } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();

class StubProvider implements AiImageProvider {
  readonly id = 'stub';
  readonly model = 'stub-v1';
  readonly simulated = false;
  // Anteprime a parole: l'anteprima esatta ha i suoi test (exact-preview.test.ts).
  readonly supportsSketch = false;
  behavior: 'ok' | 'error' | 'reject' | 'invalid' = 'ok';
  calls = 0;
  prompts: string[] = [];

  constructor(readonly estimatedCostMicros = 40_000) {}

  async generate(request: {
    readonly prompt: string;
    readonly spec: BouquetPreviewSpec;
  }): Promise<GeneratedImage> {
    this.calls += 1;
    this.prompts.push(request.prompt);
    if (this.behavior === 'error') throw new AiProviderError('provider_error', 'boom');
    if (this.behavior === 'reject') throw new AiProviderError('content_rejected', 'rejected');
    if (this.behavior === 'invalid') throw new AiProviderError('invalid_request', 'fal 403');
    return {
      bytes: new Uint8Array([137, 80, 78, 71, 1]),
      contentType: 'image/png',
      costMicros: 35_000,
    };
  }
}

class StubDescriber implements StyleDescriber {
  readonly id = 'stub';
  readonly model = 'stub-vision';
  readonly estimatedCostMicros = 5_000;
  calls = 0;
  fail = false;

  async describe() {
    this.calls += 1;
    if (this.fail) throw new AiProviderError('provider_error', 'vision down');
    // La seconda frase nomina un nastro: va scartata prima di arrivare al prompt.
    return {
      en: 'Rustic wooden counter, warm window light from the left. Tied with a satin ribbon.',
      es: 'Mostrador de madera rústico, luz cálida de ventana.',
    };
  }
}

async function referencePhoto(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 800, height: 800, channels: 3, background: '#d8c3a5' } })
      .jpeg()
      .toBuffer(),
  );
}

let operatorEmail: string;
const storage = new MemoryStorage();
const provider = new StubProvider();

async function withPlus(shop: TestShop): Promise<TestShop> {
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  return shop;
}

interface Kit {
  readonly shop: TestShop;
  readonly rose: CatalogItemDto;
  readonly tulip: CatalogItemDto;
  readonly kraft: CatalogItemDto;
}

async function createKit(name?: string): Promise<Kit> {
  const shop = await withPlus(await createTestShop(name));
  return {
    shop,
    rose: await createCatalogItem(shop.owner, itemInput({ name: 'Rosa roja' })),
    tulip: await createCatalogItem(
      shop.owner,
      itemInput({ name: 'Tulipán', variety: null, colors: ['pink'] }),
    ),
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

function save(kit: Kit, roses: number, overrides: Record<string, unknown> = {}) {
  return saveBouquetConfiguration(kit.shop.owner, {
    name: `Ramo ${roses} rosas`,
    style: 'ROMANTIC',
    size: 'MEDIUM',
    budget: '',
    notes: 'Para Sofía, entrega el viernes',
    lines: [
      { catalogItemId: kit.rose.id, quantity: roses },
      { catalogItemId: kit.kraft.id, quantity: 1 },
    ],
    ...overrides,
  });
}

async function runOnce(kit: Kit) {
  return processNextAiJob({ onlyTenantId: kit.shop.tenant.tenantId });
}

async function makeRunnableNow(jobId: string) {
  await withSystemContext(db, { reason: 'test: anticipa il retry' }, (tx) =>
    tx.aiJob.update({ where: { id: jobId }, data: { runAfter: new Date(0) } }),
  );
}

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador IA' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
  setObjectStorage(storage);
  setAiProvider(provider);
});

afterAll(async () => {
  setAiProvider(undefined);
  setObjectStorage(null);
  await disconnectDb();
});

describe('disponibilità e piano', () => {
  it('senza provider configurato la funzione non esiste (nessuna anteprima finta)', async () => {
    const kit = await createKit();
    const { id } = await save(kit, 5);
    setAiProvider(null);
    try {
      expect(await getBouquetPreview(kit.shop.owner, id)).toMatchObject({
        available: false,
        preview: null,
        quota: null,
      });
      await expect(requestBouquetPreview(kit.shop.owner, id)).rejects.toMatchObject({
        reason: 'ai_unavailable',
      });
    } finally {
      setAiProvider(provider);
    }
  });

  it('BILL-01: una fioreria Basic non usa le anteprime', async () => {
    const basic = await createTestShop();
    await expect(getAiQuota(basic.owner)).rejects.toBeInstanceOf(PlanRequiredError);
  });
});

describe('generazione, cache e consumo', () => {
  it('il credito si prenota, si consuma solo a successo e il ramo identico si riusa', async () => {
    const kit = await createKit();
    const first = await save(kit, 12);
    const before = await getAiQuota(kit.shop.owner);
    expect(before).toMatchObject({ includedLimit: 25, includedUsed: 0, remaining: 25 });

    const queued = await requestBouquetPreview(kit.shop.owner, first.id);
    expect(queued).toMatchObject({ status: 'QUEUED', reused: false, simulated: false });
    expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(1);
    // Una seconda richiesta mentre è in coda non prenota un altro credito.
    expect(await requestBouquetPreview(kit.shop.owner, first.id)).toMatchObject({
      jobId: queued.jobId,
      reused: true,
    });

    expect(await runOnce(kit)).toBe('succeeded');
    const state = await getBouquetPreview(kit.shop.owner, first.id);
    expect(state.preview).toMatchObject({ jobId: queued.jobId, status: 'SUCCEEDED' });
    expect(state.quota).toMatchObject({ includedUsed: 1, includedRemaining: 24 });
    const image = await getAiPreviewImage(kit.shop.owner, queued.jobId);
    expect(image.contentType).toBe('image/png');
    expect(image.bytes.length).toBeGreaterThan(0);

    // Il prompt contiene solo la composizione: niente nome del disegno né note del cliente.
    const prompt = provider.prompts.at(-1) ?? '';
    expect(prompt).toContain('12 stems of "Rosa roja Freedom"');
    expect(prompt).not.toContain('Sofía');
    expect(prompt).not.toContain('Ramo 12 rosas');

    // Altro disegno (altro cliente), stessa composizione: stessa immagine, nessun credito.
    const callsBefore = provider.calls;
    const second = await save(kit, 12, { name: 'Ramo para Lucía', notes: 'Otro cliente' });
    expect(await requestBouquetPreview(kit.shop.manager, second.id)).toMatchObject({
      jobId: queued.jobId,
      status: 'SUCCEEDED',
      reused: true,
    });
    expect((await getBouquetPreview(kit.shop.staff, second.id)).preview?.reused).toBe(true);
    expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(1);
    expect(provider.calls).toBe(callsBefore);

    // Composizione diversa: nuova anteprima.
    const third = await save(kit, 7);
    expect((await requestBouquetPreview(kit.shop.owner, third.id)).jobId).not.toBe(queued.jobId);
  });

  it('"otra versión": foto nuova dello stesso ramo, un credito, mai due per lo stesso clic', async () => {
    const kit = await createKit();
    const design = await save(kit, 5);
    const first = await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('succeeded');
    expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(1);

    // Senza l'opzione: stessa immagine, nessun credito.
    expect(await requestBouquetPreview(kit.shop.owner, design.id)).toMatchObject({
      jobId: first.jobId,
      reused: true,
    });

    // Con l'opzione: nuovo job, un credito; un secondo clic non ne prenota un altro.
    const another = await requestBouquetPreview(kit.shop.owner, design.id, new Date(), {
      anotherVersion: true,
    });
    expect(another).toMatchObject({ status: 'QUEUED', reused: false });
    expect(another.jobId).not.toBe(first.jobId);
    expect(
      await requestBouquetPreview(kit.shop.owner, design.id, new Date(), { anotherVersion: true }),
    ).toMatchObject({ jobId: another.jobId, reused: true });
    expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(2);
    // Mentre è in coda si vede la nuova.
    expect((await getBouquetPreview(kit.shop.owner, design.id)).preview).toMatchObject({
      jobId: another.jobId,
      status: 'QUEUED',
    });

    expect(await runOnce(kit)).toBe('succeeded');
    const state = await getBouquetPreview(kit.shop.owner, design.id);
    expect(state.preview).toMatchObject({ jobId: another.jobId, status: 'SUCCEEDED' });
    expect(state.anotherVersionFailed).toBe(false);
    // La prima immagine resta (i preventivi che la usano la tengono).
    expect((await getAiPreviewImage(kit.shop.owner, first.jobId)).bytes.length).toBeGreaterThan(0);
  });

  it('"otra versión" non riuscita: resta la precedente, nessun credito, ed è segnalato', async () => {
    const kit = await createKit();
    const design = await save(kit, 6);
    const first = await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('succeeded');
    provider.behavior = 'reject';
    try {
      await requestBouquetPreview(kit.shop.owner, design.id, new Date(), {
        anotherVersion: true,
      });
      expect(await runOnce(kit)).toBe('failed');
      const state = await getBouquetPreview(kit.shop.owner, design.id);
      expect(state.preview).toMatchObject({ jobId: first.jobId, status: 'SUCCEEDED' });
      expect(state.anotherVersionFailed).toBe(true);
      expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(1);
    } finally {
      provider.behavior = 'ok';
    }
  });

  it('BQ-02: se l’AI fallisce ritenta, poi fallisce senza consumare e senza immagine', async () => {
    const kit = await createKit();
    const { id } = await save(kit, 9);
    provider.behavior = 'error';
    try {
      const job = await requestBouquetPreview(kit.shop.owner, id);
      expect(await runOnce(kit)).toBe('retry');
      expect((await getBouquetPreview(kit.shop.owner, id)).preview?.status).toBe('QUEUED');
      expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(1);
      for (let attempt = 0; attempt < 2; attempt++) {
        await makeRunnableNow(job.jobId);
        await runOnce(kit);
      }
      const state = await getBouquetPreview(kit.shop.owner, id);
      expect(state.preview).toMatchObject({ status: 'FAILED', errorCode: 'provider_error' });
      expect(state.quota?.includedUsed).toBe(0);
      await expect(getAiPreviewImage(kit.shop.owner, job.jobId)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      // Il disegno resta valido e si può riprovare.
      expect((await getBouquetConfiguration(kit.shop.owner, id)).status).toBe('ACTIVE');
      provider.behavior = 'ok';
      const retry = await requestBouquetPreview(kit.shop.owner, id);
      expect(retry).toMatchObject({ status: 'QUEUED', reused: false });
      expect(retry.jobId).not.toBe(job.jobId);
    } finally {
      provider.behavior = 'ok';
    }
  });

  it('un contenuto rifiutato fallisce subito, senza nuovi tentativi né consumo', async () => {
    const kit = await createKit();
    const { id } = await save(kit, 4);
    provider.behavior = 'reject';
    try {
      await requestBouquetPreview(kit.shop.owner, id);
      expect(await runOnce(kit)).toBe('failed');
      expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(0);
    } finally {
      provider.behavior = 'ok';
    }
  });

  it('una richiesta rifiutata dal provider (chiave, saldo, parametri) non si ritenta', async () => {
    const kit = await createKit();
    const { id } = await save(kit, 5);
    provider.behavior = 'invalid';
    try {
      await requestBouquetPreview(kit.shop.owner, id);
      expect(await runOnce(kit)).toBe('failed');
      const state = await getBouquetPreview(kit.shop.owner, id);
      expect(state.preview).toMatchObject({ status: 'FAILED', errorCode: 'invalid_request' });
      expect(state.quota?.includedUsed).toBe(0);
    } finally {
      provider.behavior = 'ok';
    }
  });

  it('il prompt conta ogni fiore col nome comune della tassonomia', async () => {
    const kit = await createKit();
    const rosa = (await listCanonicalFlowers('es-MX')).find((flower) => flower.slug === 'rosa');
    const linked = await createCatalogItem(
      kit.shop.owner,
      itemInput({ name: 'Rosa roja', canonicalFlowerId: rosa!.id }),
    );
    const design = await save(kit, 3, {
      name: 'Tres rosas',
      lines: [
        { catalogItemId: linked.id, quantity: 3 },
        { catalogItemId: kit.kraft.id, quantity: 1 },
      ],
    });
    await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('succeeded');
    const prompt = provider.prompts.at(-1) ?? '';
    expect(prompt).toContain('exactly 3 flowers in total, one bloom per stem');
    expect(prompt).toContain('exactly 3 red roses ("Rosa roja Freedom")');
    expect(prompt).toContain('No ribbon, no bow, no twine');
    expect(prompt).not.toContain('Para Sofía');
  });

  it('carta e nastro: il prompt usa solo il colore scelto e il colore cambia l’immagine', async () => {
    const kit = await createKit();
    const paper = await createCatalogItem(
      kit.shop.owner,
      itemInput({
        name: 'Papel coreano',
        type: 'PACKAGING',
        saleUnit: 'PIECE',
        variety: null,
        colors: ['pink', 'lilac'],
      }),
    );
    const withPaper = (color: string) =>
      save(kit, 4, {
        lines: [
          { catalogItemId: kit.rose.id, quantity: 4 },
          { catalogItemId: paper.id, quantity: 1, color },
        ],
      });
    const lilac = await withPaper('lilac');
    const lilacJob = await requestBouquetPreview(kit.shop.owner, lilac.id);
    expect(await runOnce(kit)).toBe('succeeded');
    const prompt = provider.prompts.at(-1) ?? '';
    expect(prompt).toContain('Wrapping or vase: "Papel coreano" in lilac.');
    expect(prompt).not.toContain('pink');
    // Stessi fiori con carta rosa: è un altro ramo, nuova anteprima (niente cache sbagliata).
    const pink = await withPaper('pink');
    const pinkJob = await requestBouquetPreview(kit.shop.owner, pink.id);
    expect(pinkJob).toMatchObject({ reused: false });
    expect(pinkJob.jobId).not.toBe(lilacJob.jobId);
  });

  it('stile di "Mis ramos": si descrive una volta, va nel prompt, mai fra fiorerie', async () => {
    const describer = new StubDescriber();
    setStyleDescriber(describer);
    try {
      const kit = await createKit();
      const other = await createKit();
      // Senza foto di stile: sfondo neutro.
      const plain = await save(kit, 5);
      await requestBouquetPreview(kit.shop.owner, plain.id);
      expect(await runOnce(kit)).toBe('succeeded');
      expect(provider.prompts.at(-1)).toContain('simple neutral background');

      await addStyleReference(kit.shop.owner, await referencePhoto(), { consent: 'on' });
      const first = await save(kit, 6);
      const job = await requestBouquetPreview(kit.shop.owner, first.id);
      expect(await runOnce(kit)).toBe('succeeded');
      const prompt = provider.prompts.at(-1) ?? '';
      expect(prompt).toContain(
        'Photo style of this flower shop: Rustic wooden counter, warm window light from the left.',
      );
      expect(prompt).not.toContain('satin ribbon');
      expect(prompt).not.toContain('simple neutral background');
      expect((await getBouquetPreview(kit.shop.owner, first.id)).preview).toMatchObject({
        jobId: job.jobId,
        styled: true,
      });
      expect((await listStyleReferences(kit.shop.staff))[0]?.styleDescriptionEs).toBe(
        'Mostrador de madera rústico, luz cálida de ventana.',
      );

      // Altro ramo: la descrizione salvata si riusa, nessuna nuova chiamata.
      await requestBouquetPreview(kit.shop.owner, (await save(kit, 8)).id);
      expect(await runOnce(kit)).toBe('succeeded');
      expect(describer.calls).toBe(1);

      // L'altra fioreria non ha foto di stile: nessuno stile, anche se A ne ha.
      await requestBouquetPreview(other.shop.owner, (await save(other, 6)).id);
      expect(await runOnce(other)).toBe('succeeded');
      expect(provider.prompts.at(-1)).toContain('simple neutral background');
    } finally {
      setStyleDescriber(null);
    }
  });

  it('si usa la foto con lo stesso stile del disegno, altrimenti la prima caricata', async () => {
    const describer = new StubDescriber();
    setStyleDescriber(describer);
    try {
      const kit = await createKit();
      const garden = await addStyleReference(kit.shop.owner, await referencePhoto(), {
        consent: 'on',
        style: 'GARDEN',
      });
      const romantic = await addStyleReference(kit.shop.owner, await referencePhoto(), {
        consent: 'on',
        style: 'ROMANTIC',
      });
      // `save` usa lo stile ROMANTIC.
      await requestBouquetPreview(kit.shop.owner, (await save(kit, 4)).id);
      expect(await runOnce(kit)).toBe('succeeded');
      const described = new Map(
        (await listStyleReferences(kit.shop.owner)).map((r) => [r.id, r.styleDescriptionEs]),
      );
      expect(described.get(romantic.id)).not.toBeNull();
      expect(described.get(garden.id)).toBeNull();
    } finally {
      setStyleDescriber(null);
    }
  });

  it('se la descrizione dello stile non riesce, l’anteprima arriva comunque senza stile', async () => {
    const describer = new StubDescriber();
    describer.fail = true;
    setStyleDescriber(describer);
    try {
      const kit = await createKit();
      await addStyleReference(kit.shop.owner, await referencePhoto(), { consent: 'on' });
      const design = await save(kit, 3);
      await requestBouquetPreview(kit.shop.owner, design.id);
      expect(await runOnce(kit)).toBe('succeeded');
      expect(provider.prompts.at(-1)).toContain('simple neutral background');
      expect((await getBouquetPreview(kit.shop.owner, design.id)).preview).toMatchObject({
        status: 'SUCCEEDED',
        styled: false,
      });
    } finally {
      setStyleDescriber(null);
    }
  });

  it('il worker in ciclo lavora i job appena accodati', async () => {
    const kit = await createKit();
    const { id } = await save(kit, 6);
    const worker = startAiWorker({ pollIntervalMs: 50, onlyTenantId: kit.shop.tenant.tenantId });
    try {
      await requestBouquetPreview(kit.shop.owner, id);
      let status = '';
      for (let i = 0; i < 40 && status !== 'SUCCEEDED'; i++) {
        await delay(50);
        status = (await getBouquetPreview(kit.shop.owner, id)).preview?.status ?? '';
      }
      expect(status).toBe('SUCCEEDED');
    } finally {
      await worker.stop();
    }
  });
});

describe('job su funzioni (Vercel, ADR-037)', () => {
  it('svuotare la coda lavora tutti i job in attesa e si ferma quando non ce ne sono', async () => {
    const kit = await createKit();
    const first = await save(kit, 4);
    const second = await save(kit, 7);
    await requestBouquetPreview(kit.shop.owner, first.id);
    await requestBouquetPreview(kit.shop.owner, second.id);
    const result = await drainAiQueue({
      budgetMs: 60_000,
      reserveMs: 0,
      onlyTenantId: kit.shop.tenant.tenantId,
    });
    expect(result).toEqual({ processed: 2, stoppedBecause: 'idle' });
    for (const design of [first, second]) {
      expect((await getBouquetPreview(kit.shop.owner, design.id)).preview?.status).toBe(
        'SUCCEEDED',
      );
    }
  });

  it('senza tempo sufficiente non prende nuovi job: restano in coda per la chiamata dopo', async () => {
    const kit = await createKit();
    const design = await save(kit, 5);
    await requestBouquetPreview(kit.shop.owner, design.id);
    const result = await drainAiQueue({
      budgetMs: 290_000,
      reserveMs: 290_000,
      onlyTenantId: kit.shop.tenant.tenantId,
    });
    expect(result).toEqual({ processed: 0, stoppedBecause: 'deadline' });
    expect((await getBouquetPreview(kit.shop.owner, design.id)).preview?.status).toBe('QUEUED');
  });

  it('con il limite di job in corso raggiunto non se ne prende un altro', async () => {
    const kit = await createKit();
    const busy = await save(kit, 3);
    const waiting = await save(kit, 9);
    await requestBouquetPreview(kit.shop.owner, busy.id);
    // Un'altra funzione ha appena preso il primo job (lease valido).
    const claimed = await db.$queryRaw<{ job_id: string }[]>`
      SELECT * FROM app_claim_ai_job(300, ${kit.shop.tenant.tenantId}::uuid, NULL)`;
    expect(claimed).toHaveLength(1);
    await requestBouquetPreview(kit.shop.owner, waiting.id);

    expect(await processNextAiJob({ onlyTenantId: kit.shop.tenant.tenantId, maxRunning: 1 })).toBe(
      'idle',
    );
    expect((await getBouquetPreview(kit.shop.owner, waiting.id)).preview?.status).toBe('QUEUED');

    // Con il limite predefinito (8) il job in attesa parte.
    expect(await processNextAiJob({ onlyTenantId: kit.shop.tenant.tenantId })).toBe('succeeded');
  });
});

describe('quota, pacchetti e tetto di spesa', () => {
  it('a quota esaurita servono anteprime extra sbloccate dalla piattaforma', async () => {
    const kit = await createKit();
    await withSystemContext(db, { reason: 'test: consuma la quota del mese' }, (tx) =>
      tx.aiJob.createMany({
        data: Array.from({ length: 25 }, (_, index) => ({
          tenantId: kit.shop.tenant.tenantId,
          feature: 'BOUQUET_PREVIEW' as const,
          status: 'SUCCEEDED' as const,
          requestedById: kit.shop.tenant.owner.id,
          inputHash: `consumed-${index}`,
          input: {},
          quotaSource: 'INCLUDED' as const,
          usageUnits: 1,
        })),
      }),
    );
    const first = await save(kit, 3);
    await expect(requestBouquetPreview(kit.shop.owner, first.id)).rejects.toMatchObject({
      reason: 'ai_quota_exhausted',
    });

    await expect(
      grantAiCredits({
        operatorEmail: kit.shop.tenant.owner.email,
        tenantSlug: kit.shop.tenant.slug,
        units: 50,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      grantAiCredits({ operatorEmail, tenantSlug: kit.shop.tenant.slug, units: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const grant = await grantAiCredits({
      operatorEmail,
      tenantSlug: kit.shop.tenant.slug,
      units: 2,
      note: 'Paquete de prueba',
    });
    expect(grant).toMatchObject({ units: 2, totalGranted: 2 });
    const audit = await withTenantContext(db, kit.shop.owner, (tx) =>
      tx.auditLog.findFirst({
        where: { tenantId: kit.shop.tenant.tenantId, action: 'ai_credits.granted' },
      }),
    );
    expect(audit?.metadata).toMatchObject({ units: 2, via: 'platform-cli' });

    const extra = await requestBouquetPreview(kit.shop.owner, first.id);
    expect(extra.status).toBe('QUEUED');
    expect(await getAiQuota(kit.shop.owner)).toMatchObject({
      includedRemaining: 0,
      extraGranted: 2,
      extraRemaining: 1,
      nextSource: 'EXTRA',
    });

    // Un solo credito rimasto e due richieste simultanee: ne passa una sola.
    const [a, b] = await Promise.all([save(kit, 10), save(kit, 11)]);
    const results = await Promise.allSettled([
      requestBouquetPreview(kit.shop.owner, a.id),
      requestBouquetPreview(kit.shop.manager, b.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictError);
    expect((await getAiQuota(kit.shop.owner)).remaining).toBe(0);
  });

  it('il tetto di spesa mensile della piattaforma blocca nuove generazioni', async () => {
    const kit = await createKit();
    const { id } = await save(kit, 8);
    setAiProvider(new StubProvider(10 ** 12));
    try {
      await expect(requestBouquetPreview(kit.shop.owner, id)).rejects.toMatchObject({
        reason: 'ai_budget_reached',
      });
      expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(0);
    } finally {
      setAiProvider(provider);
    }
  });
});

describe('isolamento A ↔ B', () => {
  it('nessuna cache, immagine o richiesta fra fiorerie diverse', async () => {
    const kitA = await createKit('Florería A anteprime');
    const kitB = await createKit('Florería B anteprime');
    const designA = await save(kitA, 12);
    const designB = await save(kitB, 12);
    const jobA = await requestBouquetPreview(kitA.shop.owner, designA.id);
    await runOnce(kitA);

    // Stessa composizione con prodotti omonimi: B genera la SUA immagine.
    const jobB = await requestBouquetPreview(kitB.shop.owner, designB.id);
    expect(jobB).toMatchObject({ reused: false, status: 'QUEUED' });
    expect(jobB.jobId).not.toBe(jobA.jobId);

    await expect(getAiPreviewImage(kitB.shop.owner, jobA.jobId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(requestBouquetPreview(kitB.shop.owner, designA.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      requestBouquetPreview(kitB.shop.owner, designA.id, new Date(), { anotherVersion: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getBouquetPreview(kitB.shop.owner, designA.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getAiQuota(kitA.shop.owner)).includedUsed).toBe(1);
    expect((await getAiQuota(kitB.shop.owner)).includedUsed).toBe(1);
  });
});
