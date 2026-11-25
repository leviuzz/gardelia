import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import { createTestUser } from '@floral/db/testing';
import {
  addDays,
  dayOfWeek,
  todayInTimeZone,
  toIsoDate,
  type AssistantAnswerOutput,
  type AssistantAnswerPromptInput,
  type AssistantModel,
  type AssistantRecognitionOutput,
  type CalendarDate,
} from '@floral/domain';
import {
  ForbiddenError,
  MemoryMailer,
  MemoryStorage,
  NotFoundError,
  ValidationError,
  acceptCarePortalInvite,
  addCarePlant,
  addCustomerAddress,
  answerMyAssistantCase,
  askMyShopForAssistantCredits,
  confirmCareContract,
  createCareContract,
  createCareSlot,
  createCustomer,
  endCareContract,
  exportBuyerData,
  getAssistantCreditsPanel,
  getCareContract,
  getCareSettings,
  getCareThread,
  getContractAssistantCredits,
  getMyAssistant,
  getMyAssistantCase,
  getMyAssistantPanel,
  getMyAssistantPhoto,
  giveAssistantCredits,
  inviteCarePortal,
  sendMyAssistantCaseToShop,
  setObjectStorage,
  setPlantAssistant,
  startMyAssistantCase,
  updateCareSettings,
  updatePrimaryLocation,
  type AssistantCallResult,
  type BuyerContext,
  type CarePortalDeps,
  type PlantAssistant,
  type TenantContext,
} from '../src/index';
import { purgeCarePhotos } from '../src/jobs/care';
import { grantAiCredits } from '../src/platform';
import { jobWriteScope, loadJobScope } from '../src/scope';
import { closeEndedCareContractTx } from '../src/services/care-generation';
import { contextFor, createTestShop, type TestShop } from '../src/testing';
import type { RecognitionRequest } from '../src/ai/plant-assistant/types';

/**
 * Floral Care, blocco 6b (ADR-085): l'Asistente de plantas per i clienti della fioreria, con i
 * crediti. La fioreria compra crediti (operazione di piattaforma) e li dà ai contratti (solo
 * proprietario e gerente, fino al saldo, in fila); il cliente consulta in Mi Floral Care: 1 credito
 * per risposta riuscita, mai sotto zero, errori che non lo usano; mix dei modelli; tetto del giorno
 * per contratto; solo i propri casi; «Enviar a la florería» e «Pedir más consultas» come messaggi;
 * crediti che tornano a fine contratto; isolamento fra fiorerie; foto cancellate con le altre.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const STAMP = Date.now().toString(36);
const APP = 'https://gardelia.example.test';
const today = (): CalendarDate => todayInTimeZone(TZ);
const storage = new MemoryStorage();
const portalDeps: CarePortalDeps = {
  mailer: new MemoryMailer(),
  appUrl: APP,
  secret: 'a'.repeat(48),
};

const USAGE = { inputTokens: 1_000, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 };

class FakeAssistant implements PlantAssistant {
  readonly id = 'anthropic' as const;
  readonly simulated = false;
  next: 'ok' | 'refused' | 'error' = 'ok';
  /** Una risposta lenta, per provare due domande insieme. */
  delayMs = 0;
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
    looksUnhealthy: true,
  };
  lastRecognition: RecognitionRequest | null = null;
  lastAnswer: AssistantAnswerPromptInput | null = null;
  answers = 0;

  constructor(readonly model: AssistantModel) {}

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
    this.answers += 1;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const value: AssistantAnswerOutput = {
      answer: 'Riega menos y revisa la tierra con el dedo.',
      steps: ['Toca la tierra antes de regar.', '', 'Quita las hojas secas.'],
      unsure: false,
      askFlorist: false,
    };
    return this.#result(value);
  }
}

const main = new FakeAssistant('claude-opus-5-5');
const care = new FakeAssistant('claude-haiku-5-5');
let shop: TestShop;
let owner: TenantContext;
let other: TestShop;
let operatorEmail: string;
let slots = 0;

interface Kit {
  readonly subscriptionId: string;
  readonly plantId: string;
}

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

async function newContract(ctx: TenantContext, name: string, confirm = true): Promise<Kit> {
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
  if (confirm) await confirmCareContract(ctx, contract.id);
  const detail = await getCareContract(ctx, contract.id);
  return { subscriptionId: contract.id, plantId: detail.plants[0]!.id };
}

/** Una persona con il suo conto, invitata al contratto e già dentro. */
async function personWithAccess(ctx: TenantContext, kit: Kit): Promise<BuyerContext> {
  const user = await createTestUser(db);
  const invite = await inviteCarePortal(
    ctx,
    kit.subscriptionId,
    { email: user.email, scope: 'CONTRACT', canSeeMoney: 'on' },
    portalDeps,
  );
  const buyer: BuyerContext = { userId: user.id, country: 'MX' };
  await acceptCarePortalInvite({
    secret: portalDeps.secret,
    token: invite.url.split('/').pop() ?? '',
    buyer,
    userEmail: user.email,
  });
  return buyer;
}

async function buyCredits(target: TestShop, units: number): Promise<void> {
  await grantAiCredits({
    operatorEmail,
    tenantSlug: target.tenant.slug,
    units,
    feature: 'PLANT_ASSISTANT',
  });
}

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#3f6b4f' } })
      .jpeg()
      .toBuffer(),
  );
}

async function callsOf(tenantId: string) {
  return withSystemContext(db, { reason: 'test: chiamate' }, (tx) =>
    tx.assistantCall.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
  );
}

async function holdsOf(subscriptionId: string): Promise<number> {
  return withSystemContext(db, { reason: 'test: riserve' }, (tx) =>
    tx.assistantCreditHold.count({ where: { subscriptionId } }),
  );
}

const careQuestion = (question: string, speciesSlug = 'telefono') => ({
  kind: 'CARE',
  question,
  speciesSlug,
});

beforeAll(async () => {
  setObjectStorage(storage);
  setPlantAssistant({ main, care });
  const operator = await createTestUser(db, { name: 'Operador Asistente' });
  await withSystemContext(db, { reason: 'test: admin di piattaforma' }, (tx) =>
    tx.user.update({ where: { id: operator.id }, data: { platformRole: 'SUPER_ADMIN' } }),
  );
  operatorEmail = operator.email;
  shop = await createTestShop('Florería Asistente');
  owner = await contextFor(shop.tenant.owner.id, shop.tenant.slug);
  await setUpOffer(owner);
  other = await createTestShop('Florería Ajena Asistente');
  await setUpOffer(other.owner);
});

afterAll(async () => {
  setObjectStorage(null);
  setPlantAssistant(undefined);
  await disconnectDb();
});

describe('Asistente de plantas: i crediti della fioreria', () => {
  it('comprati dalla piattaforma, dati ai contratti fino al saldo, solo da proprietario e gerente', async () => {
    const buyer = await createTestShop('Florería Créditos');
    await setUpOffer(buyer.owner);
    const kit = await newContract(buyer.owner, `Oficinas Créditos ${STAMP}`);
    const team = buyer.staff;

    expect(await getAssistantCreditsPanel(buyer.owner)).toMatchObject({
      available: true,
      purchased: 0,
      remaining: 0,
      canGive: true,
    });
    await expect(
      giveAssistantCredits(buyer.owner, kit.subscriptionId, { credits: '1' }),
    ).rejects.toMatchObject({ reason: 'assistant_shop_credits' });

    // L'operazione di piattaforma: crediti dell'assistente, separati dalle anteprime.
    const grant = await grantAiCredits({
      operatorEmail,
      tenantSlug: buyer.tenant.slug,
      units: 10,
      feature: 'PLANT_ASSISTANT',
    });
    expect(grant).toMatchObject({ units: 10, feature: 'PLANT_ASSISTANT', totalGranted: 10 });
    const images = await grantAiCredits({ operatorEmail, tenantSlug: buyer.tenant.slug, units: 2 });
    expect(images).toMatchObject({ feature: 'BOUQUET_PREVIEW', totalGranted: 2 });
    expect(await getAssistantCreditsPanel(team)).toMatchObject({
      purchased: 10,
      allocated: 0,
      remaining: 10,
      canGive: false,
    });

    // Lo staff vede ma non dà; input fuori misura; il proprietario dà 3.
    await expect(
      giveAssistantCredits(team, kit.subscriptionId, { credits: '3' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    for (const credits of ['0', '501', 'tres', '']) {
      await expect(
        giveAssistantCredits(buyer.owner, kit.subscriptionId, { credits }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await giveAssistantCredits(buyer.owner, kit.subscriptionId, { credits: '3' })).toEqual({
      given: 3,
      shopRemaining: 7,
    });
    expect(await getContractAssistantCredits(team, kit.subscriptionId)).toMatchObject({
      given: 3,
      used: 0,
      remaining: 3,
      open: true,
      shopRemaining: 7,
      canGive: false,
      hasPortalAccess: false,
    });
    await expect(
      giveAssistantCredits(buyer.owner, kit.subscriptionId, { credits: '8' }),
    ).rejects.toMatchObject({ reason: 'assistant_shop_credits' });

    // Due «Dar créditos» insieme sugli ultimi 7: uno solo passa (mai sotto zero).
    const race = await Promise.allSettled([
      giveAssistantCredits(buyer.owner, kit.subscriptionId, { credits: '4' }),
      giveAssistantCredits(buyer.owner, kit.subscriptionId, { credits: '4' }),
    ]);
    expect(race.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(await getAssistantCreditsPanel(buyer.owner)).toMatchObject({
      allocated: 7,
      remaining: 3,
    });

    // Una bozza non riceve crediti; il registro con il numero, mai testi.
    const draft = await newContract(buyer.owner, `Borrador Créditos ${STAMP}`, false);
    await expect(
      giveAssistantCredits(buyer.owner, draft.subscriptionId, { credits: '1' }),
    ).rejects.toMatchObject({ reason: 'assistant_contract_closed' });
    const audit = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: buyer.tenant.tenantId, action: 'care.assistant_credits_given' },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audit.map((row) => (row.metadata as { count: number }).count)).toEqual([3, 4]);
    const granted = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
      tx.auditLog.count({
        where: { tenantId: buyer.tenant.tenantId, action: 'ai_credits.assistant_granted' },
      }),
    );
    expect(granted).toBe(1);
  });

  it('un’altra fioreria non dà crediti né li legge su un contratto non suo: 404', async () => {
    const kit = await newContract(owner, `Ajeno Créditos ${STAMP}`);
    await buyCredits(other, 5);
    await expect(
      giveAssistantCredits(other.owner, kit.subscriptionId, { credits: '1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getContractAssistantCredits(other.owner, kit.subscriptionId),
    ).rejects.toBeInstanceOf(NotFoundError);
    const events = await withSystemContext(db, { reason: 'test: sonda' }, (tx) =>
      tx.auditLog.count({
        where: {
          action: 'security.cross_tenant_access_attempt',
          entityId: kit.subscriptionId,
        },
      }),
    );
    expect(events).toBeGreaterThan(0);
    expect((await getAssistantCreditsPanel(other.owner)).remaining).toBe(5);
  });
});

describe('Asistente de plantas: il cliente in Mi Floral Care', () => {
  it('foto → specie della lista → risposta con il modello giusto; 1 credito solo se riesce', async () => {
    main.next = 'ok';
    care.next = 'ok';
    await buyCredits(shop, 20);
    const kit = await newContract(owner, `Hotel Asistente ${STAMP}`);
    await giveAssistantCredits(owner, kit.subscriptionId, { credits: '4' });
    const person = await personWithAccess(owner, kit);
    expect((await getContractAssistantCredits(owner, kit.subscriptionId)).hasPortalAccess).toBe(
      true,
    );

    const panel = await getMyAssistantPanel(person, kit.subscriptionId, 'es-MX');
    expect(panel).toMatchObject({
      available: true,
      simulated: false,
      open: true,
      credits: { allocated: 4, used: 0, remaining: 4 },
      answersLimitReached: false,
      photosLimitReached: false,
      cases: [],
    });
    expect(panel.plants).toEqual([{ id: kit.plantId, name: 'Potos de recepción' }]);
    expect(panel.species.find((item) => item.slug === 'aglaonema')?.care?.light).toBe('LOW');

    // La foto: solo specie della lista, lista in es-MX al modello, foto ridotta; nessun credito usato.
    const found = await startMyAssistantCase(
      person,
      kit.subscriptionId,
      { locale: 'es-MX', plantId: kit.plantId },
      await jpeg(),
    );
    expect(found.candidates.map((candidate) => candidate.slug)).toEqual(['telefono', 'filodendro']);
    expect(found.candidates[0]?.care?.petToxicity).toBe('TOXIC');
    expect(found).toMatchObject({
      plantName: 'Potos de recepción',
      photoAvailable: true,
      looksUnhealthy: true,
      defaultKind: 'PROBLEM',
      answersLeft: 3,
      condition: 'Hojas amarillas en la base.',
    });
    const sent = main.lastRecognition!;
    expect(sent.species.find((item) => item.slug === 'telefono')?.name).toBe('Teléfono');
    const size = await sharp(Buffer.from(sent.image.bytes)).metadata();
    expect(Math.max(size.width ?? 0, size.height ?? 0)).toBeLessThanOrEqual(1092);
    expect((await getMyAssistant(person, kit.subscriptionId, 'es-MX')).credits.remaining).toBe(4);
    const thumb = await getMyAssistantPhoto(person, kit.subscriptionId, found.id, 'thumb');
    expect(thumb?.contentType).toBe('image/jpeg');

    // Una domanda di cura: risponde il modello leggero, con i nostri dati e la scheda della pianta.
    const answered = await answerMyAssistantCase(
      person,
      kit.subscriptionId,
      found.id,
      'es-MX',
      careQuestion('  ¿Cada cuándo la riego?  ', 'calathea'),
    );
    const first = answered.answers[0]!;
    expect(first).toMatchObject({ kind: 'CARE', question: '¿Cada cuándo la riego?' });
    expect(first.steps).toEqual(['Toca la tierra antes de regar.', 'Quita las hojas secas.']);
    expect(first.species?.care).toMatchObject({ petToxicity: 'NON_TOXIC' });
    expect(care.lastAnswer).toMatchObject({
      kind: 'CARE',
      locale: 'es-MX',
      plant: { size: 'MEDIUM', location: 'Junto a la ventana' },
    });
    expect(care.lastAnswer?.species?.care?.watering).toBe('SLIGHTLY_MOIST');
    expect(answered.defaultKind).toBe('CARE');
    const after = await getMyAssistant(person, kit.subscriptionId, 'es-MX');
    expect(after.credits).toEqual({ allocated: 4, used: 1, remaining: 3 });
    expect(after.cases[0]).toMatchObject({ id: found.id, answers: 1, speciesName: 'Calathea' });
    // La fioreria vede quante, non che cosa.
    expect(await getContractAssistantCredits(owner, kit.subscriptionId)).toMatchObject({
      used: 1,
      remaining: 3,
    });

    // Un problema: risponde il modello principale, in inglese se la persona usa l'inglese.
    await answerMyAssistantCase(person, kit.subscriptionId, found.id, 'en-US', {
      kind: 'PROBLEM',
      question: 'Why are the leaves yellow?',
      speciesSlug: '',
    });
    expect(main.lastAnswer).toMatchObject({ kind: 'PROBLEM', locale: 'en-US', species: null });
    expect(main.lastAnswer?.previous).toHaveLength(1);
    const calls = (await callsOf(shop.tenant.tenantId)).filter((call) => call.caseId === found.id);
    expect(calls.map((call) => [call.kind, call.model, call.status])).toEqual([
      ['RECOGNIZE', 'claude-opus-5-5', 'SUCCEEDED'],
      ['ANSWER', 'claude-haiku-5-5', 'SUCCEEDED'],
      ['ANSWER', 'claude-opus-5-5', 'SUCCEEDED'],
    ]);

    // Un errore del modello non usa il credito e non lascia riserve; la chiamata si registra.
    care.next = 'error';
    await expect(
      answerMyAssistantCase(person, kit.subscriptionId, found.id, 'es-MX', careQuestion('¿Y?')),
    ).rejects.toMatchObject({ reason: 'assistant_failed' });
    care.next = 'ok';
    expect((await getMyAssistant(person, kit.subscriptionId, 'es-MX')).credits.remaining).toBe(2);
    expect(await holdsOf(kit.subscriptionId)).toBe(0);
    expect((await callsOf(shop.tenant.tenantId)).at(-1)).toMatchObject({
      caseId: found.id,
      kind: 'ANSWER',
      status: 'FAILED',
    });

    // La terza domanda; poi il caso è pieno.
    const full = await answerMyAssistantCase(
      person,
      kit.subscriptionId,
      found.id,
      'es-MX',
      careQuestion('¿Y el abono?'),
    );
    expect(full.answersLeft).toBe(0);
    await expect(
      answerMyAssistantCase(person, kit.subscriptionId, found.id, 'es-MX', careQuestion('¿Más?')),
    ).rejects.toMatchObject({ reason: 'assistant_case_full' });

    // Errori del modulo: senza tipo, domanda vuota, specie che non è una pianta.
    const second = await startMyAssistantCase(
      person,
      kit.subscriptionId,
      { locale: 'es-MX' },
      await jpeg(),
    );
    await expect(
      answerMyAssistantCase(person, kit.subscriptionId, second.id, 'es-MX', {
        question: 'Hola',
        speciesSlug: '',
      }),
    ).rejects.toMatchObject({ fieldErrors: { kind: 'required' } });
    await expect(
      answerMyAssistantCase(person, kit.subscriptionId, second.id, 'es-MX', careQuestion('  ')),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      answerMyAssistantCase(
        person,
        kit.subscriptionId,
        second.id,
        'es-MX',
        careQuestion('Hola', 'rosa'),
      ),
    ).rejects.toMatchObject({ fieldErrors: { speciesSlug: 'invalid' } });

    // L'ultimo credito, poi più niente: né domande né foto.
    await answerMyAssistantCase(
      person,
      kit.subscriptionId,
      second.id,
      'es-MX',
      careQuestion('¿Luz?'),
    );
    expect((await getMyAssistant(person, kit.subscriptionId, 'es-MX')).credits.remaining).toBe(0);
    await expect(
      answerMyAssistantCase(person, kit.subscriptionId, second.id, 'es-MX', careQuestion('¿Más?')),
    ).rejects.toMatchObject({ reason: 'assistant_no_credits' });
    await expect(
      startMyAssistantCase(person, kit.subscriptionId, { locale: 'es-MX' }, await jpeg()),
    ).rejects.toMatchObject({ reason: 'assistant_no_credits' });
  });

  it('due domande insieme sull’ultimo credito: una sola risposta, nessuna riserva rimasta', async () => {
    main.next = 'ok';
    care.next = 'ok';
    await buyCredits(shop, 2);
    const kit = await newContract(owner, `Carrera ${STAMP}`);
    await giveAssistantCredits(owner, kit.subscriptionId, { credits: '1' });
    const person = await personWithAccess(owner, kit);
    const a = await startMyAssistantCase(
      person,
      kit.subscriptionId,
      { locale: 'es-MX' },
      await jpeg(),
    );
    const b = await startMyAssistantCase(
      person,
      kit.subscriptionId,
      { locale: 'es-MX' },
      await jpeg(),
    );
    care.delayMs = 300;
    const before = care.answers;
    const results = await Promise.allSettled([
      answerMyAssistantCase(person, kit.subscriptionId, a.id, 'es-MX', careQuestion('¿Riego?')),
      answerMyAssistantCase(person, kit.subscriptionId, b.id, 'es-MX', careQuestion('¿Luz?')),
    ]);
    care.delayMs = 0;
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((item) => item.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      reason: 'assistant_no_credits',
    });
    // La seconda non ha nemmeno chiamato il modello.
    expect(care.answers - before).toBe(1);
    expect((await getMyAssistant(person, kit.subscriptionId, 'es-MX')).credits).toEqual({
      allocated: 1,
      used: 1,
      remaining: 0,
    });
    expect(await holdsOf(kit.subscriptionId)).toBe(0);
  });

  it('ognuno vede solo i propri casi; i crediti sono del contratto; fuori contratto 404', async () => {
    main.next = 'ok';
    care.next = 'ok';
    await buyCredits(shop, 6);
    const kit = await newContract(owner, `Oficinas Personas ${STAMP}`);
    const otherKit = await newContract(owner, `Otro Contrato ${STAMP}`);
    await giveAssistantCredits(owner, kit.subscriptionId, { credits: '5' });
    const ana = await personWithAccess(owner, kit);
    const luis = await personWithAccess(owner, kit);
    const stranger = await personWithAccess(owner, otherKit);
    const outsider: BuyerContext = { userId: (await createTestUser(db)).id, country: 'MX' };

    const found = await startMyAssistantCase(
      ana,
      kit.subscriptionId,
      { locale: 'es-MX' },
      await jpeg(),
    );
    await answerMyAssistantCase(
      ana,
      kit.subscriptionId,
      found.id,
      'es-MX',
      careQuestion('¿Riego?'),
    );

    // Luis non vede il caso di Ana, ma i crediti sono gli stessi.
    const luisView = await getMyAssistant(luis, kit.subscriptionId, 'es-MX');
    expect(luisView.cases).toEqual([]);
    expect(luisView.credits).toEqual({ allocated: 5, used: 1, remaining: 4 });
    await expect(
      getMyAssistantCase(luis, kit.subscriptionId, found.id, 'es-MX'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      answerMyAssistantCase(luis, kit.subscriptionId, found.id, 'es-MX', careQuestion('¿Y?')),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await getMyAssistantPhoto(luis, kit.subscriptionId, found.id, 'full')).toBeNull();
    await expect(
      sendMyAssistantCaseToShop(luis, kit.subscriptionId, found.id, 'es-MX'),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Un'altra persona di un altro contratto, o senza accesso: 404.
    await expect(
      getMyAssistantCase(stranger, kit.subscriptionId, found.id, 'es-MX'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getMyAssistantCase(stranger, otherKit.subscriptionId, found.id, 'es-MX'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getMyAssistant(outsider, kit.subscriptionId, 'es-MX')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      startMyAssistantCase(outsider, kit.subscriptionId, { locale: 'es-MX' }, await jpeg()),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Il contratto senza crediti: la persona li deve chiedere.
    expect(
      (await getMyAssistant(stranger, otherKit.subscriptionId, 'es-MX')).credits.remaining,
    ).toBe(0);
    // Una pianta di un altro contratto: 404.
    await expect(
      startMyAssistantCase(
        ana,
        kit.subscriptionId,
        { locale: 'es-MX', plantId: otherKit.plantId },
        await jpeg(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('«Enviar a la florería» e «Pedir más consultas»: messaggi nel filo, una volta sola', async () => {
    main.next = 'ok';
    care.next = 'ok';
    await buyCredits(shop, 2);
    const kit = await newContract(owner, `Casa Mensajes ${STAMP}`);
    await giveAssistantCredits(owner, kit.subscriptionId, { credits: '2' });
    const person = await personWithAccess(owner, kit);
    const found = await startMyAssistantCase(
      person,
      kit.subscriptionId,
      { locale: 'es-MX', plantId: kit.plantId },
      await jpeg(),
    );
    await expect(
      sendMyAssistantCaseToShop(person, kit.subscriptionId, found.id, 'es-MX'),
    ).rejects.toMatchObject({ reason: 'assistant_nothing_to_send' });
    await answerMyAssistantCase(
      person,
      kit.subscriptionId,
      found.id,
      'es-MX',
      careQuestion('¿Riego?'),
    );

    const sent = await sendMyAssistantCaseToShop(person, kit.subscriptionId, found.id, 'es-MX');
    expect(sent.duplicate).toBe(false);
    expect(
      (await sendMyAssistantCaseToShop(person, kit.subscriptionId, found.id, 'es-MX')).duplicate,
    ).toBe(true);
    const thread = await getCareThread(owner, kit.subscriptionId);
    const message = thread.messages.find((item) => item.id === sent.id)!;
    expect(message.body).toContain('Consulta al Asistente de plantas');
    expect(message.body).toContain('Planta: Potos de recepción');
    expect(message.body).toContain('Especie: Teléfono (Epipremnum aureum)');
    expect(message.body).toContain('Pregunta: ¿Riego?');
    expect(message.body).toContain('Respuesta del asistente: Riega menos');
    expect(message.body).toContain('1. Toca la tierra antes de regar.');
    expect(message.photoId).not.toBeNull();

    // Un'altra domanda e di nuovo: un messaggio nuovo, in italiano se la persona usa l'italiano.
    await answerMyAssistantCase(
      person,
      kit.subscriptionId,
      found.id,
      'it-IT',
      careQuestion('¿Luz?'),
    );
    const again = await sendMyAssistantCaseToShop(person, kit.subscriptionId, found.id, 'it-IT');
    expect(again.duplicate).toBe(false);
    const italian = (await getCareThread(owner, kit.subscriptionId)).messages.find(
      (item) => item.id === again.id,
    );
    expect(italian?.body).toContain('Domanda: ¿Luz?');

    // Senza crediti: «Pedir más consultas», una volta al giorno.
    expect((await getMyAssistant(person, kit.subscriptionId, 'es-MX')).credits.remaining).toBe(0);
    const ask = await askMyShopForAssistantCredits(person, kit.subscriptionId, 'es-MX');
    expect(ask.duplicate).toBe(false);
    expect(
      (await askMyShopForAssistantCredits(person, kit.subscriptionId, 'es-MX')).duplicate,
    ).toBe(true);
    const askMessage = (await getCareThread(owner, kit.subscriptionId)).messages.find(
      (item) => item.id === ask.id,
    );
    expect(askMessage?.body).toContain('¿Me puedes dar más?');

    // «Descargar mis datos»: le consultas della persona.
    const data = await exportBuyerData(person);
    expect(data.floralCare.assistant.map((row) => row.question)).toEqual(['¿Riego?', '¿Luz?']);
    expect(data.floralCare.assistant[0]).toMatchObject({
      kind: 'CARE',
      shop: 'Florería Asistente',
    });
  });

  it('tetto del giorno per contratto: 10 foto e 10 risposte, poi si aspetta domani', async () => {
    main.next = 'ok';
    care.next = 'ok';
    await buyCredits(shop, 20);
    const kit = await newContract(owner, `Límite Diario ${STAMP}`);
    await giveAssistantCredits(owner, kit.subscriptionId, { credits: '20' });
    const person = await personWithAccess(owner, kit);
    const found = await startMyAssistantCase(
      person,
      kit.subscriptionId,
      { locale: 'es-MX' },
      await jpeg(),
    );
    // Oggi altre 9 foto e 10 risposte di un'altra persona dello stesso cliente (scritte a mano).
    await withSystemContext(db, { reason: 'test: uso di oggi' }, async (tx) => {
      const contract = await tx.customerSubscription.findUniqueOrThrow({
        where: { id: kit.subscriptionId },
        select: { tenantId: true, customerId: true },
      });
      for (let index = 0; index < 10; index++) {
        const extra = await tx.assistantCase.create({
          data: {
            tenantId: contract.tenantId,
            customerId: contract.customerId,
            subscriptionId: kit.subscriptionId,
            channel: 'PORTAL',
            photoUsable: true,
            storageKey: `tenants/${contract.tenantId}/care-photos/x-${STAMP}-${index}.jpg`,
            thumbKey: `tenants/${contract.tenantId}/care-photos/x-${STAMP}-${index}-t.jpg`,
          },
        });
        if (index === 9) break;
        await tx.assistantAnswer.create({
          data: {
            tenantId: contract.tenantId,
            caseId: extra.id,
            subscriptionId: kit.subscriptionId,
            channel: 'PORTAL',
            question: `Pregunta ${index}`,
            answer: 'Respuesta',
          },
        });
      }
    });
    const view = await getMyAssistant(person, kit.subscriptionId, 'es-MX');
    expect(view).toMatchObject({ photosLimitReached: true, answersLimitReached: false });
    await expect(
      startMyAssistantCase(person, kit.subscriptionId, { locale: 'es-MX' }, await jpeg()),
    ).rejects.toMatchObject({ reason: 'assistant_daily_limit' });
    // La decima risposta passa, l'undicesima no.
    await answerMyAssistantCase(person, kit.subscriptionId, found.id, 'es-MX', careQuestion('¿1?'));
    await expect(
      answerMyAssistantCase(person, kit.subscriptionId, found.id, 'es-MX', careQuestion('¿2?')),
    ).rejects.toMatchObject({ reason: 'assistant_daily_limit' });
    expect((await getMyAssistant(person, kit.subscriptionId, 'es-MX')).answersLimitReached).toBe(
      true,
    );
  });

  it('rifiuto, foto inutile, assistente spento e budget finito: niente crediti usati', async () => {
    care.next = 'ok';
    await buyCredits(shop, 3);
    const kit = await newContract(owner, `Casa Errores ${STAMP}`);
    await giveAssistantCredits(owner, kit.subscriptionId, { credits: '3' });
    const person = await personWithAccess(owner, kit);
    const keys = [...storage.objects.keys()].length;

    // Il riconoscimento rifiutato: nessun caso, nessun file; la chiamata sì (senza caso).
    main.next = 'refused';
    await expect(
      startMyAssistantCase(person, kit.subscriptionId, { locale: 'es-MX' }, await jpeg()),
    ).rejects.toMatchObject({ reason: 'assistant_failed' });
    main.next = 'ok';
    expect([...storage.objects.keys()].length).toBe(keys);
    expect((await callsOf(shop.tenant.tenantId)).at(-1)).toMatchObject({
      caseId: null,
      kind: 'RECOGNIZE',
      status: 'REFUSED',
    });
    expect((await getMyAssistant(person, kit.subscriptionId, 'es-MX')).cases).toEqual([]);

    // Una foto che non serve: nessuna domanda possibile.
    main.recognition = {
      ...main.recognition,
      photoUsable: false,
      candidates: [],
      looksUnhealthy: false,
    };
    const dark = await startMyAssistantCase(
      person,
      kit.subscriptionId,
      { locale: 'es-MX' },
      await jpeg(),
    );
    main.recognition = {
      ...main.recognition,
      photoUsable: true,
      candidates: [{ slug: 'telefono', likelihood: 'high' }],
    };
    expect(dark).toMatchObject({ photoUsable: false, answersLeft: 0 });
    await expect(
      answerMyAssistantCase(person, kit.subscriptionId, dark.id, 'es-MX', careQuestion('¿Qué?')),
    ).rejects.toMatchObject({ reason: 'assistant_photo_unusable' });

    // Assistente spento: la sezione non c'è, le scritture lo dicono.
    setPlantAssistant(null);
    try {
      expect((await getMyAssistant(person, kit.subscriptionId, 'es-MX')).available).toBe(false);
      await expect(
        startMyAssistantCase(person, kit.subscriptionId, { locale: 'es-MX' }, await jpeg()),
      ).rejects.toMatchObject({ reason: 'assistant_unavailable' });
    } finally {
      setPlantAssistant({ main, care });
    }

    // Il budget del mese finito ferma tutte le fiorerie, prima di riservare il credito.
    const found = await startMyAssistantCase(
      person,
      kit.subscriptionId,
      { locale: 'es-MX' },
      await jpeg(),
    );
    const spent = await withSystemContext(db, { reason: 'test: budget finito' }, (tx) =>
      tx.assistantCall.create({
        data: {
          tenantId: other.tenant.tenantId,
          kind: 'RECOGNIZE',
          status: 'FAILED',
          model: 'claude-opus-5-5',
          promptVersion: 'v2',
          costMicros: 1_000_000_000,
          errorCode: 'test',
        },
      }),
    );
    try {
      await expect(
        answerMyAssistantCase(person, kit.subscriptionId, found.id, 'es-MX', careQuestion('¿Y?')),
      ).rejects.toMatchObject({ reason: 'assistant_budget_reached' });
    } finally {
      await withSystemContext(db, { reason: 'test: budget ripristinato' }, (tx) =>
        tx.assistantCall.delete({ where: { id: spent.id } }),
      );
    }
    expect((await getMyAssistant(person, kit.subscriptionId, 'es-MX')).credits.remaining).toBe(3);
    expect(await holdsOf(kit.subscriptionId)).toBe(0);
  });
});

describe('Asistente de plantas: fine del contratto', () => {
  it('«Terminar» o la chiusura automatica: i crediti non usati tornano alla fioreria', async () => {
    main.next = 'ok';
    care.next = 'ok';
    const ender = await createTestShop('Florería Fin Asistente');
    await setUpOffer(ender.owner);
    await buyCredits(ender, 10);
    const byHand = await newContract(ender.owner, `Fin Manual ${STAMP}`);
    const byJob = await newContract(ender.owner, `Fin Automático ${STAMP}`);
    await giveAssistantCredits(ender.owner, byHand.subscriptionId, { credits: '5' });
    await giveAssistantCredits(ender.owner, byJob.subscriptionId, { credits: '3' });
    const person = await personWithAccess(ender.owner, byHand);
    const found = await startMyAssistantCase(
      person,
      byHand.subscriptionId,
      { locale: 'es-MX' },
      await jpeg(),
    );
    await answerMyAssistantCase(
      person,
      byHand.subscriptionId,
      found.id,
      'es-MX',
      careQuestion('¿Riego?'),
    );
    expect((await getAssistantCreditsPanel(ender.owner)).remaining).toBe(2);

    // I due contratti cominciati da un mese: il primo si termina a mano, il secondo è già scaduto.
    const monthAgo = new Date(Date.now() - 30 * 86_400_000);
    const yesterday = addDays(today(), -1);
    await withSystemContext(db, { reason: 'test: contratti cominciati' }, async (tx) => {
      await tx.customerSubscription.updateMany({
        where: { id: { in: [byHand.subscriptionId, byJob.subscriptionId] } },
        data: { startDate: monthAgo },
      });
      await tx.customerSubscription.update({
        where: { id: byJob.subscriptionId },
        data: { endDate: new Date(`${toIsoDate(yesterday)}T00:00:00Z`) },
      });
    });
    const ended = await endCareContract(ender.owner, byHand.subscriptionId, {
      endDate: toIsoDate(yesterday),
      customerNotified: 'on',
    });
    expect(ended.ended).toBe(true);
    const closed = await withTenantContext(
      db,
      { tenantId: ender.tenant.tenantId, userId: null },
      async (tx) => {
        const job = await loadJobScope(tx, ender.tenant.tenantId, 'test.assistant.close');
        return closeEndedCareContractTx(tx, jobWriteScope(job!), byJob.subscriptionId);
      },
    );
    expect(closed).toBe(true);

    // 4 + 3 tornati: la fioreria ha di nuovo 9 crediti; i contratti nessuno.
    expect(await getAssistantCreditsPanel(ender.owner)).toMatchObject({
      purchased: 10,
      allocated: 1,
      remaining: 9,
    });
    expect(await getContractAssistantCredits(ender.owner, byHand.subscriptionId)).toMatchObject({
      given: 5,
      returned: 4,
      used: 1,
      remaining: 0,
      open: false,
    });
    const audit = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: ender.tenant.tenantId,
          action: 'customer_subscription.ended',
          entityId: { in: [byHand.subscriptionId, byJob.subscriptionId] },
        },
      }),
    );
    expect(
      audit
        .map(
          (row) => (row.metadata as { assistantCreditsReturned?: number }).assistantCreditsReturned,
        )
        .sort(),
    ).toEqual([3, 4]);
    // Idempotente: il lavoro di nuovo non rende altro.
    await withTenantContext(db, { tenantId: ender.tenant.tenantId, userId: null }, async (tx) => {
      const job = await loadJobScope(tx, ender.tenant.tenantId, 'test.assistant.close');
      return closeEndedCareContractTx(tx, jobWriteScope(job!), byJob.subscriptionId);
    });
    expect((await getAssistantCreditsPanel(ender.owner)).remaining).toBe(9);

    // Il cliente legge ancora le sue consultas, ma non ne fa altre.
    const view = await getMyAssistant(person, byHand.subscriptionId, 'es-MX');
    expect(view).toMatchObject({ open: false, credits: { remaining: 0 } });
    expect(view.cases).toHaveLength(1);
    await expect(
      startMyAssistantCase(person, byHand.subscriptionId, { locale: 'es-MX' }, await jpeg()),
    ).rejects.toMatchObject({ reason: 'assistant_contract_closed' });
    await expect(
      giveAssistantCredits(ender.owner, byHand.subscriptionId, { credits: '1' }),
    ).rejects.toMatchObject({ reason: 'assistant_contract_closed' });
  });

  it('la foto del caso si cancella 30 giorni dopo la fine del contratto; il testo resta', async () => {
    main.next = 'ok';
    care.next = 'ok';
    await buyCredits(shop, 1);
    const kit = await newContract(owner, `Fin Fotos ${STAMP}`);
    await giveAssistantCredits(owner, kit.subscriptionId, { credits: '1' });
    const person = await personWithAccess(owner, kit);
    const found = await startMyAssistantCase(
      person,
      kit.subscriptionId,
      { locale: 'es-MX' },
      await jpeg(),
    );
    await answerMyAssistantCase(
      person,
      kit.subscriptionId,
      found.id,
      'es-MX',
      careQuestion('¿Riego?'),
    );
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
    expect([...storage.objects.keys()].filter((key) => key.includes(found.id))).toHaveLength(2);
    await purgeCarePhotos();
    expect([...storage.objects.keys()].filter((key) => key.includes(found.id))).toHaveLength(0);
    const answers = await withSystemContext(db, { reason: 'test: testo rimasto' }, (tx) =>
      tx.assistantAnswer.count({ where: { caseId: found.id } }),
    );
    expect(answers).toBe(1);
    const photo = await withSystemContext(db, { reason: 'test: foto cancellata' }, (tx) =>
      tx.assistantCase.findUniqueOrThrow({
        where: { id: found.id },
        select: { photoDeletedAt: true },
      }),
    );
    expect(photo.photoDeletedAt).not.toBeNull();
  });
});
