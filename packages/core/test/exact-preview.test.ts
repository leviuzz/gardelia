import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import type { BouquetPreviewSpec, CountCheckResult, CountTarget } from '@floral/domain';
import {
  AiProviderError,
  ChromaKeyBackgroundRemover,
  MemoryStorage,
  NotFoundError,
  PlanRequiredError,
  addCatalogItemPhoto,
  archiveCatalogItemPhoto,
  createCatalogItem,
  createCustomer,
  createQuoteFromConfiguration,
  getAiPreviewImage,
  getAiQuota,
  getBouquetPreview,
  getBouquetSketch,
  getBouquetSketchPlan,
  getQuote,
  getQuoteLineImage,
  requestBouquetPreview,
  saveBouquetConfiguration,
  setAiProvider,
  setBackgroundRemover,
  setFlowerCounter,
  setObjectStorage,
  type AiImageProvider,
  type CatalogItemDto,
  type FlowerCounter,
  type GeneratedImage,
} from '../src/index';
import { processNextAiJob } from '../src/ai/worker';
import { assignTenantPlan } from '../src/platform';
import { createTestShop, itemInput, type TestShop } from '../src/testing';

const db = getDb();
const storage = new MemoryStorage();
const remover = new ChromaKeyBackgroundRemover();

/** Provider che sa partire da immagini: registra cosa riceve e restituisce un JPEG. */
class SketchProvider implements AiImageProvider {
  readonly id = 'stub';
  readonly model = 'stub-edit-v1';
  readonly simulated = false;
  readonly acceptsImages = true;
  readonly estimatedCostMicros = 80_000;
  requests: {
    prompt: string;
    images: readonly { readonly bytes: Uint8Array; readonly contentType: string }[];
    spec: BouquetPreviewSpec;
  }[] = [];

  async generate(request: {
    readonly prompt: string;
    readonly spec: BouquetPreviewSpec;
    readonly images?: readonly { readonly bytes: Uint8Array; readonly contentType: string }[];
  }): Promise<GeneratedImage> {
    this.requests.push({
      prompt: request.prompt,
      images: request.images ?? [],
      spec: request.spec,
    });
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#aa3344' },
    })
      .jpeg()
      .toBuffer();
    return { bytes: new Uint8Array(bytes), contentType: 'image/jpeg', costMicros: 80_000 };
  }
}

/** Contatore programmabile: risposte in coda (numeri giusti, sbagliati o errore). */
class StubCounter implements FlowerCounter {
  readonly id = 'stub';
  readonly model = 'stub-count';
  readonly simulated = false;
  readonly estimatedCostMicros = 12_000;
  script: ('exact' | 'wrong' | 'error')[] = [];
  calls = 0;
  seenTargets: CountTarget[][] = [];

  async count(_image: unknown, targets: readonly CountTarget[]): Promise<CountCheckResult> {
    this.calls += 1;
    this.seenTargets.push([...targets]);
    const step = this.script.shift() ?? 'exact';
    if (step === 'error') throw new AiProviderError('provider_error', 'vision down');
    const counts: Record<number, number> = {};
    for (const target of targets) {
      counts[target.index] = (target.expected ?? 0) + (step === 'wrong' ? 1 : 0);
    }
    return { counts, other: 0 };
  }
}

const provider = new SketchProvider();
const counter = new StubCounter();
let operatorEmail: string;

/** Fiore su fondo grigio liso (il caso che chiediamo al fiorista): lo scontorno locale funziona. */
async function flowerPhoto(color: string): Promise<Uint8Array> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700"><rect width="900" height="700" fill="#d9d9d9"/><circle cx="450" cy="330" r="150" fill="${color}"/><rect x="440" y="470" width="20" height="200" fill="#3d7a3a"/></svg>`,
  );
  return new Uint8Array(await sharp(svg).jpeg({ quality: 90 }).toBuffer());
}

interface Kit {
  readonly shop: TestShop;
  readonly rose: CatalogItemDto;
  readonly tulip: CatalogItemDto;
  readonly paper: CatalogItemDto;
  readonly ribbon: CatalogItemDto;
  readonly rosePhotoId: string;
}

/** Fioreria Plus con rosa fotografata (ritaglio pronto), tulipano senza foto, carta e nastro. */
async function createKit(name: string): Promise<Kit> {
  const shop = await createTestShop(name);
  await assignTenantPlan({
    operatorEmail,
    tenantSlug: shop.tenant.slug,
    planCode: 'PLUS',
    status: 'PILOT',
  });
  const rose = await createCatalogItem(shop.owner, itemInput({ name: 'Rosa roja' }));
  const tulip = await createCatalogItem(
    shop.owner,
    itemInput({ name: 'Tulipán', variety: null, colors: ['pink'] }),
  );
  const paper = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Papel coreano',
      type: 'PACKAGING',
      saleUnit: 'PIECE',
      variety: null,
      colors: ['pink'],
    }),
  );
  const ribbon = await createCatalogItem(
    shop.owner,
    itemInput({
      name: 'Listón de satín',
      type: 'ACCESSORY',
      saleUnit: 'PIECE',
      variety: null,
      colors: ['white'],
    }),
  );
  setBackgroundRemover(remover);
  const photo = await addCatalogItemPhoto(shop.owner, rose.id, await flowerPhoto('#c0392b'), {});
  expect(await processNextAiJob({ onlyTenantId: shop.tenant.tenantId, remover, provider })).toBe(
    'succeeded',
  );
  setBackgroundRemover(null);
  return { shop, rose, tulip, paper, ribbon, rosePhotoId: photo.id };
}

function saveDesign(kit: Kit, lines: { catalogItemId: string; quantity: number }[]) {
  return saveBouquetConfiguration(kit.shop.owner, {
    name: 'Ramo exacto',
    style: 'GARDEN',
    size: 'MEDIUM',
    budget: '',
    notes: 'Para Sofía',
    lines: lines.map((line) => ({ ...line, color: null })),
  });
}

function rosesWithWrap(kit: Kit, roses = 3) {
  return saveDesign(kit, [
    { catalogItemId: kit.rose.id, quantity: roses },
    { catalogItemId: kit.paper.id, quantity: 1 },
    { catalogItemId: kit.ribbon.id, quantity: 1 },
  ]);
}

async function runOnce(kit: Kit) {
  return processNextAiJob({ onlyTenantId: kit.shop.tenant.tenantId, provider, remover: null });
}

async function jobOf(jobId: string) {
  return withSystemContext(db, { reason: 'test: job di anteprima' }, (tx) =>
    tx.aiJob.findUniqueOrThrow({ where: { id: jobId } }),
  );
}

beforeAll(async () => {
  const operator = await createTestUser(db, { name: 'Operador Boceto' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
  setObjectStorage(storage);
  setAiProvider(provider);
  setFlowerCounter(counter);
  setBackgroundRemover(null);
});

afterAll(async () => {
  setAiProvider(undefined);
  setFlowerCounter(undefined);
  setBackgroundRemover(undefined);
  setObjectStorage(null);
  await disconnectDb();
});

describe('boceto esatto', () => {
  it('con la foto senza fondo di ogni fiore si disegna, gratis e per tutto il team', async () => {
    const kit = await createKit('Florería Boceto');
    const design = await rosesWithWrap(kit);
    const plan = await getBouquetSketchPlan(kit.shop.staff, design.id);
    expect(plan).toMatchObject({
      eligible: true,
      reason: null,
      stems: 3,
      missing: [],
      withoutSpecies: [],
    });
    expect(plan.version).toMatch(/^[0-9a-f]{16}$/);

    const sketch = await getBouquetSketch(kit.shop.staff, design.id);
    expect(sketch.contentType).toBe('image/png');
    expect(await sharp(sketch.bytes).metadata()).toMatchObject({ width: 1024, height: 1024 });

    // Cambia la composizione → cambia la versione (URL dell'immagine).
    const bigger = await rosesWithWrap(kit, 5);
    expect((await getBouquetSketchPlan(kit.shop.owner, bigger.id)).version).not.toBe(plan.version);
  });

  it('avvisa dei fiori di cui la foto realistica non saprebbe la specie', async () => {
    const kit = await createKit('Florería Sin especie');
    const generic = await createCatalogItem(
      kit.shop.owner,
      itemInput({ name: 'Fiore 1', variety: null }),
    );
    const design = await saveDesign(kit, [
      { catalogItemId: kit.rose.id, quantity: 2 },
      { catalogItemId: generic.id, quantity: 3 },
    ]);
    const plan = await getBouquetSketchPlan(kit.shop.owner, design.id);
    // "Rosa roja" si riconosce dal nome; "Fiore 1" (senza varietà) no, e non ha una specie.
    expect(plan.withoutSpecies).toEqual([{ id: generic.id, name: 'Fiore 1' }]);
  });

  it('dice quali fiori non hanno ancora la foto; oltre il limite resta a parole', async () => {
    const kit = await createKit('Florería Boceto incompleto');
    const design = await saveDesign(kit, [
      { catalogItemId: kit.rose.id, quantity: 3 },
      { catalogItemId: kit.tulip.id, quantity: 2 },
    ]);
    expect(await getBouquetSketchPlan(kit.shop.owner, design.id)).toMatchObject({
      eligible: false,
      reason: 'missing_cutouts',
      missing: [{ id: kit.tulip.id, name: 'Tulipán' }],
      version: null,
    });
    await expect(getBouquetSketch(kit.shop.owner, design.id)).rejects.toBeInstanceOf(NotFoundError);

    const huge = await rosesWithWrap(kit, 30);
    expect(await getBouquetSketchPlan(kit.shop.owner, huge.id)).toMatchObject({
      eligible: false,
      reason: 'too_many_stems',
      stems: 30,
    });
    // Senza boceto l'anteprima resta descritta a parole.
    expect((await getBouquetPreview(kit.shop.owner, huge.id)).mode).toBe('PROMPT');
  });

  it('BILL-01 e isolamento A ↔ B: niente boceto senza Plus né fra fiorerie', async () => {
    const kit = await createKit('Florería Boceto A');
    const design = await rosesWithWrap(kit);
    const other = await createKit('Florería Boceto B');
    await expect(getBouquetSketchPlan(other.shop.owner, design.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getBouquetSketch(other.shop.owner, design.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const basic = await createTestShop('Florería Boceto Basic');
    await expect(getBouquetSketchPlan(basic.owner, design.id)).rejects.toBeInstanceOf(
      PlanRequiredError,
    );
  });
});

describe('anteprima esatta', () => {
  it('parte dalle foto dei fiori, ricontrolla i numeri e consuma il credito solo a successo', async () => {
    const kit = await createKit('Florería Exacta');
    const design = await rosesWithWrap(kit);
    expect((await getBouquetPreview(kit.shop.owner, design.id)).mode).toBe('EXACT');
    provider.requests = [];
    counter.script = ['exact'];
    counter.calls = 0;

    const requested = await requestBouquetPreview(kit.shop.owner, design.id);
    expect(requested).toMatchObject({ status: 'QUEUED', mode: 'EXACT', verified: null });
    expect(await runOnce(kit)).toBe('succeeded');

    expect(provider.requests).toHaveLength(1);
    // v9: il modello riceve la foto della rosa (scontornata, su fondo bianco), non il boceto.
    const [reference] = provider.requests[0]?.images ?? [];
    expect(provider.requests[0]?.images).toHaveLength(1);
    expect(reference?.contentType).toBe('image/jpeg');
    expect((await sharp(reference!.bytes).metadata()).hasAlpha).toBe(false);
    expect(provider.requests[0]?.prompt).toContain('Create a realistic photograph');
    expect(provider.requests[0]?.prompt).toContain(
      'The reference images show the flowers to use, one image per kind: image 1 is "Rosa roja',
    );
    expect(provider.requests[0]?.prompt).not.toContain('collage');
    expect(provider.requests[0]?.prompt).toContain('exactly 3');
    // Il contatore riceve i tipi; le quantità attese restano nel server.
    expect(counter.seenTargets[0]?.map((target) => target.expected)).toEqual([3]);

    const state = await getBouquetPreview(kit.shop.owner, design.id);
    expect(state.preview).toMatchObject({ status: 'SUCCEEDED', mode: 'EXACT', verified: true });
    expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(1);
    const image = await getAiPreviewImage(kit.shop.owner, requested.jobId);
    expect(image.contentType).toBe('image/jpeg');
    expect(await jobOf(requested.jobId)).toMatchObject({
      estimatedCostMicros: 92_000,
      providerCostMicros: 92_000,
      usageUnits: 1,
    });
  });

  it('un fiore senza colore in catalogo arriva al controllo con il colore della sua foto', async () => {
    const kit = await createKit('Florería Exacta sin color');
    const plain = await createCatalogItem(
      kit.shop.owner,
      itemInput({ name: 'Fiore 1', variety: null, colors: [] }),
    );
    setBackgroundRemover(remover);
    await addCatalogItemPhoto(kit.shop.owner, plain.id, await flowerPhoto('#c0392b'), {});
    expect(
      await processNextAiJob({ onlyTenantId: kit.shop.tenant.tenantId, remover, provider }),
    ).toBe('succeeded');
    setBackgroundRemover(null);
    const design = await saveDesign(kit, [{ catalogItemId: plain.id, quantity: 3 }]);
    counter.script = ['exact'];
    counter.seenTargets = [];
    await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('succeeded');
    expect(counter.seenTargets[0]?.map((target) => target.description)).toEqual([
      '"Fiore 1" (red)',
    ]);
  });

  it('se la foto ha fiori in più li toglie sulla stessa foto e ricontrolla', async () => {
    const kit = await createKit('Florería Exacta retry');
    const design = await rosesWithWrap(kit);
    provider.requests = [];
    counter.script = ['wrong', 'exact'];
    const requested = await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('succeeded');
    expect(provider.requests).toHaveLength(2);
    // La seconda immagine è la correzione della prima (una rosa in più da togliere).
    expect(provider.requests[1]?.images).toHaveLength(1);
    expect(provider.requests[1]?.prompt).toContain('This photo of a bouquet shows 4 stems');
    expect(provider.requests[1]?.prompt).toContain('Remove 1 stem of "Rosa roja Freedom" (red)');
    expect((await getBouquetPreview(kit.shop.owner, design.id)).preview).toMatchObject({
      status: 'SUCCEEDED',
      verified: true,
    });
    // Due foto e due controlli: tutto nel tetto di spesa.
    expect((await jobOf(requested.jobId)).providerCostMicros).toBe(184_000);
  });

  it('numeri sbagliati anche dopo la correzione: niente immagine, niente credito, poi stop', async () => {
    const kit = await createKit('Florería Exacta mismatch');
    const design = await rosesWithWrap(kit);
    // Foto, correzione e nuova foto: tutte e tre sbagliate.
    counter.script = ['wrong', 'wrong', 'wrong'];
    const first = await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('failed');
    expect(await jobOf(first.jobId)).toMatchObject({
      status: 'FAILED',
      errorCode: 'count_mismatch',
      usageUnits: 0,
      outputKey: null,
    });
    const state = await getBouquetPreview(kit.shop.owner, design.id);
    expect(state.preview).toMatchObject({ status: 'FAILED', errorCode: 'count_mismatch' });
    // Il fiorista vede cosa ha contato il controllo nell'ultima foto (una rosa in più).
    expect(state.preview?.countCheck).toEqual({
      lines: [
        {
          name: kit.rose.variety ? `${kit.rose.name} ${kit.rose.variety}` : kit.rose.name,
          expected: 3,
          found: 4,
        },
      ],
      other: 0,
      photos: 3,
    });
    expect(state.retryLimitReached).toBe(false);
    expect((await getAiQuota(kit.shop.owner)).includedUsed).toBe(0);
    await expect(getAiPreviewImage(kit.shop.owner, first.jobId)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // Si può riprovare, ma non all'infinito (ogni tentativo costa alla piattaforma).
    counter.script = ['wrong', 'wrong', 'wrong'];
    await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('failed');
    expect((await getBouquetPreview(kit.shop.owner, design.id)).retryLimitReached).toBe(true);
    await expect(requestBouquetPreview(kit.shop.owner, design.id)).rejects.toMatchObject({
      reason: 'preview_retry_limit',
    });
  });

  it('se il controllo non risponde la foto si mostra, non verificata', async () => {
    const kit = await createKit('Florería Exacta sin control');
    const design = await rosesWithWrap(kit);
    counter.script = ['error'];
    await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('succeeded');
    expect((await getBouquetPreview(kit.shop.owner, design.id)).preview).toMatchObject({
      status: 'SUCCEEDED',
      mode: 'EXACT',
      verified: null,
    });
  });

  it('foto del fiore tolta dopo la richiesta: il job fallisce senza credito', async () => {
    const kit = await createKit('Florería Exacta foto tolta');
    const design = await rosesWithWrap(kit);
    const requested = await requestBouquetPreview(kit.shop.owner, design.id);
    await archiveCatalogItemPhoto(kit.shop.owner, kit.rosePhotoId);
    expect(await runOnce(kit)).toBe('failed');
    expect(await jobOf(requested.jobId)).toMatchObject({
      status: 'FAILED',
      errorCode: 'invalid_request',
      usageUnits: 0,
    });
    // Ora la rosa non ha più foto: si torna all'anteprima a parole.
    expect((await getBouquetPreview(kit.shop.owner, design.id)).mode).toBe('PROMPT');
  });

  it('senza foto di un fiore l’anteprima resta a parole e i ritagli non entrano nella chiave', async () => {
    const kit = await createKit('Florería Exacta parcial');
    const design = await saveDesign(kit, [
      { catalogItemId: kit.rose.id, quantity: 2 },
      { catalogItemId: kit.tulip.id, quantity: 2 },
    ]);
    provider.requests = [];
    await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('succeeded');
    expect(provider.requests[0]?.images).toEqual([]);
    expect(provider.requests[0]?.spec.mode).toBe('PROMPT');
    expect(provider.requests[0]?.spec.components.every((c) => c.cutoutPhotoId === null)).toBe(true);
    expect((await getBouquetPreview(kit.shop.owner, design.id)).preview).toMatchObject({
      mode: 'PROMPT',
      verified: null,
    });
  });
});

describe('immagine del ramo nel preventivo (ADR-035)', () => {
  const customer = (name: string) => ({
    type: 'PERSON',
    displayName: name,
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550199',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });

  it('si aggancia alla riga, resta se il disegno cambia e la vede solo la fioreria', async () => {
    const kit = await createKit('Florería Cotización con foto');
    const design = await rosesWithWrap(kit);
    counter.script = ['exact'];
    await requestBouquetPreview(kit.shop.owner, design.id);
    expect(await runOnce(kit)).toBe('succeeded');
    const { id: customerId } = await createCustomer(kit.shop.owner, customer('Ana con foto'));

    const { id: quoteId } = await createQuoteFromConfiguration(kit.shop.owner, {
      configurationId: design.id,
      customerId,
    });
    const quote = await getQuote(kit.shop.staff, quoteId);
    const line = quote.lines[0]!;
    expect(line).toMatchObject({
      kind: 'BUILDER',
      image: { verified: true, simulated: false },
    });
    const image = await getQuoteLineImage(kit.shop.staff, quoteId, line.id);
    expect(image.contentType).toBe('image/jpeg');
    expect(image.bytes.length).toBeGreaterThan(0);

    // Il disegno cambia (4 rose): il preventivo già fatto tiene la sua immagine, uno nuovo no
    // finché non si genera l'anteprima della nuova composizione.
    await saveBouquetConfiguration(
      kit.shop.owner,
      {
        name: 'Ramo exacto',
        style: 'GARDEN',
        size: 'MEDIUM',
        budget: '',
        notes: '',
        lines: [
          { catalogItemId: kit.rose.id, quantity: 4, color: null },
          { catalogItemId: kit.paper.id, quantity: 1, color: null },
          { catalogItemId: kit.ribbon.id, quantity: 1, color: null },
        ],
      },
      design.id,
    );
    expect((await getQuote(kit.shop.owner, quoteId)).lines[0]?.image).not.toBeNull();
    const { id: newer } = await createQuoteFromConfiguration(kit.shop.owner, {
      configurationId: design.id,
      customerId,
    });
    expect((await getQuote(kit.shop.owner, newer)).lines[0]?.image).toBeNull();

    // Isolamento A ↔ B: un'altra fioreria riceve 404 anche conoscendo gli ID.
    const other = await createKit('Florería Cotización B');
    await expect(getQuoteLineImage(other.shop.owner, quoteId, line.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('senza anteprima la riga non ha immagine; le righe a catalogo nemmeno', async () => {
    const kit = await createKit('Florería Cotización sin foto');
    const design = await rosesWithWrap(kit, 2);
    const { id: customerId } = await createCustomer(kit.shop.owner, customer('Luis sin foto'));
    const { id: quoteId } = await createQuoteFromConfiguration(kit.shop.owner, {
      configurationId: design.id,
      customerId,
    });
    const quote = await getQuote(kit.shop.owner, quoteId);
    expect(quote.lines[0]?.image).toBeNull();
    await expect(
      getQuoteLineImage(kit.shop.owner, quoteId, quote.lines[0]!.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
