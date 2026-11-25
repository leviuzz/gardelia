/**
 * Floral Care, blocco 6b (ADR-085) — l'Asistente de plantas del cliente, in Mi Floral Care.
 *
 *  - Chi chiede è una persona con accesso al contratto (`BuyerContext`, solo dalla sessione). Tutto
 *    passa dalla modalità portale: il database apre solo il contratto della persona, e lì la
 *    persona legge e scrive solo i propri casi e le proprie risposte (`portal_read`/`portal_insert`).
 *  - 1 credito = 1 risposta riuscita (founder, 25/11); l'analisi della foto è compresa nella prima
 *    domanda, ma serve almeno un credito per farla. Prima di chiamare il modello si riserva un
 *    credito (`app_portal_assistant_reserve`, sotto lock del contratto: mai sotto zero); la risposta
 *    lo usa nella stessa transazione che la salva; un errore o un rifiuto lo rende, e la chiamata si
 *    registra lo stesso (si paga e va nel budget).
 *  - Contro gli abusi: al massimo 10 foto e 10 risposte al giorno per contratto (giorno della
 *    fioreria), più il budget mensile di piattaforma. Le chiamate al modello stanno fuori dalle
 *    transazioni.
 *  - Mix dei modelli: riconoscimento e problemi al modello principale, domande di cura a quello
 *    leggero.
 *  - «Enviar a la florería» e «Pedir más consultas» sono messaggi della persona nel filo del
 *    contratto (blocco 5b), con le stesse regole (contratto aperto, tetto del giorno). Il testo lo
 *    compone il servizio nella lingua di chi chiede, come la risposta.
 */
import { isRlsViolation, type PortalEntry, type TransactionClient } from '@floral/db';
import {
  ASSISTANT_CREDITS,
  ASSISTANT_LIMITS,
  CARE_MESSAGE_LIMITS,
  assistantAnswerModel,
  assistantContractAvailable,
  assistantDayStart,
  assistantDefaultKind,
  assistantQuestionSchema,
  cleanAnswer,
  cleanRecognition,
  isUuid,
  newId,
  parsePlantCare,
  toFieldErrors,
  toIsoDate,
  todayInTimeZone,
  type AssistantLikelihood,
  type AssistantQuestionKind,
  type AssistantSpecies,
  type CustomerSubscriptionStatus,
  type SupportedLocale,
} from '@floral/domain';
import { getPlantAssistants } from '../ai/plant-assistant';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { uuidFromSeed } from '../ids';
import { logger } from '../logger';
import { downscaleForModel, normalizeUploadedPhoto } from '../media/images';
import { readStoredImage, storeFilesThenCommit, type StoredImage } from '../media/stored-files';
import type { BuyerContext } from './buyer-account';
import { openPortal, postMyCareMessage, type MyCareMessagePostResult } from './my-floral-care';
import {
  FLOWER_SELECT,
  assertBudgetTx,
  assistantPhotoKeys,
  callRow,
  candidateList,
  nameIn,
  plantSpeciesTx,
  requireAssistants,
  speciesDto,
  stringList,
  withTimeout,
  type AssistantCallInput,
  type AssistantSpeciesDto,
  type FlowerRow,
} from './plant-assistant-internals';

// -----------------------------------------------------------------------------
// DTO
// -----------------------------------------------------------------------------

export interface MyAssistantCreditsDto {
  /** Dati dalla fioreria (meno quelli tornati a fine contratto). */
  readonly allocated: number;
  /** Risposte riuscite di tutte le persone del cliente su questo contratto. */
  readonly used: number;
  /** Ancora usabili. */
  readonly remaining: number;
}

export interface MyAssistantAnswerDto {
  readonly id: string;
  readonly kind: AssistantQuestionKind;
  readonly question: string;
  readonly answer: string;
  readonly steps: readonly string[];
  readonly unsure: boolean;
  readonly askFlorist: boolean;
  /** La specie confermata (null = «No sé»), con cura e avviso per cani e gatti dai nostri dati. */
  readonly species: AssistantSpeciesDto | null;
  readonly createdAt: Date;
}

export interface MyAssistantCaseDto {
  readonly id: string;
  readonly subscriptionId: string;
  readonly plantId: string | null;
  readonly plantName: string | null;
  readonly photoUsable: boolean;
  readonly notInList: boolean;
  /** Ciò che si vede nella foto, scritto dal modello. */
  readonly condition: string;
  readonly looksUnhealthy: boolean;
  readonly candidates: readonly (AssistantSpeciesDto & {
    readonly likelihood: AssistantLikelihood;
  })[];
  /** La specie della scheda della pianta, da proporre per prima se c'è. */
  readonly recordSpeciesSlug: string | null;
  /** La foto si vede ancora (si cancella 30 giorni dopo la fine del contratto). */
  readonly photoAvailable: boolean;
  readonly answers: readonly MyAssistantAnswerDto[];
  /** Domande ancora possibili su questa foto (al massimo 3, solo con una foto utile). */
  readonly answersLeft: number;
  /** La scelta proposta per la prossima domanda («Cómo cuidarla» o «Tiene un problema»). */
  readonly defaultKind: AssistantQuestionKind;
  readonly createdAt: Date;
}

export interface MyAssistantCaseSummaryDto {
  readonly id: string;
  readonly plantName: string | null;
  /** La specie della prima risposta, altrimenti il primo candidato. */
  readonly speciesName: string | null;
  readonly firstQuestion: string | null;
  readonly answers: number;
  readonly createdAt: Date;
}

/** La sezione «Asistente de plantas» della pagina del contratto. */
export interface MyAssistantDto {
  /** L'assistente è configurato (altrimenti la sezione non si mostra). */
  readonly available: boolean;
  /** Assistente finto di sviluppo e test: l'interfaccia lo dice. */
  readonly simulated: boolean;
  readonly shopName: string;
  /** Il fuso della fioreria, per le date. */
  readonly shopTimeZone: string;
  /** Contratto attivo o in pausa (e non in sola lettura): si può consultare. */
  readonly open: boolean;
  readonly credits: MyAssistantCreditsDto;
  /** Tetto del giorno del contratto raggiunto (risposte, foto). */
  readonly answersLimitReached: boolean;
  readonly photosLimitReached: boolean;
  /** Le ultime consultas della persona. */
  readonly cases: readonly MyAssistantCaseSummaryDto[];
}

/** La pagina dell'assistente: in più le piante del contratto e tutte le piante della lista. */
export interface MyAssistantPanelDto extends MyAssistantDto {
  readonly plants: readonly { readonly id: string; readonly name: string }[];
  readonly species: readonly AssistantSpeciesDto[];
}

// -----------------------------------------------------------------------------
// Aiuti
// -----------------------------------------------------------------------------

const RECENT_CASES = 5;

interface PortalCredits {
  readonly allocated: number;
  readonly used: number;
  readonly held: number;
  readonly answers_since: number;
  readonly cases_since: number;
}

/** I crediti e l'uso del giorno del contratto aperto (dal database: il portale vede solo le sue righe). */
async function portalCreditsTx(tx: TransactionClient, timeZone: string): Promise<PortalCredits> {
  const rows = await tx.$queryRaw<PortalCredits[]>`
    SELECT * FROM app_portal_assistant_credits(${assistantDayStart(timeZone)})`;
  const row = rows[0];
  if (!row) throw new NotFoundError('CustomerSubscription');
  return row;
}

function creditsDto(row: PortalCredits): MyAssistantCreditsDto {
  return {
    allocated: row.allocated,
    used: row.used,
    remaining: assistantContractAvailable(row.allocated, row.used, row.held),
  };
}

function isOpen(entry: PortalEntry, status: CustomerSubscriptionStatus): boolean {
  return !entry.readOnly && (status === 'ACTIVE' || status === 'PAUSED');
}

async function contractStatusTx(
  tx: TransactionClient,
  entry: PortalEntry,
  subscriptionId: string,
): Promise<CustomerSubscriptionStatus> {
  const contract = await tx.customerSubscription.findFirst({
    where: { tenantId: entry.tenantId, id: subscriptionId },
    select: { status: true },
  });
  if (!contract) throw new NotFoundError('CustomerSubscription');
  return contract.status;
}

/** I casi della persona su questo contratto (difesa in profondità: la RLS fa già lo stesso). */
function ownCases(entry: PortalEntry, buyer: BuyerContext, subscriptionId: string) {
  return {
    tenantId: entry.tenantId,
    subscriptionId,
    channel: 'PORTAL' as const,
    askedByUserId: buyer.userId,
  };
}

/**
 * Una chiamata non riuscita (o non salvata): si registra (si paga lo stesso) e la riserva del
 * credito si rende. Non lancia: chi la chiama lancia l'errore per la persona.
 */
async function settleFailedCall(
  buyer: BuyerContext,
  subscriptionId: string,
  call: AssistantCallInput,
  hold: string | null,
): Promise<void> {
  try {
    await openPortal(buyer, subscriptionId, async (tx) => {
      await tx.assistantCall.createMany({ data: [callRow(call)] });
      if (hold) await tx.$queryRaw`SELECT app_portal_assistant_release(${hold}::uuid) AS ok`;
    });
  } catch (error) {
    logger.error(
      { err: error, tenantId: call.tenantId, subscriptionId },
      'chiamata dell’Asistente de plantas non registrata (portale)',
    );
  }
  logger.warn(
    {
      tenantId: call.tenantId,
      subscriptionId,
      caseId: call.caseId,
      kind: call.kind,
      model: call.model,
      code: call.result.errorCode,
      costMicros: call.result.costMicros,
    },
    'chiamata dell’Asistente de plantas non riuscita (portale)',
  );
}

const CASE_SELECT = {
  id: true,
  subscriptionId: true,
  plantId: true,
  photoUsable: true,
  notInList: true,
  condition: true,
  looksUnhealthy: true,
  candidates: true,
  photoDeletedAt: true,
  createdAt: true,
  plant: { select: { name: true, species: { select: { slug: true, category: true } } } },
  answers: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      kind: true,
      question: true,
      answer: true,
      steps: true,
      unsure: true,
      askFlorist: true,
      createdAt: true,
      species: { select: FLOWER_SELECT },
    },
  },
} as const;

async function myCaseDtoTx(
  tx: TransactionClient,
  entry: PortalEntry,
  buyer: BuyerContext,
  subscriptionId: string,
  caseId: string,
  locale: SupportedLocale,
): Promise<MyAssistantCaseDto | null> {
  const row = await tx.assistantCase.findFirst({
    where: { ...ownCases(entry, buyer, subscriptionId), id: caseId },
    select: CASE_SELECT,
  });
  if (!row) return null;
  const candidates = candidateList(row.candidates);
  const flowers = candidates.length
    ? await tx.canonicalFlower.findMany({
        where: { slug: { in: candidates.map((candidate) => candidate.slug) } },
        select: FLOWER_SELECT,
      })
    : [];
  const bySlug = new Map(flowers.map((flower) => [flower.slug, flower]));
  const recordSpecies = row.plant?.species;
  const recordSpeciesSlug = recordSpecies?.category === 'PLANT' ? recordSpecies.slug : null;
  const last = row.answers.at(-1);
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    plantId: row.plantId,
    plantName: row.plant?.name ?? null,
    photoUsable: row.photoUsable,
    notInList: row.notInList,
    condition: row.condition,
    looksUnhealthy: row.looksUnhealthy,
    candidates: candidates.flatMap((candidate) => {
      const flower = bySlug.get(candidate.slug);
      return flower ? [{ ...speciesDto(flower, locale), likelihood: candidate.likelihood }] : [];
    }),
    recordSpeciesSlug,
    photoAvailable: row.photoDeletedAt === null,
    answers: row.answers.map((answer) => ({
      id: answer.id,
      kind: answer.kind,
      question: answer.question,
      answer: answer.answer,
      steps: stringList(answer.steps),
      unsure: answer.unsure,
      askFlorist: answer.askFlorist,
      species: answer.species ? speciesDto(answer.species, locale) : null,
      createdAt: answer.createdAt,
    })),
    answersLeft: row.photoUsable
      ? Math.max(0, ASSISTANT_LIMITS.answersPerCase - row.answers.length)
      : 0,
    defaultKind:
      last?.kind ??
      assistantDefaultKind({
        looksUnhealthy: row.looksUnhealthy,
        speciesKnown: candidates.length > 0 || recordSpeciesSlug !== null,
      }),
    createdAt: row.createdAt,
  };
}

async function recentCasesTx(
  tx: TransactionClient,
  entry: PortalEntry,
  buyer: BuyerContext,
  subscriptionId: string,
  locale: SupportedLocale,
): Promise<MyAssistantCaseSummaryDto[]> {
  const rows = await tx.assistantCase.findMany({
    where: ownCases(entry, buyer, subscriptionId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: RECENT_CASES,
    select: {
      id: true,
      createdAt: true,
      candidates: true,
      plant: { select: { name: true } },
      answers: {
        orderBy: { createdAt: 'asc' },
        select: { question: true, species: { select: { names: true } } },
      },
    },
  });
  const slugs = [
    ...new Set(
      rows.flatMap((row) =>
        candidateList(row.candidates)
          .slice(0, 1)
          .map((c) => c.slug),
      ),
    ),
  ];
  const flowers = slugs.length
    ? await tx.canonicalFlower.findMany({
        where: { slug: { in: slugs } },
        select: { slug: true, names: true },
      })
    : [];
  const nameOf = new Map(flowers.map((flower) => [flower.slug, nameIn(flower.names, locale)]));
  return rows.map((row) => {
    const first = row.answers[0];
    const candidate = candidateList(row.candidates)[0];
    return {
      id: row.id,
      plantName: row.plant?.name ?? null,
      speciesName: first?.species
        ? nameIn(first.species.names, locale)
        : candidate
          ? (nameOf.get(candidate.slug) ?? null)
          : null,
      firstQuestion: first?.question ?? null,
      answers: row.answers.length,
      createdAt: row.createdAt,
    };
  });
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

async function loadMyAssistant(
  buyer: BuyerContext,
  subscriptionId: string,
  locale: SupportedLocale,
  full: boolean,
) {
  const assistants = getPlantAssistants();
  const found = await openPortal(buyer, subscriptionId, async (tx, entry) => {
    const status = await contractStatusTx(tx, entry, subscriptionId);
    const credits = await portalCreditsTx(tx, entry.shop.timezone);
    const cases = await recentCasesTx(tx, entry, buyer, subscriptionId, locale);
    const plants = full
      ? await tx.carePlant.findMany({
          where: { tenantId: entry.tenantId, subscriptionId, status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, name: true },
        })
      : [];
    const species = full ? await plantSpeciesTx(tx) : [];
    return { entry, status, credits, cases, plants, species };
  });
  if (!found) throw new NotFoundError('CustomerSubscription');
  const summary: MyAssistantDto = {
    available: assistants !== null,
    simulated: assistants?.main.simulated ?? false,
    shopName: found.entry.shop.name,
    shopTimeZone: found.entry.shop.timezone,
    open: isOpen(found.entry, found.status),
    credits: creditsDto(found.credits),
    answersLimitReached: found.credits.answers_since >= ASSISTANT_LIMITS.contractAnswersPerDay,
    photosLimitReached: found.credits.cases_since >= ASSISTANT_LIMITS.contractCasesPerDay,
    cases: found.cases,
  };
  return { summary, plants: found.plants, species: found.species };
}

/** La sezione della pagina del contratto: crediti, tetto del giorno, ultime consultas. */
export async function getMyAssistant(
  buyer: BuyerContext,
  subscriptionId: string,
  locale: SupportedLocale,
): Promise<MyAssistantDto> {
  return (await loadMyAssistant(buyer, subscriptionId, locale, false)).summary;
}

/** La pagina dell'assistente: in più le piante del contratto e le piante della lista («Otra»). */
export async function getMyAssistantPanel(
  buyer: BuyerContext,
  subscriptionId: string,
  locale: SupportedLocale,
): Promise<MyAssistantPanelDto> {
  const loaded = await loadMyAssistant(buyer, subscriptionId, locale, true);
  return {
    ...loaded.summary,
    plants: loaded.plants,
    species: loaded.species
      .map((row) => speciesDto(row, locale))
      .sort((a, b) => a.name.localeCompare(b.name, locale)),
  };
}

/** Un caso della persona (con le risposte); 404 se non è suo o non esiste. */
export async function getMyAssistantCase(
  buyer: BuyerContext,
  subscriptionId: string,
  caseId: string,
  locale: SupportedLocale,
): Promise<MyAssistantCaseDto> {
  if (!isUuid(caseId)) throw new NotFoundError('AssistantCase');
  const found = await openPortal(buyer, subscriptionId, (tx, entry) =>
    myCaseDtoTx(tx, entry, buyer, subscriptionId, caseId, locale),
  );
  if (!found) throw new NotFoundError('AssistantCase');
  return found;
}

/** La foto di un caso della persona (o la miniatura); null se non c'è o è cancellata. */
export async function getMyAssistantPhoto(
  buyer: BuyerContext,
  subscriptionId: string,
  caseId: string,
  variant: 'thumb' | 'full',
): Promise<StoredImage | null> {
  if (!isUuid(caseId)) return null;
  const row = await openPortal(buyer, subscriptionId, (tx, entry) =>
    tx.assistantCase.findFirst({
      where: { ...ownCases(entry, buyer, subscriptionId), id: caseId, photoDeletedAt: null },
      select: { storageKey: true, thumbKey: true },
    }),
  );
  if (!row) return null;
  try {
    return await readStoredImage(
      variant === 'thumb' ? row.thumbKey : row.storageKey,
      'image/jpeg',
      'AssistantCase',
    );
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

// -----------------------------------------------------------------------------
// Scritture
// -----------------------------------------------------------------------------

export interface StartMyAssistantCaseInput {
  /** La lingua di chi chiede (la risposta arriva in questa lingua). */
  readonly locale: SupportedLocale;
  /** La pianta del contratto, se la persona la sceglie. */
  readonly plantId?: string | null;
}

/**
 * «Analizar foto»: riconosce la pianta della foto (fino a 3 specie della lista, ciò che si vede, se
 * sembra avere un problema) e apre il caso. Serve almeno un credito, ma non si usa: lo usa la
 * prima risposta.
 */
export async function startMyAssistantCase(
  buyer: BuyerContext,
  subscriptionId: string,
  input: StartMyAssistantCaseInput,
  photo: Uint8Array,
): Promise<MyAssistantCaseDto> {
  const assistant = requireAssistants().main;
  const plantId = input.plantId || null;
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  if (plantId !== null && !isUuid(plantId)) throw new NotFoundError('CarePlant');

  const checked = await openPortal(buyer, subscriptionId, async (tx, entry) => {
    const status = await contractStatusTx(tx, entry, subscriptionId);
    if (!isOpen(entry, status)) throw new ConflictError('assistant_contract_closed');
    const credits = await portalCreditsTx(tx, entry.shop.timezone);
    if (creditsDto(credits).remaining < ASSISTANT_CREDITS.perAnswer) {
      throw new ConflictError('assistant_no_credits');
    }
    if (credits.cases_since >= ASSISTANT_LIMITS.contractCasesPerDay) {
      throw new ConflictError('assistant_daily_limit');
    }
    let recordSlug: string | null = null;
    if (plantId !== null) {
      const plant = await tx.carePlant.findFirst({
        where: { tenantId: entry.tenantId, subscriptionId, id: plantId, status: 'ACTIVE' },
        select: { species: { select: { slug: true, category: true } } },
      });
      if (!plant) throw new NotFoundError('CarePlant');
      recordSlug = plant.species?.category === 'PLANT' ? plant.species.slug : null;
    }
    await assertBudgetTx(tx, assistant.model);
    const species = await plantSpeciesTx(tx);
    return { tenantId: entry.tenantId, customerId: entry.customerId, recordSlug, species };
  });
  if (!checked) throw new NotFoundError('CustomerSubscription');
  const { tenantId } = checked;

  // La foto: validata e senza EXIF; al modello una copia più piccola.
  const image = await normalizeUploadedPhoto(photo);
  const forModel = await downscaleForModel(image.full.bytes, ASSISTANT_LIMITS.modelImageSide);
  // La lista per il modello è sempre in es-MX: uguale per tutti, così il sistema va in cache.
  const promptSpecies: AssistantSpecies[] = checked.species.map((row: FlowerRow) => ({
    slug: row.slug,
    name: nameIn(row.names, 'es-MX'),
    scientificName: row.scientificName,
  }));
  const result = await withTimeout((signal) =>
    assistant.recognize(
      {
        image: { bytes: forModel.bytes, contentType: 'image/jpeg' },
        species: promptSpecies,
        locale: input.locale,
        recordSlug: checked.recordSlug,
      },
      signal,
    ),
  );
  const call = (caseId: string | null): AssistantCallInput => ({
    tenantId,
    caseId,
    kind: 'RECOGNIZE',
    model: assistant.model,
    result,
  });
  if (result.outcome !== 'ok' || !result.value) {
    await settleFailedCall(buyer, subscriptionId, call(null), null);
    throw new ConflictError('assistant_failed');
  }
  const recognition = cleanRecognition(
    result.value,
    new Set(checked.species.map((row) => row.slug)),
  );

  const caseId = newId();
  const keys = assistantPhotoKeys(tenantId, subscriptionId, caseId);
  let saved: MyAssistantCaseDto | null;
  try {
    saved = await storeFilesThenCommit(
      [
        { key: keys.storageKey, bytes: image.full.bytes, contentType: image.full.contentType },
        { key: keys.thumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
      ],
      () =>
        openPortal(buyer, subscriptionId, async (tx, entry) => {
          if (entry.tenantId !== tenantId) return null;
          await tx.assistantCase.create({
            data: {
              id: caseId,
              tenantId,
              customerId: entry.customerId,
              subscriptionId,
              plantId,
              channel: 'PORTAL',
              askedByUserId: buyer.userId,
              photoUsable: recognition.photoUsable,
              candidates: recognition.candidates.map((candidate) => ({ ...candidate })),
              notInList: recognition.notInList,
              condition: recognition.condition,
              looksUnhealthy: recognition.looksUnhealthy,
              storageKey: keys.storageKey,
              thumbKey: keys.thumbKey,
            },
            select: { id: true },
          });
          await tx.assistantCall.createMany({ data: [callRow(call(caseId))] });
          return myCaseDtoTx(tx, entry, buyer, subscriptionId, caseId, input.locale);
        }),
    );
  } catch (error) {
    // La policy del portale rifiuta: il contratto si è chiuso nel frattempo.
    if (isRlsViolation(error)) {
      await settleFailedCall(buyer, subscriptionId, call(null), null);
      throw new ConflictError('assistant_contract_closed');
    }
    throw error;
  }
  if (!saved) throw new NotFoundError('CustomerSubscription');
  return saved;
}

/**
 * Una domanda su un proprio caso: la risposta breve con la specie confermata (o «No sé»), i nostri
 * dati di cura e la scheda della pianta. Usa 1 credito solo se riesce.
 */
export async function answerMyAssistantCase(
  buyer: BuyerContext,
  subscriptionId: string,
  caseId: string,
  locale: SupportedLocale,
  rawInput: unknown,
): Promise<MyAssistantCaseDto> {
  const assistants = requireAssistants();
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  if (!isUuid(caseId)) throw new NotFoundError('AssistantCase');
  const parsed = assistantQuestionSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;
  const assistant = assistantAnswerModel(assistants, input.kind);

  const prepared = await openPortal(buyer, subscriptionId, async (tx, entry) => {
    const status = await contractStatusTx(tx, entry, subscriptionId);
    const found = await tx.assistantCase.findFirst({
      where: { ...ownCases(entry, buyer, subscriptionId), id: caseId },
      select: {
        photoUsable: true,
        condition: true,
        plant: {
          select: { size: true, location: true, light: true, watering: true, instructions: true },
        },
        answers: { orderBy: { createdAt: 'asc' }, select: { question: true, answer: true } },
      },
    });
    if (!found) throw new NotFoundError('AssistantCase');
    if (!isOpen(entry, status)) throw new ConflictError('assistant_contract_closed');
    if (!found.photoUsable) throw new ConflictError('assistant_photo_unusable');
    if (found.answers.length >= ASSISTANT_LIMITS.answersPerCase) {
      throw new ConflictError('assistant_case_full');
    }
    const credits = await portalCreditsTx(tx, entry.shop.timezone);
    if (credits.answers_since >= ASSISTANT_LIMITS.contractAnswersPerDay) {
      throw new ConflictError('assistant_daily_limit');
    }
    let species: FlowerRow | null = null;
    if (input.speciesSlug !== null) {
      species = await tx.canonicalFlower.findFirst({
        where: { slug: input.speciesSlug, category: 'PLANT' },
        select: FLOWER_SELECT,
      });
      if (!species) throw new ValidationError({ speciesSlug: 'invalid' });
    }
    await assertBudgetTx(tx, assistant.model);
    // Ultima: la riserva del credito (sotto lock del contratto). Se qualcosa sopra fallisce, la
    // transazione si annulla e la riserva con lei.
    const rows = await tx.$queryRaw<{ hold: string | null }[]>`
      SELECT app_portal_assistant_reserve(${ASSISTANT_CREDITS.holdSeconds}::integer) AS hold`;
    const hold = rows[0]?.hold ?? null;
    if (!hold) throw new ConflictError('assistant_no_credits');
    return { tenantId: entry.tenantId, found, species, hold };
  });
  if (!prepared) throw new NotFoundError('CustomerSubscription');
  const { tenantId, found, species, hold } = prepared;

  const result = await withTimeout((signal) =>
    assistant.answer(
      {
        locale,
        kind: input.kind,
        species: species
          ? {
              slug: species.slug,
              name: nameIn(species.names, locale),
              scientificName: species.scientificName,
              care: parsePlantCare(species.care),
            }
          : null,
        plant: found.plant,
        condition: found.condition,
        previous: found.answers,
        question: input.question,
      },
      signal,
    ),
  );
  const answer = result.outcome === 'ok' && result.value ? cleanAnswer(result.value) : null;
  const call: AssistantCallInput = {
    tenantId,
    caseId,
    kind: 'ANSWER',
    model: assistant.model,
    result:
      result.outcome === 'ok' && (!answer || answer.answer === '')
        ? { ...result, outcome: 'error', errorCode: 'empty_answer' }
        : result,
  };
  if (!answer || answer.answer === '') {
    await settleFailedCall(buyer, subscriptionId, call, hold);
    throw new ConflictError('assistant_failed');
  }

  let saved: MyAssistantCaseDto | null;
  try {
    saved = await openPortal(buyer, subscriptionId, async (tx, entry) => {
      if (entry.tenantId !== tenantId) return null;
      await tx.assistantAnswer.create({
        data: {
          tenantId,
          caseId,
          subscriptionId,
          channel: 'PORTAL',
          askedByUserId: buyer.userId,
          speciesId: species?.id ?? null,
          kind: input.kind,
          question: input.question,
          answer: answer.answer,
          steps: [...answer.steps],
          unsure: answer.unsure,
          askFlorist: answer.askFlorist,
        },
        select: { id: true },
      });
      await tx.assistantCall.createMany({ data: [callRow(call)] });
      // La risposta usa il credito: la riserva si toglie nella stessa transazione.
      await tx.$queryRaw`SELECT app_portal_assistant_release(${hold}::uuid) AS ok`;
      return myCaseDtoTx(tx, entry, buyer, subscriptionId, caseId, locale);
    });
  } catch (error) {
    // La policy del portale rifiuta: il contratto si è chiuso nel frattempo (il credito torna).
    if (isRlsViolation(error)) {
      await settleFailedCall(buyer, subscriptionId, call, hold);
      throw new ConflictError('assistant_contract_closed');
    }
    throw error;
  }
  if (!saved) {
    // L'accesso è stato tolto nel frattempo: la riserva scade da sola fra pochi minuti.
    logger.warn(
      { tenantId, subscriptionId, caseId, costMicros: result.costMicros },
      'risposta dell’Asistente de plantas non salvata: accesso tolto',
    );
    throw new NotFoundError('CustomerSubscription');
  }
  return saved;
}

// -----------------------------------------------------------------------------
// «Enviar a la florería» e «Pedir más consultas» (messaggi del filo, blocco 5b)
// -----------------------------------------------------------------------------

interface ShareCopy {
  readonly title: string;
  readonly plant: (name: string) => string;
  readonly species: (name: string, scientificName: string) => string;
  readonly speciesUnknown: string;
  readonly seen: (condition: string) => string;
  readonly question: (text: string) => string;
  readonly answer: (text: string) => string;
  readonly ai: string;
  /** «Pedir consultas»: la fioreria non ne ha ancora date. */
  readonly firstCredits: string;
  /** «Pedir más consultas»: finite quelle date. */
  readonly moreCredits: string;
}

const SHARE_COPY: Record<SupportedLocale, ShareCopy> = {
  'es-MX': {
    title: 'Consulta al Asistente de plantas',
    plant: (name) => `Planta: ${name}`,
    species: (name, scientificName) => `Especie: ${name} (${scientificName})`,
    speciesUnknown: 'Especie: no la sé',
    seen: (condition) => `En la foto: ${condition}`,
    question: (text) => `Pregunta: ${text}`,
    answer: (text) => `Respuesta del asistente: ${text}`,
    ai: 'Respuesta generada con IA.',
    firstCredits:
      'Hola, me interesa el Asistente de plantas para este servicio. ¿Me puedes dar consultas?',
    moreCredits:
      'Hola, ya usé las consultas del Asistente de plantas de este servicio. ¿Me puedes dar más?',
  },
  'it-IT': {
    title: 'Domanda all’assistente delle piante',
    plant: (name) => `Pianta: ${name}`,
    species: (name, scientificName) => `Specie: ${name} (${scientificName})`,
    speciesUnknown: 'Specie: non la so',
    seen: (condition) => `Nella foto: ${condition}`,
    question: (text) => `Domanda: ${text}`,
    answer: (text) => `Risposta dell’assistente: ${text}`,
    ai: 'Risposta generata con l’IA.',
    firstCredits:
      'Ciao, mi interessa l’assistente delle piante per questo servizio. Mi puoi dare delle domande?',
    moreCredits:
      'Ciao, ho usato le domande dell’assistente delle piante di questo servizio. Me ne puoi dare altre?',
  },
  'en-US': {
    title: 'Question for the plant assistant',
    plant: (name) => `Plant: ${name}`,
    species: (name, scientificName) => `Species: ${name} (${scientificName})`,
    speciesUnknown: 'Species: I don’t know',
    seen: (condition) => `In the photo: ${condition}`,
    question: (text) => `Question: ${text}`,
    answer: (text) => `Assistant’s answer: ${text}`,
    ai: 'AI-generated answer.',
    firstCredits:
      'Hi, I’m interested in the plant assistant for this service. Can you give me some questions?',
    moreCredits:
      'Hi, I’ve used the plant assistant questions for this service. Can you give me more?',
  },
};

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Il testo del messaggio di «Enviar a la florería»: pianta, specie, foto, domande e risposte. */
function shareBody(
  copy: ShareCopy,
  item: {
    readonly plantName: string | null;
    readonly condition: string;
    readonly answers: readonly {
      readonly question: string;
      readonly answer: string;
      readonly steps: readonly string[];
      readonly species: { readonly name: string; readonly scientificName: string } | null;
    }[];
  },
): string {
  const lines: string[] = [copy.title];
  if (item.plantName) lines.push(copy.plant(item.plantName));
  if (item.condition) lines.push(copy.seen(item.condition));
  let speciesLine: string | null = null;
  for (const answer of item.answers) {
    lines.push('');
    const next = answer.species
      ? copy.species(answer.species.name, answer.species.scientificName)
      : copy.speciesUnknown;
    if (next !== speciesLine) lines.push(next);
    speciesLine = next;
    lines.push(copy.question(answer.question), copy.answer(answer.answer));
    for (const [index, step] of answer.steps.entries()) lines.push(`${index + 1}. ${step}`);
  }
  lines.push('', copy.ai);
  return clip(lines.join('\n'), CARE_MESSAGE_LIMITS.body);
}

/**
 * «Enviar a la florería»: un messaggio della persona nel filo del contratto con la foto del caso e
 * il riassunto (specie, domande, risposte). Lo stesso caso con le stesse risposte si manda una
 * volta sola (chiave d'invio calcolata): mandato di nuovo dopo un'altra domanda, è un messaggio nuovo.
 */
export async function sendMyAssistantCaseToShop(
  buyer: BuyerContext,
  subscriptionId: string,
  caseId: string,
  locale: SupportedLocale,
): Promise<MyCareMessagePostResult> {
  if (!isUuid(caseId)) throw new NotFoundError('AssistantCase');
  const found = await openPortal(buyer, subscriptionId, (tx, entry) =>
    tx.assistantCase.findFirst({
      where: { ...ownCases(entry, buyer, subscriptionId), id: caseId },
      select: {
        storageKey: true,
        photoDeletedAt: true,
        condition: true,
        plant: { select: { name: true } },
        answers: {
          orderBy: { createdAt: 'asc' },
          select: {
            question: true,
            answer: true,
            steps: true,
            species: { select: { names: true, scientificName: true } },
          },
        },
      },
    }),
  );
  if (!found) throw new NotFoundError('AssistantCase');
  if (found.answers.length === 0) throw new ConflictError('assistant_nothing_to_send');
  const body = shareBody(SHARE_COPY[locale], {
    plantName: found.plant?.name ?? null,
    condition: found.condition,
    answers: found.answers.map((answer) => ({
      question: answer.question,
      answer: answer.answer,
      steps: stringList(answer.steps),
      species: answer.species
        ? {
            name: nameIn(answer.species.names, locale),
            scientificName: answer.species.scientificName,
          }
        : null,
    })),
  });
  // La foto del caso va nel messaggio come copia nuova (chiavi sue): le due si cancellano da sole.
  let photo: Uint8Array | null = null;
  if (found.photoDeletedAt === null) {
    try {
      photo = (await readStoredImage(found.storageKey, 'image/jpeg', 'AssistantCase')).bytes;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return postMyCareMessage(
    buyer,
    subscriptionId,
    {
      body,
      submitKey: uuidFromSeed(`assistant-share:${caseId}:${found.answers.length}`),
    },
    photo,
  );
}

/**
 * «Pedir consultas» / «Pedir más consultas» (senza crediti): un messaggio della persona alla
 * fioreria. Una volta al giorno per persona e contratto (chiave d'invio calcolata); il resto si
 * scrive nel filo.
 */
export async function askMyShopForAssistantCredits(
  buyer: BuyerContext,
  subscriptionId: string,
  locale: SupportedLocale,
): Promise<MyCareMessagePostResult> {
  const found = await openPortal(buyer, subscriptionId, async (tx, entry) => ({
    timezone: entry.shop.timezone,
    credits: await portalCreditsTx(tx, entry.shop.timezone),
  }));
  if (!found) throw new NotFoundError('CustomerSubscription');
  const day = toIsoDate(todayInTimeZone(found.timezone));
  const copy = SHARE_COPY[locale];
  return postMyCareMessage(
    buyer,
    subscriptionId,
    {
      body: found.credits.allocated > 0 ? copy.moreCredits : copy.firstCredits,
      submitKey: uuidFromSeed(`assistant-more:${subscriptionId}:${buyer.userId}:${day}`),
    },
    null,
  );
}
