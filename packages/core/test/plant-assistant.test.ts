import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext } from '@floral/db';
import {
  addDays,
  dayOfWeek,
  todayInTimeZone,
  toIsoDate,
  type AssistantAnswerOutput,
  type AssistantAnswerPromptInput,
  type AssistantRecognitionOutput,
  type CalendarDate,
} from '@floral/domain';
import {
  ConflictError,
  MemoryStorage,
  NotFoundError,
  ValidationError,
  addCarePlant,
  addCustomerAddress,
  answerAssistantCase,
  confirmCareContract,
  createCareContract,
  createCareSlot,
  createCustomer,
  getAssistantCase,
  getAssistantPanel,
  getAssistantPhotoImage,
  getCareContract,
  getCareSettings,
  listAssistantCases,
  setObjectStorage,
  setPlantAssistant,
  startAssistantCase,
  updateCareSettings,
  updatePrimaryLocation,
  type AssistantCallResult,
  type PlantAssistant,
  type TenantContext,
} from '../src/index';
import { purgeCarePhotos } from '../src/jobs/care';
import { contextFor, createTestShop, type TestShop } from '../src/testing';
import type { RecognitionRequest } from '../src/ai/plant-assistant/types';

/**
 * Floral Care, blocco 6a (ADR-085): l'Asistente de plantas della fioreria, con un assistente finto.
 * Riconoscimento (solo specie della lista), risposta con la specie confermata e i nostri dati di
 * cura, tetto al giorno e budget, errori che non contano, isolamento fra fiorerie, foto cancellate
 * con quelle delle visite.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const STAMP = Date.now().toString(36);
const today = (): CalendarDate => todayInTimeZone(TZ);
const storage = new MemoryStorage();

const USAGE = { inputTokens: 1_000, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 };

class FakeAssistant implements PlantAssistant {
  readonly id = 'anthropic' as const;
  readonly simulated = false;
  readonly model = 'claude-haiku-5-5' as const;
  next: 'ok' | 'refused' | 'error' = 'ok';
  recognition: AssistantRecognitionOutput = {
    photoUsable: true,
    candidates: [
      { slug: 'telefono', likelihood: 'high' },
      { slug: 'rosa', likelihood: 'medium' },
      { slug: 'inventada', likelihood: 'low' },
      { slug: 'filodendro', likelihood: 'low' },
    ],
    notInList: false,
    condition: 'Hojas amarillas en la base.',
  };
  lastRecognition: RecognitionRequest | null = null;
  lastAnswer: AssistantAnswerPromptInput | null = null;

  #result<T>(value: T): AssistantCallResult<T> {
    const ok = this.next === 'ok';
    return {
      outcome: this.next,
      value: ok ? value : null,
      usage: USAGE,
      costMicros: 150,
      servedModel: this.model,
      stopReason: this.next === 'refused' ? 'refusal' : 'end_turn',
      errorCode: ok ? null : this.next === 'refused' ? 'refusal' : 'provider_error',
      durationMs: 5,
    };
  }

  async recognize(request: RecognitionRequest) {
    this.lastRecognition = request;
    return this.#result(this.recognition);
  }

  async answer(request: AssistantAnswerPromptInput) {
    this.lastAnswer = request;
    const value: AssistantAnswerOutput = {
      answer: 'Riega menos y aleja la maceta de la ventana.',
      steps: ['Toca la tierra antes de regar.', '', 'Quita las hojas secas.'],
      unsure: false,
      askFlorist: false,
    };
    return this.#result(value);
  }
}

const fake = new FakeAssistant();
let shop: TestShop;
let owner: TenantContext;
let staff: TenantContext;
let other: TestShop;
let slots = 0;

async function setUpOffer(ctx: TenantContext): Promise<void> {
  await updatePrimaryLocation(ctx, {
    addressLine1: 'Av. Madero 1',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryRadiusKm: '15',
    placeId: `ChIJ_assistant_${ctx.tenantSlug}`,
    latitude: '21.8818',
    longitude: '-102.2916',
  });
  await updateCareSettings(ctx, {
    visitFee: '450',
    careFeeSmall: '10',
    careFeeMedium: '20',
    careFeeLarge: '40',
    frequencies: ['MONTHLY_1', 'MONTHLY_2', 'WEEKLY'],
    maxDistanceKm: '',
    minNoticeHours: '24',
    missedVisitPolicy: 'COUNTS',
    deadPlantPolicy: 'QUOTE',
    paymentDueDays: '10',
    termsText: '',
  });
}

async function newContract(
  ctx: TenantContext,
  name: string,
): Promise<{ subscriptionId: string; plantId: string }> {
  const start = addDays(today(), 2);
  slots += 1;
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const slot = await createCareSlot(ctx, {
    weekday: String(dayOfWeek(start)),
    start: time(300 + slots * 20),
    end: time(320 + slots * 20),
    capacity: '3',
  });
  const customer = await createCustomer(ctx, {
    type: 'COMPANY',
    displayName: name,
    legalName: null,
    taxId: null,
    email: null,
    phone: '+524495550188',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });
  const place = await addCustomerAddress(ctx, customer.id, {
    label: name,
    recipientName: '',
    recipientPhone: '',
    addressLine1: 'Av. Universidad 300',
    addressLine2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryNotes: '',
    placeId: `ChIJ_${name.replace(/\W/g, '')}_${STAMP}`,
    latitude: '21.9',
    longitude: '-102.2916',
  });
  const settings = await getCareSettings(ctx);
  const contract = await createCareContract(ctx, customer.id, {
    customerAddressId: place.id,
    frequency: 'WEEKLY',
    slotIds: [slot.id],
    startDate: toIsoDate(start),
    seats: '',
    serviceIds: settings.services
      .filter((service) => service.presetKey === 'watering')
      .map((service) => service.id),
    contactName: 'Recepción',
    contactPhone: '',
    accessNotes: '',
    notes: '',
    outOfRangeConfirmed: '',
  });
  await addCarePlant(ctx, contract.id, {
    name: 'Potos de recepción',
    quantity: '2',
    size: 'MEDIUM',
    location: 'Junto a la ventana',
  });
  await confirmCareContract(ctx, contract.id);
  const detail = await getCareContract(ctx, contract.id);
  return { subscriptionId: contract.id, plantId: detail.plants[0]!.id };
}

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 900, height: 700, channels: 3, background: '#3f6b4f' } })
      .jpeg()
      .toBuffer(),
  );
}

async function callsOf(tenantId: string) {
  return withSystemContext(db, { reason: 'test: chiamate' }, (tx) =>
    tx.assistantCall.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
  );
}

beforeAll(async () => {
  setObjectStorage(storage);
  setPlantAssistant(fake);
  shop = await createTestShop('Florería Asistente');
  owner = await contextFor(shop.tenant.owner.id, shop.tenant.slug);
  staff = await contextFor(shop.staffUser.id, shop.tenant.slug);
  await setUpOffer(owner);
  other = await createTestShop('Florería Ajena Asistente');
  await setUpOffer(other.owner);
});

afterAll(async () => {
  setObjectStorage(null);
  setPlantAssistant(undefined);
  await disconnectDb();
});

describe('Asistente de plantas: caso e risposte', () => {
  it('lo staff riconosce una foto: solo specie della lista, foto salvata, lista in es-MX', async () => {
    fake.next = 'ok';
    const kit = await newContract(owner, `Hotel Asistente ${STAMP}`);
    const found = await startAssistantCase(
      staff,
      { subscriptionId: kit.subscriptionId, plantId: kit.plantId },
      await jpeg(),
    );
    // «rosa» è un fiore reciso e «inventada» non esiste: restano solo piante della lista.
    expect(found.candidates.map((candidate) => candidate.slug)).toEqual(['telefono', 'filodendro']);
    expect(found.candidates[0]?.care?.petToxicity).toBe('TOXIC');
    expect(found.plantName).toBe('Potos de recepción');
    expect(found.photoAvailable).toBe(true);
    expect(found.canAsk).toBe(true);
    expect(found.condition).toBe('Hojas amarillas en la base.');
    // Il modello riceve tutte le piante, con il nome in es-MX, e una foto ridotta.
    const sent = fake.lastRecognition!;
    expect(sent.species.map((item) => item.slug)).toContain('calathea');
    expect(sent.species.find((item) => item.slug === 'telefono')?.name).toBe('Teléfono');
    const size = await sharp(Buffer.from(sent.image.bytes)).metadata();
    expect(Math.max(size.width ?? 0, size.height ?? 0)).toBeLessThanOrEqual(1092);
    const thumb = await getAssistantPhotoImage(owner, found.id, 'thumb');
    expect(thumb.contentType).toBe('image/jpeg');
    const calls = await callsOf(shop.tenant.tenantId);
    expect(calls.at(-1)).toMatchObject({
      caseId: found.id,
      kind: 'RECOGNIZE',
      status: 'SUCCEEDED',
      costMicros: 150,
      inputTokens: 1_000,
    });

    // La risposta: specie corretta fuori dai candidati, dati di cura nostri, scheda della pianta.
    const answered = await answerAssistantCase(staff, found.id, {
      question: '  ¿Por qué se ponen amarillas las hojas?  ',
      speciesSlug: 'calathea',
    });
    const answer = answered.answers[0]!;
    expect(answer.question).toBe('¿Por qué se ponen amarillas las hojas?');
    expect(answer.steps).toEqual(['Toca la tierra antes de regar.', 'Quita las hojas secas.']);
    expect(answer.species?.slug).toBe('calathea');
    expect(answer.species?.care).toMatchObject({ petToxicity: 'NON_TOXIC', reviewed: false });
    expect(fake.lastAnswer?.species?.care?.watering).toBe('SLIGHTLY_MOIST');
    expect(fake.lastAnswer?.plant).toMatchObject({
      size: 'MEDIUM',
      location: 'Junto a la ventana',
    });
    expect(fake.lastAnswer?.condition).toBe('Hojas amarillas en la base.');

    // «No sé» e «Otra pregunta» con il riassunto delle precedenti; poi il caso è pieno.
    await answerAssistantCase(owner, found.id, {
      question: '¿Y si la cambio de lugar?',
      speciesSlug: '',
    });
    expect(fake.lastAnswer?.species).toBeNull();
    expect(fake.lastAnswer?.previous).toHaveLength(1);
    const full = await answerAssistantCase(owner, found.id, {
      question: '¿Y el abono?',
      speciesSlug: 'telefono',
    });
    expect(full.answers).toHaveLength(3);
    expect(full.canAsk).toBe(false);
    await expect(
      answerAssistantCase(owner, found.id, { question: '¿Algo más?', speciesSlug: '' }),
    ).rejects.toMatchObject({ reason: 'assistant_case_full' });

    // Registro senza testi; elenco del contratto e pannello.
    const audit = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: shop.tenant.tenantId, action: 'care.assistant_answered' },
      }),
    );
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit.map((row) => row.metadata))).not.toContain('amarillas');
    const list = await listAssistantCases(owner, kit.subscriptionId);
    expect(list[0]).toMatchObject({
      id: found.id,
      answers: 3,
      speciesName: 'Calathea',
      firstQuestion: '¿Por qué se ponen amarillas las hojas?',
    });
    const panel = await getAssistantPanel(staff);
    expect(panel).toMatchObject({
      available: true,
      simulated: false,
      usedToday: 3,
      dailyLimit: 20,
    });
    expect(panel.species.find((item) => item.slug === 'aglaonema')?.care?.light).toBe('LOW');
  });

  it('domanda vuota o specie che non è una pianta: errori del modulo', async () => {
    fake.next = 'ok';
    const kit = await newContract(owner, `Oficina Validación ${STAMP}`);
    const found = await startAssistantCase(
      owner,
      { subscriptionId: kit.subscriptionId },
      await jpeg(),
    );
    await expect(
      answerAssistantCase(owner, found.id, { question: '   ', speciesSlug: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      answerAssistantCase(owner, found.id, { question: 'Hola', speciesSlug: 'rosa' }),
    ).rejects.toMatchObject({ fieldErrors: { speciesSlug: 'invalid' } });
  });

  it('un rifiuto o un errore non crea consultas, ma la chiamata si registra con il costo', async () => {
    const kit = await newContract(owner, `Casa Errores ${STAMP}`);
    const before = (await callsOf(shop.tenant.tenantId)).length;
    const keys = [...storage.objects.keys()].length;
    fake.next = 'refused';
    await expect(
      startAssistantCase(owner, { subscriptionId: kit.subscriptionId }, await jpeg()),
    ).rejects.toMatchObject({ reason: 'assistant_failed' });
    // Nessun caso, nessun file; la chiamata rifiutata sì.
    expect([...storage.objects.keys()].length).toBe(keys);
    const refused = (await callsOf(shop.tenant.tenantId)).slice(before);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ caseId: null, status: 'REFUSED', errorCode: 'refusal' });
    expect(await listAssistantCases(owner, kit.subscriptionId)).toHaveLength(0);

    fake.next = 'ok';
    const found = await startAssistantCase(
      owner,
      { subscriptionId: kit.subscriptionId },
      await jpeg(),
    );
    fake.next = 'error';
    await expect(
      answerAssistantCase(owner, found.id, { question: '¿Qué tiene?', speciesSlug: '' }),
    ).rejects.toBeInstanceOf(ConflictError);
    const afterError = await getAssistantCase(owner, found.id);
    expect(afterError.answers).toHaveLength(0);
    const last = (await callsOf(shop.tenant.tenantId)).at(-1);
    expect(last).toMatchObject({ caseId: found.id, kind: 'ANSWER', status: 'FAILED' });
    fake.next = 'ok';
  });

  it('una foto che non serve: il caso lo dice e non accetta domande', async () => {
    fake.next = 'ok';
    const kit = await newContract(owner, `Foto Oscura ${STAMP}`);
    fake.recognition = {
      photoUsable: false,
      candidates: [],
      notInList: false,
      condition: 'La foto está muy oscura.',
    };
    const found = await startAssistantCase(
      owner,
      { subscriptionId: kit.subscriptionId },
      await jpeg(),
    );
    expect(found).toMatchObject({ photoUsable: false, canAsk: false });
    await expect(
      answerAssistantCase(owner, found.id, { question: '¿Qué tiene?', speciesSlug: '' }),
    ).rejects.toMatchObject({ reason: 'assistant_photo_unusable' });
    fake.recognition = {
      photoUsable: true,
      candidates: [{ slug: 'telefono', likelihood: 'high' }],
      notInList: false,
      condition: 'Hojas amarillas en la base.',
    };
  });
});

describe('Asistente de plantas: tetti, isolamento e foto', () => {
  it('20 consultas al giorno per fioreria; il budget del mese ferma tutte le fiorerie', async () => {
    fake.next = 'ok';
    const limited = await createTestShop('Florería Límite Asistente');
    await setUpOffer(limited.owner);
    const kit = await newContract(limited.owner, `Límite ${STAMP}`);
    const found = await startAssistantCase(
      limited.owner,
      { subscriptionId: kit.subscriptionId },
      await jpeg(),
    );
    // 20 consultas già fatte oggi (scritte a mano: casi pieni).
    await withSystemContext(db, { reason: 'test: consultas di oggi' }, async (tx) => {
      for (let index = 0; index < 20; index++) {
        const extra = await tx.assistantCase.create({
          data: {
            tenantId: limited.tenant.tenantId,
            customerId: (
              await tx.customerSubscription.findUniqueOrThrow({
                where: { id: kit.subscriptionId },
                select: { customerId: true },
              })
            ).customerId,
            subscriptionId: kit.subscriptionId,
            channel: 'SHOP',
            photoUsable: true,
            storageKey: `tenants/${limited.tenant.tenantId}/care-photos/x-${index}.jpg`,
            thumbKey: `tenants/${limited.tenant.tenantId}/care-photos/x-${index}-t.jpg`,
          },
        });
        await tx.assistantAnswer.create({
          data: {
            tenantId: limited.tenant.tenantId,
            caseId: extra.id,
            subscriptionId: kit.subscriptionId,
            channel: 'SHOP',
            question: `Pregunta ${index}`,
            answer: 'Respuesta',
          },
        });
      }
    });
    await expect(
      answerAssistantCase(limited.owner, found.id, { question: '¿Riego?', speciesSlug: '' }),
    ).rejects.toMatchObject({ reason: 'assistant_daily_limit' });
    await expect(
      startAssistantCase(limited.owner, { subscriptionId: kit.subscriptionId }, await jpeg()),
    ).rejects.toMatchObject({ reason: 'assistant_daily_limit' });

    // Il budget: una spesa del mese oltre il tetto ferma anche le altre fiorerie.
    const kitOwner = await newContract(owner, `Presupuesto ${STAMP}`);
    const spent = await withSystemContext(db, { reason: 'test: budget finito' }, (tx) =>
      tx.assistantCall.create({
        data: {
          tenantId: limited.tenant.tenantId,
          kind: 'RECOGNIZE',
          status: 'FAILED',
          model: 'claude-opus-5-5',
          promptVersion: 'v1',
          costMicros: 1_000_000_000,
          errorCode: 'test',
        },
      }),
    );
    try {
      await expect(
        startAssistantCase(owner, { subscriptionId: kitOwner.subscriptionId }, await jpeg()),
      ).rejects.toMatchObject({ reason: 'assistant_budget_reached' });
    } finally {
      await withSystemContext(db, { reason: 'test: budget ripristinato' }, (tx) =>
        tx.assistantCall.delete({ where: { id: spent.id } }),
      );
    }
  });

  it('un’altra fioreria, un altro contratto o una pianta di un altro contratto: 404', async () => {
    fake.next = 'ok';
    const kit = await newContract(owner, `Aislamiento ${STAMP}`);
    const second = await newContract(owner, `Segundo ${STAMP}`);
    const found = await startAssistantCase(
      owner,
      { subscriptionId: kit.subscriptionId },
      await jpeg(),
    );
    await expect(getAssistantCase(other.owner, found.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAssistantPhotoImage(other.owner, found.id, 'full')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      answerAssistantCase(other.owner, found.id, { question: 'Hola', speciesSlug: '' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      startAssistantCase(other.owner, { subscriptionId: kit.subscriptionId }, await jpeg()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      startAssistantCase(
        owner,
        { subscriptionId: kit.subscriptionId, plantId: second.plantId },
        await jpeg(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Il caso si legge solo dal suo contratto.
    await expect(getAssistantCase(owner, found.id, second.subscriptionId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // La sonda: l'ID dell'altra fioreria lascia un evento di sicurezza.
    const events = await withSystemContext(db, { reason: 'test: sonda' }, (tx) =>
      tx.auditLog.count({
        where: { action: 'security.cross_tenant_access_attempt', entityId: found.id },
      }),
    );
    expect(events).toBeGreaterThan(0);
  });

  it('assistente spento: errore chiaro e il pannello lo dice', async () => {
    const kit = await newContract(owner, `Apagado ${STAMP}`);
    setPlantAssistant(null);
    try {
      await expect(
        startAssistantCase(owner, { subscriptionId: kit.subscriptionId }, await jpeg()),
      ).rejects.toMatchObject({ reason: 'assistant_unavailable' });
      expect((await getAssistantPanel(owner)).available).toBe(false);
    } finally {
      setPlantAssistant(fake);
    }
  });

  it('la foto del caso si cancella 30 giorni dopo la fine del contratto; il testo resta', async () => {
    fake.next = 'ok';
    const kit = await newContract(owner, `Fin Contrato ${STAMP}`);
    const found = await startAssistantCase(
      owner,
      { subscriptionId: kit.subscriptionId },
      await jpeg(),
    );
    await answerAssistantCase(owner, found.id, { question: '¿Riego?', speciesSlug: 'telefono' });
    const ended = new Date(Date.now() - 40 * 86_400_000);
    await withSystemContext(db, { reason: 'test: contratto finito' }, (tx) =>
      tx.customerSubscription.update({
        where: { id: kit.subscriptionId },
        data: {
          status: 'ENDED',
          startDate: new Date(ended.getTime() - 60 * 86_400_000),
          endDate: ended,
          endedAt: ended,
        },
      }),
    );
    const keysBefore = [...storage.objects.keys()].filter((key) => key.includes(found.id));
    expect(keysBefore).toHaveLength(2);
    await purgeCarePhotos();
    expect([...storage.objects.keys()].filter((key) => key.includes(found.id))).toHaveLength(0);
    const after = await getAssistantCase(owner, found.id);
    expect(after.photoAvailable).toBe(false);
    expect(after.answers).toHaveLength(1);
    await expect(getAssistantPhotoImage(owner, found.id, 'thumb')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
