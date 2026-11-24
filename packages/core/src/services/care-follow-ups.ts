/**
 * Avvisi della squadra per chi gestisce (ADR-078): una pianta morta da reponer (creato anche da
 * solo a "Terminar visita"), un lavoro extra chiesto dal cliente, altro. Li scrive chi fa la
 * visita (`care:visit`, anche lo staff); li vede tutta la squadra e li risolve solo chi gestisce i
 * contratti (blocco 2b): una pianta morta con una reposición sin costo (visita extra), alla
 * prossima visita, con una cotización o "no se repone"; gli altri "Atendido" o con una
 * cotización. Non si cancellano mai.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  careFollowUpResolutions,
  careFollowUpResolveSchema,
  formatQuoteNumber,
  formatSubscriptionNumber,
  isUuid,
  suggestedCareReplacement,
  toFieldErrors,
  type CareFollowUpKind,
  type CareFollowUpResolution,
  type CareFollowUpStatus,
  type DeadPlantPolicy,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { hasPermission, requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { requireEntitlement } from './billing';
import { isoOf, loadCareSettings } from './care-internals';

export interface CareFollowUpDto {
  readonly id: string;
  readonly kind: CareFollowUpKind;
  readonly status: CareFollowUpStatus;
  readonly plantName: string | null;
  readonly quantity: number | null;
  readonly note: string | null;
  readonly resolutionNote: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly visitId: string;
  /** Giorno della visita da cui è nato ("AAAA-MM-GG"). */
  readonly visitDate: string | null;
  readonly subscriptionId: string;
  readonly numberLabel: string;
  readonly customerName: string;
  /** Come si è risolto (blocco 2b); null se è aperto. */
  readonly resolution: CareFollowUpResolution | null;
  /** La cotización che l'ha risolto ("Cotizar"). */
  readonly quote: { readonly id: string; readonly numberLabel: string } | null;
  /** La visita extra che l'ha risolto ("Reposición sin costo"). */
  readonly extraVisit: { readonly id: string; readonly date: string | null } | null;
  /** Le scelte per risolverlo; vuote se è già risolto. */
  readonly choices: readonly CareFollowUpResolution[];
  /** Per una pianta morta, la scelta che suggerisce la regola della fioreria. */
  readonly suggested: CareFollowUpResolution | null;
}

export const followUpSelect = {
  id: true,
  kind: true,
  status: true,
  quantity: true,
  note: true,
  resolutionNote: true,
  resolution: true,
  createdAt: true,
  resolvedAt: true,
  visitId: true,
  subscriptionId: true,
  quote: { select: { id: true, number: true } },
  extraVisit: { select: { id: true, scheduledDate: true } },
  plant: { select: { name: true } },
  visit: { select: { scheduledDate: true } },
  subscription: {
    select: { number: true, deadPlantPolicy: true, customer: { select: { displayName: true } } },
  },
} satisfies Prisma.CareFollowUpSelect;

type FollowUpRow = Prisma.CareFollowUpGetPayload<{ select: typeof followUpSelect }>;

/**
 * `policy`: la regola della fioreria sulle piante morte, se c'è l'offerta. Vale quella copiata nel
 * contratto alla conferma (ADR-079), se c'è: è quella firmata con il cliente.
 */
export function toFollowUpDto(row: FollowUpRow, fallback: DeadPlantPolicy | null): CareFollowUpDto {
  const open = row.status === 'OPEN';
  const policy = row.subscription.deadPlantPolicy ?? fallback;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    plantName: row.plant?.name ?? null,
    quantity: row.quantity,
    note: row.note,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    visitId: row.visitId,
    visitDate: isoOf(row.visit.scheduledDate),
    subscriptionId: row.subscriptionId,
    numberLabel: formatSubscriptionNumber(row.subscription.number),
    customerName: row.subscription.customer.displayName,
    resolution: row.resolution,
    quote: row.quote
      ? { id: row.quote.id, numberLabel: formatQuoteNumber(row.quote.number) }
      : null,
    extraVisit: row.extraVisit
      ? { id: row.extraVisit.id, date: isoOf(row.extraVisit.scheduledDate) }
      : null,
    choices: open ? careFollowUpResolutions(row.kind) : [],
    suggested:
      open && row.kind === 'REPLACEMENT' && policy ? suggestedCareReplacement(policy) : null,
  };
}

export interface CareFollowUpListDto {
  readonly items: readonly CareFollowUpDto[];
  /** Chi guarda può risolverli. */
  readonly canResolve: boolean;
  /** Chi guarda può anche crearne la cotización. */
  readonly canQuote: boolean;
}

/** Gli avvisi aperti (i più vecchi prima) o gli ultimi attesi. */
export async function listCareFollowUps(
  ctx: TenantContext,
  rawStatus: unknown,
): Promise<CareFollowUpListDto> {
  requirePermission(ctx, 'subscriptions:read');
  const status: CareFollowUpStatus = rawStatus === 'RESOLVED' ? 'RESOLVED' : 'OPEN';
  const { rows, policy } = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    const [found, settings] = await Promise.all([
      tx.careFollowUp.findMany({
        where: { tenantId: ctx.tenantId, status },
        orderBy: status === 'OPEN' ? [{ createdAt: 'asc' }] : [{ resolvedAt: 'desc' }],
        take: 100,
        select: followUpSelect,
      }),
      loadCareSettings(tx, ctx.tenantId),
    ]);
    return { rows: found, policy: settings?.deadPlantPolicy ?? null };
  });
  const canResolve = hasPermission(ctx, 'subscriptions:write');
  return {
    items: rows.map((row) => toFollowUpDto(row, policy)),
    canResolve,
    canQuote: canResolve && hasPermission(ctx, 'quotes:write'),
  };
}

/** Quanti avvisi aperti ha la fioreria (per l'avviso nell'Agenda); 0 senza il piano. */
export async function countOpenCareFollowUpsTx(
  tx: TransactionClient,
  tenantId: string,
): Promise<number> {
  return tx.careFollowUp.count({ where: { tenantId, status: 'OPEN' } });
}

export interface ResolveFollowUpInput {
  readonly resolution: CareFollowUpResolution;
  readonly note: string | null;
  /** "Cotizar": la cotización appena creata. */
  readonly quoteId?: string;
  /** "Reposición sin costo": la visita extra appena creata. */
  readonly extraVisitId?: string;
  /** L'avviso deve essere di questo contratto (visita extra e cotización nascono dal contratto). */
  readonly subscriptionId?: string;
}

/**
 * L'avviso aperto si risolve una volta sola. Prima di creare una visita extra o una cotización si
 * controlla qui (`check`), poi si risolve nella stessa transazione: se nel frattempo un altro lo ha
 * risolto, `updateMany` non trova la riga aperta e tutto si annulla.
 */
async function loadFollowUpForResolution(
  tx: TransactionClient,
  ctx: TenantContext,
  followUpId: string,
  input: Pick<ResolveFollowUpInput, 'resolution' | 'subscriptionId'>,
) {
  const followUp = await tx.careFollowUp.findFirst({
    where: { tenantId: ctx.tenantId, id: followUpId },
    select: {
      id: true,
      kind: true,
      status: true,
      resolution: true,
      subscriptionId: true,
      plant: { select: { name: true } },
      subscription: { select: { number: true } },
    },
  });
  if (!followUp) return null;
  if (input.subscriptionId && followUp.subscriptionId !== input.subscriptionId) {
    throw new ValidationError({ followUpId: 'invalid_option' });
  }
  if (!careFollowUpResolutions(followUp.kind).includes(input.resolution)) {
    throw new ValidationError({ resolution: 'invalid_option' });
  }
  return followUp;
}

/** Controlla che l'avviso si possa risolvere così; null se non è della fioreria. */
export async function checkCareFollowUpOpenTx(
  tx: TransactionClient,
  ctx: TenantContext,
  followUpId: string,
  input: Pick<ResolveFollowUpInput, 'resolution' | 'subscriptionId'>,
): Promise<{ readonly plantName: string | null } | null> {
  const followUp = await loadFollowUpForResolution(tx, ctx, followUpId, input);
  if (!followUp) return null;
  if (followUp.status !== 'OPEN') throw new ConflictError('care_follow_up_resolved');
  return { plantName: followUp.plant?.name ?? null };
}

/**
 * Risolve l'avviso nella transazione di chi chiama. Ripetere la stessa scelta "a mano" non fa nulla
 * (un doppio tocco); una scelta diversa su un avviso già risolto è un conflitto. Null se l'avviso
 * non è della fioreria.
 */
export async function resolveCareFollowUpTx(
  tx: TransactionClient,
  ctx: TenantContext,
  followUpId: string,
  input: ResolveFollowUpInput,
): Promise<'resolved' | 'unchanged' | null> {
  const followUp = await loadFollowUpForResolution(tx, ctx, followUpId, input);
  if (!followUp) return null;
  const linked = input.quoteId !== undefined || input.extraVisitId !== undefined;
  if (followUp.status === 'RESOLVED') {
    if (!linked && followUp.resolution === input.resolution) return 'unchanged';
    throw new ConflictError('care_follow_up_resolved');
  }
  const updated = await tx.careFollowUp.updateMany({
    where: { tenantId: ctx.tenantId, id: followUp.id, status: 'OPEN' },
    data: {
      status: 'RESOLVED',
      resolution: input.resolution,
      quoteId: input.quoteId ?? null,
      extraVisitId: input.extraVisitId ?? null,
      resolvedAt: new Date(),
      resolvedById: ctx.userId,
      resolutionNote: input.note,
    },
  });
  if (updated.count === 0) throw new ConflictError('care_follow_up_resolved');
  await recordAudit(tx, ctx, {
    action: AUDIT_ACTIONS.careFollowUpResolved,
    entityType: 'CareFollowUp',
    entityId: followUp.id,
    metadata: {
      number: formatSubscriptionNumber(followUp.subscription.number),
      kind: followUp.kind,
      resolution: input.resolution,
      ...(input.quoteId ? { quoteId: input.quoteId } : {}),
      ...(input.extraVisitId ? { extraVisitId: input.extraVisitId } : {}),
    },
  });
  return 'resolved';
}

/**
 * Chi gestisce risolve un avviso senza creare nulla: "Atendido", "En la próxima visita" o "No se
 * repone", con una nota facoltativa. La visita extra e la cotización hanno i loro servizi.
 */
export async function resolveCareFollowUp(
  ctx: TenantContext,
  followUpId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'subscriptions:write');
  if (!isUuid(followUpId)) throw new NotFoundError('CareFollowUp');
  const parsed = careFollowUpResolveSchema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    await requireEntitlement(ctx, 'floralCare', tx);
    return resolveCareFollowUpTx(tx, ctx, followUpId, parsed.data);
  });
  if (!found) await notFound(ctx, 'CareFollowUp', followUpId);
}
