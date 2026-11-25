/**
 * Floral Care, blocco 6a (ADR-085) — l'Asistente de plantas della fioreria.
 *
 *  - Una foto di una pianta di un contratto → fino a 3 specie della nostra lista e ciò che si vede
 *    (il "caso"); poi una domanda → una risposta breve (la "consulta"), fino a 3 per caso.
 *  - Tutta la squadra lo usa (`care:assistant`), staff compreso; le consultas le paga Gardelia
 *    nella fase di prova, con un tetto al giorno per fioreria e un budget mensile della piattaforma.
 *  - Le chiamate al modello avvengono FUORI dalle transazioni: prima i controlli (limiti, budget),
 *    poi la chiamata, poi una transazione che scrive il risultato e la chiamata con il costo vero.
 *    Due richieste nello stesso istante possono superare un tetto di una consulta: è voluto, il
 *    costo di una consulta è di pochi centesimi.
 *  - Un errore o un rifiuto del modello non crea consultas: si registra solo la chiamata (si paga).
 *  - La tossicità per cani e gatti viene dai nostri dati (`CanonicalFlower.care`), mai dal modello.
 *  - La foto segue le foto delle visite: stessa cartella, cancellata 30 giorni dopo la fine del
 *    contratto; il testo resta.
 */
import { getDb, withTenantContext, type TransactionClient } from '@floral/db';
import {
  ASSISTANT_LIMITS,
  ASSISTANT_PROMPT_VERSION,
  AUDIT_ACTIONS,
  assistantDayStart,
  assistantEstimatedCostMicros,
  assistantQuestionSchema,
  cleanAnswer,
  cleanRecognition,
  formatSubscriptionNumber,
  isUuid,
  newId,
  parsePlantCare,
  toFieldErrors,
  type AssistantLikelihood,
  type AssistantModel,
  type AssistantSpecies,
  type PlantCare,
  type SupportedLocale,
} from '@floral/domain';
import {
  assistantMonthlyBudgetMicros,
  getPlantAssistant,
  type AssistantCallResult,
  type PlantAssistant,
} from '../ai/plant-assistant';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { downscaleForModel, normalizeUploadedPhoto } from '../media/images';
import { readStoredImage, storeFilesThenCommit, type StoredImage } from '../media/stored-files';
import { requireEntitlement } from './billing';
import type { PhotoVariant } from './catalog-photos';

// -----------------------------------------------------------------------------
// DTO
// -----------------------------------------------------------------------------

export interface AssistantSpeciesDto {
  readonly slug: string;
  /** Nel linguaggio di chi guarda. */
  readonly name: string;
  readonly scientificName: string;
  /** Luce, acqua, umidità e tossicità dai nostri dati (null se mancano). */
  readonly care: PlantCare | null;
}

export interface AssistantAnswerDto {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly steps: readonly string[];
  readonly unsure: boolean;
  readonly askFlorist: boolean;
  /** La specie confermata (null = «No sé»), con l'avviso di tossicità dai nostri dati. */
  readonly species: AssistantSpeciesDto | null;
  readonly askedByName: string | null;
  readonly createdAt: Date;
}

export interface AssistantCaseDto {
  readonly id: string;
  readonly subscriptionId: string;
  readonly numberLabel: string;
  readonly customerName: string;
  readonly plantId: string | null;
  readonly plantName: string | null;
  readonly visitId: string | null;
  readonly photoUsable: boolean;
  readonly notInList: boolean;
  /** Ciò che si vede nella foto, scritto dal modello. */
  readonly condition: string;
  readonly candidates: readonly (AssistantSpeciesDto & {
    readonly likelihood: AssistantLikelihood;
  })[];
  /** La specie della scheda della pianta, da proporre per prima se c'è. */
  readonly recordSpeciesSlug: string | null;
  /** La foto si vede ancora (si cancella 30 giorni dopo la fine del contratto). */
  readonly photoAvailable: boolean;
  readonly answers: readonly AssistantAnswerDto[];
  /** Si può fare un'altra domanda (foto utile, meno di 3 risposte). */
  readonly canAsk: boolean;
  readonly askedByName: string | null;
  readonly createdAt: Date;
}

export interface AssistantCaseSummaryDto {
  readonly id: string;
  readonly plantName: string | null;
  /** La specie della prima risposta, altrimenti il primo candidato. */
  readonly speciesName: string | null;
  readonly firstQuestion: string | null;
  readonly answers: number;
  readonly createdAt: Date;
}

export interface AssistantPanelDto {
  /** L'assistente è configurato (altrimenti l'interfaccia non mostra i link). */
  readonly available: boolean;
  /** Assistente finto di sviluppo e test: l'interfaccia lo dice. */
  readonly simulated: boolean;
  readonly usedToday: number;
  readonly dailyLimit: number;
  /** Tutte le piante della lista, per «Otra». */
  readonly species: readonly AssistantSpeciesDto[];
}

// -----------------------------------------------------------------------------
// Aiuti
// -----------------------------------------------------------------------------

type Names = Partial<Record<SupportedLocale, string>>;

function nameIn(names: unknown, locale: SupportedLocale): string {
  const value = (names ?? {}) as Names;
  return value[locale] ?? value['es-MX'] ?? '';
}

interface FlowerRow {
  readonly id: string;
  readonly slug: string;
  readonly scientificName: string;
  readonly names: unknown;
  readonly care: unknown;
}

function speciesDto(row: FlowerRow, locale: SupportedLocale): AssistantSpeciesDto {
  return {
    slug: row.slug,
    name: nameIn(row.names, locale),
    scientificName: row.scientificName,
    care: parsePlantCare(row.care),
  };
}

const FLOWER_SELECT = {
  id: true,
  slug: true,
  scientificName: true,
  names: true,
  care: true,
} as const;

/** Le piante in vaso della lista (la tassonomia è globale: la legge chiunque). */
async function plantSpeciesTx(tx: TransactionClient): Promise<readonly FlowerRow[]> {
  return tx.canonicalFlower.findMany({
    where: { category: 'PLANT' },
    orderBy: { slug: 'asc' },
    select: FLOWER_SELECT,
  });
}

function requireAssistant(): PlantAssistant {
  const assistant = getPlantAssistant();
  if (!assistant) throw new ConflictError('assistant_unavailable');
  return assistant;
}

function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Il budget mensile delle consultas pagate da Gardelia (tutte le fiorerie). */
async function assertBudgetTx(tx: TransactionClient, model: AssistantModel): Promise<void> {
  const rows = await tx.$queryRaw<{ spent: bigint | number | null }[]>`
    SELECT app_assistant_spend_since(${monthStartUtc()}) AS spent`;
  const spent = Number(rows[0]?.spent ?? 0);
  if (spent + assistantEstimatedCostMicros(model) > assistantMonthlyBudgetMicros()) {
    throw new ConflictError('assistant_budget_reached');
  }
}

/** Consultas e foto riconosciute oggi dalla squadra (giorno della fioreria). */
async function shopUsageTodayTx(
  tx: TransactionClient,
  ctx: TenantContext,
): Promise<{ readonly answers: number; readonly cases: number }> {
  const since = assistantDayStart(ctx.timezone);
  const answers = await tx.assistantAnswer.count({
    where: { tenantId: ctx.tenantId, channel: 'SHOP', createdAt: { gte: since } },
  });
  const cases = await tx.assistantCase.count({
    where: { tenantId: ctx.tenantId, channel: 'SHOP', createdAt: { gte: since } },
  });
  return { answers, cases };
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // Un margine oltre il timeout dell'SDK: si ferma comunque, anche se l'SDK non risponde.
  return work(AbortSignal.timeout(ASSISTANT_LIMITS.timeoutMs + 5_000));
}

function callRow(
  ctx: TenantContext,
  input: {
    readonly caseId: string | null;
    readonly kind: 'RECOGNIZE' | 'ANSWER';
    readonly model: AssistantModel;
    readonly result: AssistantCallResult<unknown>;
  },
) {
  const { result } = input;
  const status =
    result.outcome === 'ok' ? 'SUCCEEDED' : result.outcome === 'refused' ? 'REFUSED' : 'FAILED';
  return {
    id: newId(),
    tenantId: ctx.tenantId,
    caseId: input.caseId,
    kind: input.kind,
    status,
    model: input.model,
    servedModel: result.servedModel ? result.servedModel.slice(0, 60) : null,
    promptVersion: ASSISTANT_PROMPT_VERSION,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheCreationTokens: result.usage.cacheCreationTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    costMicros: result.costMicros,
    durationMs: Math.max(0, Math.round(result.durationMs)),
    stopReason: result.stopReason ? result.stopReason.slice(0, 40) : null,
    errorCode: status === 'SUCCEEDED' ? null : (result.errorCode ?? 'unexpected').slice(0, 60),
  } as const;
}

/** Una chiamata non riuscita: si registra (si paga lo stesso) e la consulta non si conta. */
async function recordFailedCall(
  ctx: TenantContext,
  input: {
    readonly caseId: string | null;
    readonly kind: 'RECOGNIZE' | 'ANSWER';
    readonly model: AssistantModel;
    readonly result: AssistantCallResult<unknown>;
  },
): Promise<never> {
  await withTenantContext(getDb(), ctx, (tx) =>
    tx.assistantCall.create({ data: callRow(ctx, input) }),
  );
  logger.warn(
    {
      tenantId: ctx.tenantId,
      caseId: input.caseId,
      kind: input.kind,
      model: input.model,
      code: input.result.errorCode,
      costMicros: input.result.costMicros,
    },
    'chiamata dell’Asistente de plantas non riuscita',
  );
  throw new ConflictError('assistant_failed');
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

/** Stato dell'assistente per la pagina: disponibile, consultas di oggi, piante della lista. */
export async function getAssistantPanel(ctx: TenantContext): Promise<AssistantPanelDto> {
  requirePermission(ctx, 'care:assistant');
  const assistant = getPlantAssistant();
  return withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const usage = await shopUsageTodayTx(tx, ctx);
    const species = await plantSpeciesTx(tx);
    return {
      available: assistant !== null,
      simulated: assistant?.simulated ?? false,
      usedToday: usage.answers,
      dailyLimit: ASSISTANT_LIMITS.shopAnswersPerDay,
      species: species
        .map((row) => speciesDto(row, ctx.locale))
        .sort((a, b) => a.name.localeCompare(b.name, ctx.locale)),
    };
  });
}

const CASE_SELECT = {
  id: true,
  subscriptionId: true,
  plantId: true,
  visitId: true,
  photoUsable: true,
  notInList: true,
  condition: true,
  candidates: true,
  photoDeletedAt: true,
  createdAt: true,
  askedBy: { select: { name: true } },
  subscription: { select: { number: true, customer: { select: { displayName: true } } } },
  plant: {
    select: { name: true, species: { select: { slug: true, category: true } } },
  },
  answers: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      question: true,
      answer: true,
      steps: true,
      unsure: true,
      askFlorist: true,
      createdAt: true,
      askedBy: { select: { name: true } },
      species: { select: FLOWER_SELECT },
    },
  },
} as const;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function candidateList(value: unknown): { slug: string; likelihood: AssistantLikelihood }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const candidate = item as { slug?: unknown; likelihood?: unknown };
    return typeof candidate.slug === 'string' &&
      (candidate.likelihood === 'high' ||
        candidate.likelihood === 'medium' ||
        candidate.likelihood === 'low')
      ? [{ slug: candidate.slug, likelihood: candidate.likelihood }]
      : [];
  });
}

async function caseDtoTx(
  tx: TransactionClient,
  ctx: TenantContext,
  caseId: string,
  subscriptionId?: string,
): Promise<AssistantCaseDto | null> {
  const row = await tx.assistantCase.findFirst({
    where: { tenantId: ctx.tenantId, id: caseId, ...(subscriptionId ? { subscriptionId } : {}) },
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
  return {
    id: row.id,
    subscriptionId: row.subscriptionId,
    numberLabel: formatSubscriptionNumber(row.subscription.number),
    customerName: row.subscription.customer.displayName,
    plantId: row.plantId,
    plantName: row.plant?.name ?? null,
    visitId: row.visitId,
    photoUsable: row.photoUsable,
    notInList: row.notInList,
    condition: row.condition,
    candidates: candidates.flatMap((candidate) => {
      const flower = bySlug.get(candidate.slug);
      return flower
        ? [{ ...speciesDto(flower, ctx.locale), likelihood: candidate.likelihood }]
        : [];
    }),
    recordSpeciesSlug: recordSpecies?.category === 'PLANT' ? recordSpecies.slug : null,
    photoAvailable: row.photoDeletedAt === null,
    answers: row.answers.map((answer) => ({
      id: answer.id,
      question: answer.question,
      answer: answer.answer,
      steps: stringList(answer.steps),
      unsure: answer.unsure,
      askFlorist: answer.askFlorist,
      species: answer.species ? speciesDto(answer.species, ctx.locale) : null,
      askedByName: answer.askedBy?.name ?? null,
      createdAt: answer.createdAt,
    })),
    canAsk: row.photoUsable && row.answers.length < ASSISTANT_LIMITS.answersPerCase,
    askedByName: row.askedBy?.name ?? null,
    createdAt: row.createdAt,
  };
}

/** Un caso della fioreria (con le risposte); 404 con la sonda se è di un'altra fioreria. */
export async function getAssistantCase(
  ctx: TenantContext,
  caseId: string,
  subscriptionId?: string,
): Promise<AssistantCaseDto> {
  requirePermission(ctx, 'care:assistant');
  if (!isUuid(caseId) || (subscriptionId !== undefined && !isUuid(subscriptionId))) {
    throw new NotFoundError('AssistantCase');
  }
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    return caseDtoTx(tx, ctx, caseId, subscriptionId);
  });
  if (!found) return notFound(ctx, 'AssistantCase', caseId);
  return found;
}

/** Le ultime consultas di un contratto (la card della pagina del contratto). */
export async function listAssistantCases(
  ctx: TenantContext,
  subscriptionId: string,
  limit = 5,
): Promise<readonly AssistantCaseSummaryDto[]> {
  requirePermission(ctx, 'care:assistant');
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  const take = Math.min(Math.max(Math.trunc(limit), 1), 20);
  const rows = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    return tx.assistantCase.findMany({
      where: { tenantId: ctx.tenantId, subscriptionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
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
    ? await withTenantContext(getDb(), ctx, (tx) =>
        tx.canonicalFlower.findMany({
          where: { slug: { in: slugs } },
          select: { slug: true, names: true },
        }),
      )
    : [];
  const nameOf = new Map(flowers.map((flower) => [flower.slug, nameIn(flower.names, ctx.locale)]));
  return rows.map((row) => {
    const first = row.answers[0];
    const candidate = candidateList(row.candidates)[0];
    return {
      id: row.id,
      plantName: row.plant?.name ?? null,
      speciesName: first?.species
        ? nameIn(first.species.names, ctx.locale)
        : candidate
          ? (nameOf.get(candidate.slug) ?? null)
          : null,
      firstQuestion: first?.question ?? null,
      answers: row.answers.length,
      createdAt: row.createdAt,
    };
  });
}

/** La foto di un caso (`thumb` = miniatura), finché non è cancellata. */
export async function getAssistantPhotoImage(
  ctx: TenantContext,
  caseId: string,
  variant: PhotoVariant,
): Promise<StoredImage> {
  requirePermission(ctx, 'care:assistant');
  if (!isUuid(caseId)) throw new NotFoundError('AssistantCase');
  const row = await withTenantContext(getDb(), ctx, (tx) =>
    tx.assistantCase.findFirst({
      where: { tenantId: ctx.tenantId, id: caseId, photoDeletedAt: null },
      select: { storageKey: true, thumbKey: true },
    }),
  );
  if (!row) return notFound(ctx, 'AssistantCase', caseId);
  return readStoredImage(
    variant === 'thumb' ? row.thumbKey : row.storageKey,
    'image/jpeg',
    'AssistantCase',
  );
}

// -----------------------------------------------------------------------------
// Scritture
// -----------------------------------------------------------------------------

export interface StartAssistantCaseInput {
  readonly subscriptionId: string;
  readonly plantId?: string | null;
  readonly visitId?: string | null;
}

/**
 * Riconosce la foto di una pianta di un contratto: crea il caso con le specie candidate e ciò che
 * si vede. Controlla contratto, pianta e visita della fioreria, il tetto del giorno e il budget.
 */
export async function startAssistantCase(
  ctx: TenantContext,
  input: StartAssistantCaseInput,
  photo: Uint8Array,
): Promise<AssistantCaseDto> {
  requirePermission(ctx, 'care:assistant');
  const assistant = requireAssistant();
  const { subscriptionId } = input;
  const plantId = input.plantId || null;
  const visitId = input.visitId || null;
  if (!isUuid(subscriptionId)) throw new NotFoundError('CustomerSubscription');
  if (plantId !== null && !isUuid(plantId)) throw new NotFoundError('CarePlant');
  if (visitId !== null && !isUuid(visitId)) throw new NotFoundError('CareVisit');

  const checked = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const contract = await tx.customerSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id: subscriptionId, kind: 'CARE' },
      select: { customerId: true },
    });
    if (!contract)
      return { ok: false as const, entity: 'CustomerSubscription' as const, id: subscriptionId };
    let recordSlug: string | null = null;
    if (plantId !== null) {
      const plant = await tx.carePlant.findFirst({
        where: { tenantId: ctx.tenantId, subscriptionId, id: plantId },
        select: { species: { select: { slug: true, category: true } } },
      });
      if (!plant) return { ok: false as const, entity: 'CarePlant' as const, id: plantId };
      recordSlug = plant.species?.category === 'PLANT' ? plant.species.slug : null;
    }
    if (visitId !== null) {
      const visit = await tx.careVisit.findFirst({
        where: { tenantId: ctx.tenantId, subscriptionId, id: visitId },
        select: { id: true },
      });
      if (!visit) return { ok: false as const, entity: 'CareVisit' as const, id: visitId };
    }
    const usage = await shopUsageTodayTx(tx, ctx);
    if (
      usage.cases >= ASSISTANT_LIMITS.shopCasesPerDay ||
      usage.answers >= ASSISTANT_LIMITS.shopAnswersPerDay
    ) {
      throw new ConflictError('assistant_daily_limit');
    }
    await assertBudgetTx(tx, assistant.model);
    const species = await plantSpeciesTx(tx);
    return { ok: true as const, customerId: contract.customerId, recordSlug, species };
  });
  if (!checked.ok) return notFound(ctx, checked.entity, checked.id);

  // La foto: validata e senza EXIF; al modello una copia più piccola.
  const image = await normalizeUploadedPhoto(photo);
  const forModel = await downscaleForModel(image.full.bytes, ASSISTANT_LIMITS.modelImageSide);
  // La lista per il modello è sempre in es-MX: uguale per tutti, così il sistema va in cache.
  const promptSpecies: AssistantSpecies[] = checked.species.map((row) => ({
    slug: row.slug,
    name: nameIn(row.names, 'es-MX'),
    scientificName: row.scientificName,
  }));
  const result = await withTimeout((signal) =>
    assistant.recognize(
      {
        image: { bytes: forModel.bytes, contentType: 'image/jpeg' },
        species: promptSpecies,
        locale: ctx.locale,
        recordSlug: checked.recordSlug,
      },
      signal,
    ),
  );
  if (result.outcome !== 'ok' || !result.value) {
    return recordFailedCall(ctx, {
      caseId: null,
      kind: 'RECOGNIZE',
      model: assistant.model,
      result,
    });
  }
  const recognition = cleanRecognition(
    result.value,
    new Set(checked.species.map((row) => row.slug)),
  );

  const caseId = newId();
  const storageKey = `tenants/${ctx.tenantId}/care-photos/${subscriptionId}-assistant-${caseId}.jpg`;
  const thumbKey = `tenants/${ctx.tenantId}/care-photos/${subscriptionId}-assistant-${caseId}-thumb.jpg`;
  const saved = await storeFilesThenCommit(
    [
      { key: storageKey, bytes: image.full.bytes, contentType: image.full.contentType },
      { key: thumbKey, bytes: image.thumb.bytes, contentType: image.thumb.contentType },
    ],
    () =>
      withTenantContext(getDb(), ctx, async (tx) => {
        await tx.assistantCase.create({
          data: {
            id: caseId,
            tenantId: ctx.tenantId,
            customerId: checked.customerId,
            subscriptionId,
            plantId,
            visitId,
            channel: 'SHOP',
            askedByUserId: ctx.userId,
            photoUsable: recognition.photoUsable,
            candidates: recognition.candidates.map((candidate) => ({ ...candidate })),
            notInList: recognition.notInList,
            condition: recognition.condition,
            storageKey,
            thumbKey,
          },
        });
        await tx.assistantCall.create({
          data: callRow(ctx, { caseId, kind: 'RECOGNIZE', model: assistant.model, result }),
        });
        return caseDtoTx(tx, ctx, caseId);
      }),
  );
  if (!saved) throw new NotFoundError('AssistantCase');
  return saved;
}

/**
 * Una domanda su un caso: la risposta breve del modello con la specie confermata (o «No sé»), i
 * nostri dati di cura e la scheda della pianta. È una consulta; un errore non si conta.
 */
export async function answerAssistantCase(
  ctx: TenantContext,
  caseId: string,
  rawInput: unknown,
): Promise<AssistantCaseDto> {
  requirePermission(ctx, 'care:assistant');
  const assistant = requireAssistant();
  if (!isUuid(caseId)) throw new NotFoundError('AssistantCase');
  const parsed = assistantQuestionSchema.safeParse(rawInput);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const input = parsed.data;

  const prepared = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const found = await tx.assistantCase.findFirst({
      where: { tenantId: ctx.tenantId, id: caseId },
      select: {
        subscriptionId: true,
        photoUsable: true,
        condition: true,
        subscription: { select: { number: true } },
        plant: {
          select: { size: true, location: true, light: true, watering: true, instructions: true },
        },
        answers: { orderBy: { createdAt: 'asc' }, select: { question: true, answer: true } },
      },
    });
    if (!found) return null;
    if (!found.photoUsable) throw new ConflictError('assistant_photo_unusable');
    if (found.answers.length >= ASSISTANT_LIMITS.answersPerCase) {
      throw new ConflictError('assistant_case_full');
    }
    const usage = await shopUsageTodayTx(tx, ctx);
    if (usage.answers >= ASSISTANT_LIMITS.shopAnswersPerDay) {
      throw new ConflictError('assistant_daily_limit');
    }
    await assertBudgetTx(tx, assistant.model);
    let species: FlowerRow | null = null;
    if (input.speciesSlug !== null) {
      species = await tx.canonicalFlower.findFirst({
        where: { slug: input.speciesSlug, category: 'PLANT' },
        select: FLOWER_SELECT,
      });
      if (!species) throw new ValidationError({ speciesSlug: 'invalid' });
    }
    return { found, species };
  });
  if (!prepared) return notFound(ctx, 'AssistantCase', caseId);
  const { found, species } = prepared;

  const result = await withTimeout((signal) =>
    assistant.answer(
      {
        locale: ctx.locale,
        species: species
          ? {
              slug: species.slug,
              name: nameIn(species.names, ctx.locale),
              scientificName: species.scientificName,
              care: parsePlantCare(species.care),
            }
          : null,
        plant: found.plant
          ? {
              size: found.plant.size,
              location: found.plant.location,
              light: found.plant.light,
              watering: found.plant.watering,
              instructions: found.plant.instructions,
            }
          : null,
        condition: found.condition,
        previous: found.answers,
        question: input.question,
      },
      signal,
    ),
  );
  const answer = result.outcome === 'ok' && result.value ? cleanAnswer(result.value) : null;
  if (!answer || answer.answer === '') {
    return recordFailedCall(ctx, {
      caseId,
      kind: 'ANSWER',
      model: assistant.model,
      result:
        result.outcome === 'ok'
          ? { ...result, outcome: 'error', errorCode: 'empty_answer' }
          : result,
    });
  }

  const answerId = newId();
  const saved = await withTenantContext(getDb(), ctx, async (tx) => {
    await tx.assistantAnswer.create({
      data: {
        id: answerId,
        tenantId: ctx.tenantId,
        caseId,
        subscriptionId: found.subscriptionId,
        channel: 'SHOP',
        askedByUserId: ctx.userId,
        speciesId: species?.id ?? null,
        question: input.question,
        answer: answer.answer,
        steps: [...answer.steps],
        unsure: answer.unsure,
        askFlorist: answer.askFlorist,
      },
    });
    await tx.assistantCall.create({
      data: callRow(ctx, { caseId, kind: 'ANSWER', model: assistant.model, result }),
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.careAssistantAnswered,
      entityType: 'CustomerSubscription',
      entityId: found.subscriptionId,
      metadata: {
        number: formatSubscriptionNumber(found.subscription.number),
        caseId,
        answerId,
        model: result.servedModel ?? assistant.model,
        costMicros: result.costMicros,
      },
    });
    return caseDtoTx(tx, ctx, caseId);
  });
  if (!saved) throw new NotFoundError('AssistantCase');
  return saved;
}
