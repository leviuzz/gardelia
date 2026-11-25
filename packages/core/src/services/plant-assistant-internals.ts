/**
 * Asistente de plantas (ADR-085): aiuti condivisi fra il lato della fioreria (crediti) e quello del
 * cliente (Mi Floral Care). Niente permessi qui: li controllano i servizi che li usano.
 */
import type { TransactionClient } from '@floral/db';
import {
  ASSISTANT_LIMITS,
  ASSISTANT_PROMPT_VERSION,
  assistantEstimatedCostMicros,
  newId,
  parsePlantCare,
  type AssistantLikelihood,
  type AssistantModel,
  type PlantCare,
  type SupportedLocale,
} from '@floral/domain';
import {
  assistantMonthlyBudgetMicros,
  getPlantAssistants,
  type AssistantCallResult,
  type PlantAssistants,
} from '../ai/plant-assistant';
import { ConflictError } from '../errors';

type Names = Partial<Record<SupportedLocale, string>>;

export function nameIn(names: unknown, locale: SupportedLocale): string {
  const value = (names ?? {}) as Names;
  return value[locale] ?? value['es-MX'] ?? '';
}

export interface AssistantSpeciesDto {
  readonly slug: string;
  /** Nel linguaggio di chi guarda. */
  readonly name: string;
  readonly scientificName: string;
  /** Luce, acqua, umidità e tossicità dai nostri dati (null se mancano). */
  readonly care: PlantCare | null;
}

export interface FlowerRow {
  readonly id: string;
  readonly slug: string;
  readonly scientificName: string;
  readonly names: unknown;
  readonly care: unknown;
}

export const FLOWER_SELECT = {
  id: true,
  slug: true,
  scientificName: true,
  names: true,
  care: true,
} as const;

export function speciesDto(row: FlowerRow, locale: SupportedLocale): AssistantSpeciesDto {
  return {
    slug: row.slug,
    name: nameIn(row.names, locale),
    scientificName: row.scientificName,
    care: parsePlantCare(row.care),
  };
}

/** Le piante in vaso della lista (la tassonomia è globale: la legge chiunque). */
export async function plantSpeciesTx(tx: TransactionClient): Promise<readonly FlowerRow[]> {
  return tx.canonicalFlower.findMany({
    where: { category: 'PLANT' },
    orderBy: { slug: 'asc' },
    select: FLOWER_SELECT,
  });
}

/** Gli assistenti configurati; senza, l'interfaccia non mostra l'assistente (niente finti). */
export function requireAssistants(): PlantAssistants {
  const assistants = getPlantAssistants();
  if (!assistants) throw new ConflictError('assistant_unavailable');
  return assistants;
}

function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Il budget mensile di piattaforma (rete di sicurezza, tutte le fiorerie). */
export async function assertBudgetTx(tx: TransactionClient, model: AssistantModel): Promise<void> {
  const rows = await tx.$queryRaw<{ spent: bigint | number | null }[]>`
    SELECT app_assistant_spend_since(${monthStartUtc()}) AS spent`;
  const spent = Number(rows[0]?.spent ?? 0);
  if (spent + assistantEstimatedCostMicros(model) > assistantMonthlyBudgetMicros()) {
    throw new ConflictError('assistant_budget_reached');
  }
}

export async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // Un margine oltre il timeout dell'SDK: si ferma comunque, anche se l'SDK non risponde.
  return work(AbortSignal.timeout(ASSISTANT_LIMITS.timeoutMs + 5_000));
}

export interface AssistantCallInput {
  readonly tenantId: string;
  readonly caseId: string | null;
  readonly kind: 'RECOGNIZE' | 'ANSWER';
  readonly model: AssistantModel;
  readonly result: AssistantCallResult<unknown>;
}

/** La riga di una chiamata al modello: esito, token e costo vero (va nel budget). */
export function callRow(input: AssistantCallInput) {
  const { result } = input;
  const status =
    result.outcome === 'ok' ? 'SUCCEEDED' : result.outcome === 'refused' ? 'REFUSED' : 'FAILED';
  return {
    id: newId(),
    tenantId: input.tenantId,
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

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function candidateList(value: unknown): { slug: string; likelihood: AssistantLikelihood }[] {
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

/** Le chiavi della foto di un caso: nella cartella delle foto del contratto (si cancellano con loro). */
export function assistantPhotoKeys(
  tenantId: string,
  subscriptionId: string,
  caseId: string,
): { readonly storageKey: string; readonly thumbKey: string } {
  const base = `tenants/${tenantId}/care-photos/${subscriptionId}-assistant-${caseId}`;
  return { storageKey: `${base}.jpg`, thumbKey: `${base}-thumb.jpg` };
}
